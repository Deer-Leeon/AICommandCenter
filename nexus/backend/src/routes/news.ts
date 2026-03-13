import { Router, type Response } from 'express';
import Parser from 'rss-parser';
import { supabase } from '../lib/supabase.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

export const newsRouter = Router();

// ── Types ──────────────────────────────────────────────────────────────────────

export type NewsSource = 'NYT' | 'WaPo' | 'Ars Technica' | 'TechCrunch' | 'Wired';

export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: NewsSource;
  publishedAt: string;
  imageUrl: string | null;
  isBreaking: boolean;
}

type Category = 'politics' | 'technology' | 'ai';

interface CategoryCache {
  articles: NewsArticle[];
  cachedAt: string;
}

// ── Feed configuration ─────────────────────────────────────────────────────────

const FEEDS: Record<Category, Array<{ url: string; source: NewsSource }>> = {
  politics: [
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml', source: 'NYT'  },
    { url: 'https://feeds.washingtonpost.com/rss/politics',              source: 'WaPo' },
  ],
  technology: [
    { url: 'https://feeds.arstechnica.com/arstechnica/index', source: 'Ars Technica' },
    { url: 'https://techcrunch.com/feed/',                    source: 'TechCrunch'   },
  ],
  // AI uses tech feeds filtered by keywords
  ai: [
    { url: 'https://www.wired.com/feed/rss',                  source: 'Wired'        },
    { url: 'https://feeds.arstechnica.com/arstechnica/index', source: 'Ars Technica' },
    { url: 'https://techcrunch.com/feed/',                    source: 'TechCrunch'   },
  ],
};

const AI_KEYWORDS = [
  'artificial intelligence', ' ai ', 'machine learning', 'chatgpt',
  'openai', 'anthropic', 'gemini', 'llm', 'neural network', 'deep learning',
  'large language model', 'generative ai', 'claude', 'gpt-',
];

const MAX_ARTICLES = 20;
const POLL_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ── RSS parser ─────────────────────────────────────────────────────────────────

interface MediaField { $?: { url?: string }; url?: string }

type RSSItem = Parser.Item & {
  mediaContent?:      MediaField;
  mediaThumbnail?:    MediaField;
  'media:content'?:   MediaField;
  'media:thumbnail'?: MediaField;
  'content:encoded'?: string;
};

const parser = new Parser<Record<string, unknown>, RSSItem>({
  customFields: {
    item: [
      ['media:content',   'mediaContent'   ],
      ['media:thumbnail', 'mediaThumbnail' ],
      ['content:encoded', 'content:encoded'],
    ],
  },
  timeout: 12000,
});

// ── In-memory store ────────────────────────────────────────────────────────────

const cache = new Map<Category, CategoryCache>();
const sseClients = new Set<Response>();

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractImage(item: RSSItem): string | null {
  const mc = item.mediaContent ?? (item as RSSItem)['media:content'];
  if (mc?.['$']?.url) return mc['$'].url;
  if (mc?.url) return mc.url;

  const mt = item.mediaThumbnail ?? (item as RSSItem)['media:thumbnail'];
  if (mt?.['$']?.url) return mt['$'].url;

  const enc = item.enclosure as { url?: string; type?: string } | undefined;
  if (enc?.url && enc.type?.startsWith('image')) return enc.url;

  const html = ((item as RSSItem)['content:encoded'] ?? item.content ?? '') as string;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match?.[1]) return match[1];

  return null;
}

function matchesAI(item: RSSItem): boolean {
  const text = [item.title, item.contentSnippet, item.content]
    .filter(Boolean).join(' ').toLowerCase();
  return AI_KEYWORDS.some(kw => text.includes(kw));
}

function dedup(articles: NewsArticle[]): NewsArticle[] {
  const seen = new Set<string>();
  return articles.filter(a => {
    const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchFeed(url: string, source: NewsSource, category: Category): Promise<NewsArticle[]> {
  const feed = await parser.parseURL(url);
  const items = (feed.items ?? []) as RSSItem[];
  const filtered = category === 'ai' ? items.filter(matchesAI) : items;

  return filtered
    .map(item => ({
      id:          item.guid ?? item.link ?? item.title ?? '',
      title:       item.title?.trim() ?? '',
      summary:     (item.contentSnippet ?? '').replace(/\s+/g, ' ').trim(),
      url:         item.link ?? '',
      source,
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      imageUrl:    extractImage(item),
      isBreaking:  false,
    }))
    .filter(a => a.title && a.url);
}

async function refreshCategory(cat: Category): Promise<NewsArticle[]> {
  const feeds = FEEDS[cat];
  const results = await Promise.allSettled(
    feeds.map(f => fetchFeed(f.url, f.source, cat))
  );

  const combined: NewsArticle[] = results.flatMap(
    r => r.status === 'fulfilled' ? r.value : []
  );

  if (combined.length === 0) throw new Error(`All feeds failed for ${cat}`);

  const sorted = dedup(combined).sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
  return sorted.slice(0, MAX_ARTICLES);
}

// ── Background polling ─────────────────────────────────────────────────────────

function pushSSE(event: string, payload: unknown) {
  const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try { client.write(line); } catch { sseClients.delete(client); }
  }
}

async function pollAll() {
  const categories: Category[] = ['politics', 'technology', 'ai'];
  await Promise.all(categories.map(async cat => {
    try {
      const prev = cache.get(cat);
      const articles = await refreshCategory(cat);

      // Detect genuinely new articles (newer than the previous most-recent item)
      let newArticles: NewsArticle[] = [];
      if (prev && prev.articles.length > 0) {
        const prevLatest = new Date(prev.articles[0].publishedAt).getTime();
        newArticles = articles.filter(
          a => new Date(a.publishedAt).getTime() > prevLatest
        );
        newArticles.forEach(a => { a.isBreaking = true; });
      }

      cache.set(cat, { articles, cachedAt: new Date().toISOString() });

      if (newArticles.length > 0) {
        pushSSE('news:update', { category: cat, newArticles });
      }
    } catch (err) {
      console.error(`[news] Failed to refresh "${cat}":`, (err as Error).message);
    }
  }));
}

// Warm the cache immediately on startup, then poll every 15 minutes
console.log('[news] Starting initial feed fetch…');
pollAll()
  .then(() => console.log('[news] Cache warm — polling every 15 min'))
  .catch(err => console.error('[news] Initial fetch failed:', err));

setInterval(pollAll, POLL_INTERVAL_MS);

// ── Routes ─────────────────────────────────────────────────────────────────────

// IMPORTANT: /stream MUST be defined before /:category so Express doesn't treat
// the literal string "stream" as a category parameter.

// GET /api/news/stream — SSE (auth via query param — EventSource can't set headers)
newsRouter.get('/stream', async (req: AuthRequest, res: Response) => {
  const token = req.query.token as string | undefined;
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) { res.status(401).json({ error: 'Invalid token' }); return; }

  res.setHeader('Content-Type',     'text/event-stream');
  res.setHeader('Cache-Control',    'no-cache');
  res.setHeader('Connection',       'keep-alive');
  res.setHeader('X-Accel-Buffering','no'); // disable nginx buffering
  res.flushHeaders();

  // Immediately send the current cache for all categories
  for (const cat of ['politics', 'technology', 'ai'] as Category[]) {
    const entry = cache.get(cat);
    if (entry) {
      res.write(`event: news:init\ndata: ${JSON.stringify({
        category: cat,
        articles: entry.articles,
        cachedAt: entry.cachedAt,
      })}\n\n`);
    }
  }

  sseClients.add(res);

  // Heartbeat every 25 s to prevent proxy timeouts
  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { cleanup(); }
  }, 25_000);

  function cleanup() {
    clearInterval(heartbeat);
    sseClients.delete(res);
    try { res.end(); } catch { /* already closed */ }
  }

  req.on('close',  cleanup);
  req.on('error',  cleanup);
});

// GET /api/news/:category — serve from cache instantly
newsRouter.get('/:category', requireAuth, (req: AuthRequest, res: Response) => {
  const cat = req.params.category as Category;
  if (!['politics', 'technology', 'ai'].includes(cat)) {
    res.status(400).json({ error: 'Invalid category. Use: politics | technology | ai' });
    return;
  }
  const entry = cache.get(cat);
  if (!entry) {
    res.status(503).json({ error: 'Cache is warming up — try again in a few seconds.' });
    return;
  }
  res.json({ articles: entry.articles, cachedAt: entry.cachedAt });
});
