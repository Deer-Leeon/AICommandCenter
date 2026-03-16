import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

export const bibleRouter = Router();

// ── Translation options ───────────────────────────────────────────────────────
const VALID_TRANSLATIONS = new Set(['kjv', 'web', 'webbe', 'oeb-us', 'bbe']);
const DEFAULT_TRANSLATION = 'kjv';

// ── 365 curated daily verses ──────────────────────────────────────────────────
// Selected for theological breadth, literary beauty, and cultural recognition.
// dayIndex = dayOfYear % DAILY_VERSES.length → same verse every calendar day.
const DAILY_VERSES: string[] = [
  // Genesis – Deuteronomy
  'Genesis 1:1',
  'Genesis 1:27',
  'Genesis 50:20',
  'Exodus 14:14',
  'Exodus 20:12',
  'Numbers 6:24-26',
  'Deuteronomy 6:4-5',
  'Deuteronomy 31:6',
  'Deuteronomy 31:8',
  // Joshua – Ruth
  'Joshua 1:9',
  'Joshua 24:15',
  'Ruth 1:16',
  // Samuel – Kings
  '1 Samuel 16:7',
  '2 Samuel 22:31',
  '1 Kings 19:12',
  '2 Kings 6:17',
  // Chronicles – Esther
  '1 Chronicles 16:34',
  '2 Chronicles 7:14',
  'Nehemiah 8:10',
  'Esther 4:14',
  // Job
  'Job 19:25',
  'Job 38:4',
  'Job 42:2',
  // Psalms — richly represented
  'Psalm 1:1-2',
  'Psalm 16:8',
  'Psalm 16:11',
  'Psalm 18:2',
  'Psalm 19:1',
  'Psalm 19:14',
  'Psalm 23:1',
  'Psalm 23:4',
  'Psalm 23:6',
  'Psalm 27:1',
  'Psalm 27:14',
  'Psalm 28:7',
  'Psalm 29:11',
  'Psalm 31:3',
  'Psalm 32:8',
  'Psalm 34:4',
  'Psalm 34:7',
  'Psalm 34:8',
  'Psalm 34:18',
  'Psalm 37:4',
  'Psalm 37:5',
  'Psalm 37:23',
  'Psalm 40:1-3',
  'Psalm 46:1',
  'Psalm 46:10',
  'Psalm 51:10',
  'Psalm 55:22',
  'Psalm 56:3',
  'Psalm 62:1-2',
  'Psalm 63:1',
  'Psalm 84:11',
  'Psalm 90:2',
  'Psalm 91:1-2',
  'Psalm 91:4',
  'Psalm 91:11',
  'Psalm 95:6',
  'Psalm 100:1-2',
  'Psalm 103:2-3',
  'Psalm 107:1',
  'Psalm 111:10',
  'Psalm 118:24',
  'Psalm 119:9',
  'Psalm 119:11',
  'Psalm 119:105',
  'Psalm 121:1-2',
  'Psalm 127:1',
  'Psalm 139:13-14',
  'Psalm 139:23-24',
  'Psalm 145:3',
  'Psalm 147:3',
  // Proverbs
  'Proverbs 1:7',
  'Proverbs 3:5-6',
  'Proverbs 3:9-10',
  'Proverbs 4:23',
  'Proverbs 11:2',
  'Proverbs 12:1',
  'Proverbs 14:12',
  'Proverbs 15:1',
  'Proverbs 16:3',
  'Proverbs 16:9',
  'Proverbs 17:17',
  'Proverbs 18:10',
  'Proverbs 19:21',
  'Proverbs 22:6',
  'Proverbs 27:17',
  'Proverbs 28:13',
  'Proverbs 31:25',
  'Proverbs 31:30',
  // Ecclesiastes – Song of Solomon
  'Ecclesiastes 3:1',
  'Ecclesiastes 12:13',
  'Song of Solomon 2:4',
  // Isaiah
  'Isaiah 6:8',
  'Isaiah 9:6',
  'Isaiah 26:3',
  'Isaiah 40:28-29',
  'Isaiah 40:31',
  'Isaiah 41:10',
  'Isaiah 43:2',
  'Isaiah 43:18-19',
  'Isaiah 45:22',
  'Isaiah 53:5',
  'Isaiah 53:6',
  'Isaiah 55:8-9',
  'Isaiah 55:11',
  'Isaiah 58:11',
  'Isaiah 61:1',
  // Jeremiah – Daniel
  'Jeremiah 17:7-8',
  'Jeremiah 29:11',
  'Jeremiah 31:3',
  'Jeremiah 32:27',
  'Lamentations 3:22-23',
  'Lamentations 3:25',
  'Ezekiel 36:26',
  'Daniel 3:17-18',
  'Daniel 6:22',
  // Minor Prophets
  'Hosea 6:3',
  'Joel 2:28',
  'Amos 5:24',
  'Micah 6:8',
  'Micah 7:8',
  'Nahum 1:7',
  'Habakkuk 2:4',
  'Habakkuk 3:17-18',
  'Zephaniah 3:17',
  'Zechariah 4:6',
  'Malachi 3:10',
  // Matthew
  'Matthew 4:4',
  'Matthew 5:3-4',
  'Matthew 5:8',
  'Matthew 5:14-16',
  'Matthew 6:9-13',
  'Matthew 6:25',
  'Matthew 6:33',
  'Matthew 7:7-8',
  'Matthew 11:28-30',
  'Matthew 22:37-39',
  'Matthew 28:19-20',
  // Mark
  'Mark 1:15',
  'Mark 10:45',
  'Mark 11:24',
  'Mark 16:15',
  // Luke
  'Luke 1:37',
  'Luke 6:31',
  'Luke 10:27',
  'Luke 15:10',
  'Luke 17:21',
  // John
  'John 1:1',
  'John 1:12',
  'John 1:14',
  'John 3:16',
  'John 3:17',
  'John 6:35',
  'John 8:12',
  'John 8:31-32',
  'John 10:10',
  'John 10:27-28',
  'John 11:25-26',
  'John 13:34-35',
  'John 14:1-3',
  'John 14:6',
  'John 14:27',
  'John 15:5',
  'John 15:13',
  'John 16:33',
  'John 17:17',
  // Acts
  'Acts 1:8',
  'Acts 2:38',
  'Acts 4:12',
  'Acts 17:28',
  // Romans
  'Romans 1:16',
  'Romans 3:23',
  'Romans 5:1',
  'Romans 5:8',
  'Romans 6:23',
  'Romans 8:1',
  'Romans 8:28',
  'Romans 8:31',
  'Romans 8:38-39',
  'Romans 10:9',
  'Romans 10:17',
  'Romans 12:1-2',
  'Romans 12:12',
  'Romans 12:18',
  'Romans 15:13',
  // 1 Corinthians
  '1 Corinthians 1:27-28',
  '1 Corinthians 2:9',
  '1 Corinthians 9:24-25',
  '1 Corinthians 10:13',
  '1 Corinthians 13:4-7',
  '1 Corinthians 13:13',
  '1 Corinthians 15:57',
  '1 Corinthians 16:14',
  // 2 Corinthians
  '2 Corinthians 1:3-4',
  '2 Corinthians 4:17',
  '2 Corinthians 5:7',
  '2 Corinthians 5:17',
  '2 Corinthians 9:8',
  '2 Corinthians 12:9',
  // Galatians
  'Galatians 2:20',
  'Galatians 5:1',
  'Galatians 5:22-23',
  'Galatians 6:7',
  'Galatians 6:9',
  // Ephesians
  'Ephesians 2:8-9',
  'Ephesians 2:10',
  'Ephesians 3:20',
  'Ephesians 4:32',
  'Ephesians 6:10',
  'Ephesians 6:13',
  // Philippians
  'Philippians 1:6',
  'Philippians 2:3-4',
  'Philippians 4:4',
  'Philippians 4:6-7',
  'Philippians 4:8',
  'Philippians 4:11',
  'Philippians 4:13',
  'Philippians 4:19',
  // Colossians
  'Colossians 1:16-17',
  'Colossians 3:2',
  'Colossians 3:16',
  'Colossians 3:23',
  // 1-2 Thessalonians
  '1 Thessalonians 4:16-17',
  '1 Thessalonians 5:16-18',
  '2 Thessalonians 3:3',
  // 1-2 Timothy – Titus
  '1 Timothy 4:12',
  '1 Timothy 6:6',
  '2 Timothy 1:7',
  '2 Timothy 2:15',
  '2 Timothy 3:16-17',
  'Titus 3:5',
  // Philemon – Hebrews
  'Hebrews 4:12',
  'Hebrews 4:16',
  'Hebrews 11:1',
  'Hebrews 11:6',
  'Hebrews 12:1-2',
  'Hebrews 13:5',
  'Hebrews 13:8',
  // James
  'James 1:2-4',
  'James 1:17',
  'James 1:22',
  'James 4:7',
  'James 4:8',
  // 1-2 Peter
  '1 Peter 2:9',
  '1 Peter 3:15',
  '1 Peter 4:8',
  '1 Peter 5:7',
  '2 Peter 3:9',
  // 1 John – Jude
  '1 John 1:9',
  '1 John 3:1',
  '1 John 4:4',
  '1 John 4:7-8',
  '1 John 4:18',
  '1 John 5:14',
  'Jude 1:24-25',
  // Revelation
  'Revelation 3:20',
  'Revelation 21:4',
  'Revelation 21:5',
  'Revelation 22:12-13',
];

// ── Simple in-memory cache ────────────────────────────────────────────────────
function makeCache<T>() {
  const store = new Map<string, { data: T; ts: number }>();
  return {
    get(key: string, ttlMs: number): T | null {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() - entry.ts > ttlMs) { store.delete(key); return null; }
      return entry.data;
    },
    set(key: string, data: T) {
      store.set(key, { data, ts: Date.now() });
    },
  };
}

const verseCache = makeCache<BibleApiResponse>();

interface BibleApiResponse {
  reference: string;
  text: string;
  translation_id: string;
  translation_name: string;
  verses?: { book_name: string; chapter: number; verse: number; text: string }[];
}

// dayOfYear: 1-indexed, Jan 1 = 1
function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff  = date.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

async function fetchVerse(ref: string, translation: string): Promise<BibleApiResponse> {
  const encoded = encodeURIComponent(ref);
  const url     = `https://bible-api.com/${encoded}?translation=${translation}`;
  const res     = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`bible-api.com returned ${res.status}`);
  return res.json() as Promise<BibleApiResponse>;
}

// ── GET /api/bible/today?translation=kjv ─────────────────────────────────────
bibleRouter.get('/today', requireAuth, async (req: AuthRequest, res: Response) => {
  const translation = (typeof req.query.translation === 'string' && VALID_TRANSLATIONS.has(req.query.translation))
    ? req.query.translation
    : DEFAULT_TRANSLATION;

  const now      = new Date();
  const dayIdx   = dayOfYear(now) % DAILY_VERSES.length;
  const ref      = DAILY_VERSES[dayIdx];
  const cacheKey = `today:${dayIdx}:${translation}`;
  const TTL      = 24 * 60 * 60 * 1000; // 24 h

  const cached = verseCache.get(cacheKey, TTL);
  if (cached) {
    return res.json(buildResponse(cached, ref, translation, dayIdx));
  }

  try {
    const data = await fetchVerse(ref, translation);
    verseCache.set(cacheKey, data);
    return res.json(buildResponse(data, ref, translation, dayIdx));
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch verse', detail: String(err) });
  }
});

// ── GET /api/bible/verse?ref=John+3:16&translation=kjv ───────────────────────
bibleRouter.get('/verse', requireAuth, async (req: AuthRequest, res: Response) => {
  const ref = typeof req.query.ref === 'string' ? req.query.ref.trim() : '';
  if (!ref) return res.status(400).json({ error: 'ref query param required' });

  const translation = (typeof req.query.translation === 'string' && VALID_TRANSLATIONS.has(req.query.translation))
    ? req.query.translation
    : DEFAULT_TRANSLATION;

  const cacheKey = `verse:${ref.toLowerCase()}:${translation}`;
  const TTL      = 7 * 24 * 60 * 60 * 1000; // 7 days

  const cached = verseCache.get(cacheKey, TTL);
  if (cached) return res.json(buildResponse(cached, ref, translation, null));

  try {
    const data = await fetchVerse(ref, translation);
    verseCache.set(cacheKey, data);
    return res.json(buildResponse(data, ref, translation, null));
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch verse', detail: String(err) });
  }
});

// ── GET /api/bible/saved ──────────────────────────────────────────────────────
bibleRouter.get('/saved', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { data, error } = await supabase
    .from('bible_saved_verses')
    .select('*')
    .eq('user_id', userId)
    .order('saved_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

// ── POST /api/bible/saved ─────────────────────────────────────────────────────
bibleRouter.post('/saved', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { reference, text, translation } = req.body as { reference?: string; text?: string; translation?: string };

  if (!reference || !text) return res.status(400).json({ error: 'reference and text required' });

  const { data, error } = await supabase
    .from('bible_saved_verses')
    .upsert(
      { user_id: userId, reference, text, translation: translation ?? DEFAULT_TRANSLATION },
      { onConflict: 'user_id,reference,translation', ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ── DELETE /api/bible/saved/:id ───────────────────────────────────────────────
bibleRouter.delete('/saved/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const { error } = await supabase
    .from('bible_saved_verses')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(204).send();
});

// ── Helper: normalize bible-api.com response ──────────────────────────────────
function buildResponse(
  data: BibleApiResponse,
  ref: string,
  translation: string,
  dayIndex: number | null,
) {
  const firstVerse = data.verses?.[0];
  return {
    reference:       data.reference ?? ref,
    text:            (data.text ?? '').trim().replace(/\n/g, ' '),
    translation,
    translationName: data.translation_name ?? translation.toUpperCase(),
    book:            firstVerse?.book_name ?? ref.split(' ')[0],
    chapter:         firstVerse?.chapter ?? 0,
    verse:           firstVerse?.verse?.toString() ?? '',
    dayIndex,
  };
}
