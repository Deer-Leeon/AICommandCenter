import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

export const typingRouter = Router();

type LBPeriod = 'daily' | 'monthly' | 'alltime';

// ── Server-side leaderboard cache (60 s, invalidated at period boundaries) ────

interface CacheEntry { data: unknown; expiresAt: number }
const lbCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

function getCacheKey(mode: string, period: LBPeriod): string {
  const now = new Date();
  if (period === 'daily')   return `${mode}:daily:${now.toISOString().slice(0, 10)}`;
  if (period === 'monthly') return `${mode}:monthly:${now.toISOString().slice(0, 7)}`;
  return `${mode}:alltime`;
}

function getCache(key: string): unknown | null {
  const e = lbCache.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { lbCache.delete(key); return null; }
  return e.data;
}

function setCache(key: string, data: unknown): void {
  lbCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function utcMidnightToday(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function utcMonthStart(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// ── Leaderboard aggregation helper ────────────────────────────────────────────

interface RawRow {
  user_id: string;
  display_name?: string | null;
  wpm: number | string;
  accuracy: number | string;
  achieved_at?: string;
  completed_at?: string;
}

interface ProfileRow {
  user_id: string;
  display_name: string;
  username: string | null;
}

async function enrichWithProfiles(rows: RawRow[]): Promise<Array<RawRow & { display_name: string; username: string | null }>> {
  const userIds = [...new Set(rows.map(r => r.user_id))];
  if (userIds.length === 0) return [];

  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, display_name, username')
    .in('user_id', userIds);

  const byUser = new Map<string, ProfileRow>();
  for (const p of profiles ?? []) byUser.set(p.user_id, p);

  return rows.map(r => {
    const p = byUser.get(r.user_id);
    return {
      ...r,
      display_name: p?.display_name ?? r.display_name ?? 'anonymous',
      username: p?.username ?? null,
    };
  });
}

function buildLeaderboard(rows: Array<RawRow & { display_name: string; username: string | null }>, currentUserId: string) {
  const byUser = new Map<string, typeof rows[0]>();
  for (const row of rows) {
    const ex = byUser.get(row.user_id);
    const wpm = +row.wpm;
    if (!ex || wpm > +ex.wpm) byUser.set(row.user_id, row);
  }

  const ranked = [...byUser.values()]
    .sort((a, b) => +b.wpm - +a.wpm)
    .map((e, i) => ({
      rank:          i + 1,
      displayName:   e.display_name,
      username:      e.username,
      wpm:           +e.wpm,
      accuracy:      +e.accuracy,
      achievedAt:    e.achieved_at ?? e.completed_at ?? '',
      isCurrentUser: e.user_id === currentUserId,
    }));

  const top20 = ranked.slice(0, 20);
  const curEntry = ranked.find(e => e.isCurrentUser);
  if (curEntry && curEntry.rank > 20) top20.push(curEntry);

  return { leaderboard: top20, total: ranked.length };
}

// ── POST /api/typing/result ────────────────────────────────────────────────────

typingRouter.post('/result', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('user_id', userId)
    .single();
  const displayName = profile?.display_name ?? req.user!.email?.split('@')[0] ?? 'anonymous';

  const {
    mode, content_type, wpm, raw_wpm, accuracy, consistency, error_count, wpm_history,
  } = req.body as {
    mode: string; content_type: string; wpm: number; raw_wpm: number;
    accuracy: number; consistency: number; error_count: number; wpm_history: number[];
  };

  if (!['15s', '30s', '60s', '120s'].includes(mode)) {
    res.status(400).json({ error: 'Invalid mode' }); return;
  }
  if (!['words', 'quotes', 'code'].includes(content_type)) {
    res.status(400).json({ error: 'Invalid content_type' }); return;
  }

  // ── Fetch current all-time PB and today's best in parallel ──────────────────
  const todayStart = utcMidnightToday();
  const [pbRes, todayRes] = await Promise.all([
    supabase
      .from('typing_personal_bests')
      .select('wpm')
      .eq('user_id', userId)
      .eq('mode', mode)
      .single(),
    supabase
      .from('typing_results')
      .select('wpm')
      .eq('user_id', userId)
      .eq('mode', mode)
      .gte('completed_at', todayStart)
      .order('wpm', { ascending: false })
      .limit(1)
      .single(),
  ]);

  const prevBestWpm: number | null = pbRes.data ? +pbRes.data.wpm : null;
  const todayBestWpm: number | null = todayRes.data ? +todayRes.data.wpm : null;
  const isPB = prevBestWpm === null || wpm > prevBestWpm;
  const pbDiff = prevBestWpm !== null ? +(wpm - prevBestWpm).toFixed(1) : null;
  const isBestToday = todayBestWpm === null || wpm >= todayBestWpm;

  // ── Insert result (DB trigger auto-maintains typing_personal_bests) ──────────
  const now = new Date().toISOString();
  const { data: inserted, error } = await supabase
    .from('typing_results')
    .insert({
      user_id: userId, display_name: displayName,
      mode, content_type, wpm, raw_wpm, accuracy, consistency,
      error_count, wpm_history, completed_at: now,
    })
    .select('id')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }

  // The DB trigger fn_update_typing_personal_best() maintains typing_personal_bests
  // atomically on every INSERT — no manual upsert needed here.

  // Invalidate caches for this mode
  const today = now.slice(0, 10);
  const month  = now.slice(0, 7);
  lbCache.delete(`${mode}:daily:${today}`);
  lbCache.delete(`${mode}:monthly:${month}`);
  lbCache.delete(`${mode}:alltime`);

  res.json({ id: inserted.id, isPB, pbDiff, isBestToday, prevBestWpm });
});

// ── GET /api/typing/stats ──────────────────────────────────────────────────────

typingRouter.get('/stats', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const [pbsRes, histRes, datesRes] = await Promise.all([
    // Personal bests — O(4) rows, instant
    supabase
      .from('typing_personal_bests')
      .select('mode, wpm, accuracy, achieved_at')
      .eq('user_id', userId),
    // Last 50 for chart
    supabase
      .from('typing_results')
      .select('id, mode, wpm, accuracy, completed_at')
      .eq('user_id', userId)
      .order('completed_at', { ascending: false })
      .limit(50),
    // All timestamps for streak
    supabase
      .from('typing_results')
      .select('completed_at')
      .eq('user_id', userId)
      .order('completed_at', { ascending: false }),
  ]);

  const personalBests = (pbsRes.data ?? []).map(pb => ({
    mode: pb.mode, wpm: +pb.wpm, accuracy: +pb.accuracy, achievedAt: pb.achieved_at,
  }));

  res.json({
    personalBests,
    history: (histRes.data ?? []).reverse(),
    ...computeStreak(datesRes.data?.map(r => r.completed_at) ?? []),
  });
});

// ── GET /api/typing/leaderboard?mode=30s&period=daily|monthly|alltime ─────────

typingRouter.get('/leaderboard', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const mode   = (req.query.mode   as string) ?? '30s';
  const period = ((req.query.period as string) ?? 'alltime') as LBPeriod;

  if (!['15s', '30s', '60s', '120s'].includes(mode)) {
    res.status(400).json({ error: 'Invalid mode' }); return;
  }
  if (!['daily', 'monthly', 'alltime'].includes(period)) {
    res.status(400).json({ error: 'Invalid period' }); return;
  }

  const cacheKey = getCacheKey(mode, period);
  const cached = getCache(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    let rawRows: RawRow[];

    if (period === 'alltime') {
      const { data, error } = await supabase
        .from('typing_personal_bests')
        .select('user_id, display_name, wpm, accuracy, achieved_at')
        .eq('mode', mode)
        .order('wpm', { ascending: false });
      if (error) throw error;
      rawRows = (data ?? []).map(r => ({ ...r, achieved_at: r.achieved_at ?? undefined }));
    } else {
      const since = period === 'daily' ? utcMidnightToday() : utcMonthStart();
      const { data, error } = await supabase
        .from('typing_results')
        .select('user_id, display_name, wpm, accuracy, completed_at')
        .eq('mode', mode)
        .gte('completed_at', since)
        .order('wpm', { ascending: false });
      if (error) throw error;
      rawRows = (data ?? []).map(r => ({ ...r, achieved_at: r.completed_at ?? undefined }));
    }

    const enriched = await enrichWithProfiles(rawRows);
    const result = buildLeaderboard(enriched, userId);

    setCache(cacheKey, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── computeStreak helper ───────────────────────────────────────────────────────

function computeStreak(timestamps: string[]) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const daySet = new Set(
    timestamps.map(ts => {
      const d = new Date(ts);
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime();
    })
  );

  const DAY = 86_400_000;

  let currentStreak = 0;
  let check = today.getTime();
  if (!daySet.has(check)) check -= DAY;
  while (daySet.has(check)) { currentStreak++; check -= DAY; }

  const days = [...daySet].sort((a, b) => a - b);
  let maxStreak = 0, runStreak = 0, prevDay = -Infinity;
  for (const d of days) {
    runStreak = (d - prevDay === DAY) ? runStreak + 1 : 1;
    maxStreak = Math.max(maxStreak, runStreak);
    prevDay = d;
  }

  const streakDays: boolean[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY);
    d.setUTCHours(0, 0, 0, 0);
    streakDays.push(daySet.has(d.getTime()));
  }

  return { currentStreak, maxStreak, streakDays };
}
