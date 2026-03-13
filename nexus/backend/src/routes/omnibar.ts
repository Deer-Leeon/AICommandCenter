import { Router, type Response } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';

export const omnibarRouter = Router();

// ── Default shortcuts seeded for new accounts ────────────────────────────────
const DEFAULT_SHORTCUTS = [
  { trigger: 'yt',  url: 'https://youtube.com'           },
  { trigger: 'gh',  url: 'https://github.com'            },
  { trigger: 'gm',  url: 'https://gmail.com'             },
  { trigger: 'cal', url: 'https://calendar.google.com'   },
  { trigger: 'rd',  url: 'https://reddit.com'            },
  { trigger: 'tw',  url: 'https://twitter.com'           },
  { trigger: 'nf',  url: 'https://netflix.com'           },
  { trigger: 'sp',  url: 'https://spotify.com'           },
  { trigger: 'nt',  url: 'https://notion.so'             },
  { trigger: 'fig', url: 'https://figma.com'             },
];

// ── GET /api/omnibar/data — load settings + shortcuts + history ──────────────
omnibarRouter.get('/data', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  // Settings — return defaults if row not found
  const { data: settingsRow } = await supabase
    .from('omnibar_settings')
    .select('search_engine, smart_url, open_new_tab, show_suggestions, quick_launch')
    .eq('user_id', userId)
    .single();

  const settings = settingsRow
    ? {
        searchEngine:    settingsRow.search_engine,
        smartUrl:        settingsRow.smart_url,
        openNewTab:      settingsRow.open_new_tab,
        showSuggestions: settingsRow.show_suggestions,
        quickLaunch:     settingsRow.quick_launch,
      }
    : {
        searchEngine: 'google', smartUrl: true, openNewTab: false,
        showSuggestions: true, quickLaunch: false,
      };

  // Shortcuts — seed defaults for first-time users
  let { data: shortcutRows } = await supabase
    .from('omnibar_shortcuts')
    .select('id, trigger, url')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (!shortcutRows || shortcutRows.length === 0) {
    await supabase
      .from('omnibar_shortcuts')
      .insert(DEFAULT_SHORTCUTS.map((s) => ({ ...s, user_id: userId })));

    const { data: fresh } = await supabase
      .from('omnibar_shortcuts')
      .select('id, trigger, url')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    shortcutRows = fresh ?? [];
  }

  // History — top 100 by frequency then recency
  const { data: historyRows } = await supabase
    .from('omnibar_history')
    .select('id, domain, url, visit_count, last_visited')
    .eq('user_id', userId)
    .order('visit_count', { ascending: false })
    .order('last_visited', { ascending: false })
    .limit(100);

  res.json({
    settings,
    shortcuts: shortcutRows ?? [],
    history: (historyRows ?? []).map((h) => ({
      id:          h.id,
      domain:      h.domain,
      url:         h.url,
      visitCount:  h.visit_count,
      lastVisited: h.last_visited,
    })),
  });
});

// ── PUT /api/omnibar/settings — upsert settings ──────────────────────────────
omnibarRouter.put('/settings', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { searchEngine, smartUrl, openNewTab, showSuggestions, quickLaunch } = req.body as {
    searchEngine?: string; smartUrl?: boolean; openNewTab?: boolean;
    showSuggestions?: boolean; quickLaunch?: boolean;
  };

  const validEngines = ['google', 'duckduckgo', 'bing', 'perplexity'];
  if (searchEngine && !validEngines.includes(searchEngine)) {
    res.status(400).json({ error: 'Invalid search engine' }); return;
  }

  const { error } = await supabase
    .from('omnibar_settings')
    .upsert(
      {
        user_id:          userId,
        search_engine:    searchEngine    ?? 'google',
        smart_url:        smartUrl        ?? true,
        open_new_tab:     openNewTab      ?? false,
        show_suggestions: showSuggestions ?? true,
        quick_launch:     quickLaunch     ?? false,
        updated_at:       new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// ── POST /api/omnibar/shortcuts — create a shortcut ─────────────────────────
omnibarRouter.post('/shortcuts', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { trigger, url } = req.body as { trigger: string; url: string };

  if (!trigger?.trim() || !url?.trim()) {
    res.status(400).json({ error: 'trigger and url are required' }); return;
  }

  const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;

  const { data, error } = await supabase
    .from('omnibar_shortcuts')
    .insert({ user_id: userId, trigger: trigger.toLowerCase().trim(), url: normalizedUrl })
    .select('id, trigger, url')
    .single();

  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'A shortcut with that trigger already exists' }); return;
    }
    res.status(500).json({ error: error.message }); return;
  }
  res.json(data);
});

// ── PUT /api/omnibar/shortcuts/:id — update a shortcut ───────────────────────
omnibarRouter.put('/shortcuts/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const { trigger, url } = req.body as { trigger: string; url: string };

  if (!trigger?.trim() || !url?.trim()) {
    res.status(400).json({ error: 'trigger and url are required' }); return;
  }

  const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;

  const { error } = await supabase
    .from('omnibar_shortcuts')
    .update({ trigger: trigger.toLowerCase().trim(), url: normalizedUrl })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// ── DELETE /api/omnibar/shortcuts/:id — remove a shortcut ────────────────────
omnibarRouter.delete('/shortcuts/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { error } = await supabase
    .from('omnibar_shortcuts')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// ── POST /api/omnibar/history — record or increment a navigation ─────────────
omnibarRouter.post('/history', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { url } = req.body as { url: string };

  if (!url?.trim()) { res.status(400).json({ error: 'url is required' }); return; }

  let domain: string;
  try {
    domain = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    res.status(400).json({ error: 'Invalid URL' }); return;
  }

  // Try to increment existing row; insert if missing
  const { data: existing } = await supabase
    .from('omnibar_history')
    .select('id, visit_count')
    .eq('user_id', userId)
    .eq('domain', domain)
    .single();

  if (existing) {
    await supabase
      .from('omnibar_history')
      .update({ visit_count: existing.visit_count + 1, last_visited: new Date().toISOString(), url })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('omnibar_history')
      .insert({ user_id: userId, domain, url, visit_count: 1, last_visited: new Date().toISOString() });
  }

  res.json({ ok: true });
});

// ── DELETE /api/omnibar/history — clear all history for user ─────────────────
omnibarRouter.delete('/history', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const { error } = await supabase
    .from('omnibar_history')
    .delete()
    .eq('user_id', userId);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});
