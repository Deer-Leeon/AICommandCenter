import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

export const footballRouter = Router();

// ── Competitions — football-data.org free tier ────────────────────────────────
// All 12 competitions below are available on the free plan with current season data.

const COMPETITIONS = [
  { code: 'PL',  id: 2021, name: 'Premier League',    country: 'England',       flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', color: '#3D195B' },
  { code: 'PD',  id: 2014, name: 'La Liga',           country: 'Spain',         flag: '🇪🇸', color: '#EE1523' },
  { code: 'BL1', id: 2002, name: 'Bundesliga',        country: 'Germany',       flag: '🇩🇪', color: '#D3010C' },
  { code: 'SA',  id: 2019, name: 'Serie A',           country: 'Italy',         flag: '🇮🇹', color: '#024494' },
  { code: 'FL1', id: 2015, name: 'Ligue 1',           country: 'France',        flag: '🇫🇷', color: '#091C3E' },
  { code: 'CL',  id: 2001, name: 'Champions League',  country: 'Europe',        flag: '🇪🇺', color: '#001489' },
  { code: 'DED', id: 2003, name: 'Eredivisie',        country: 'Netherlands',   flag: '🇳🇱', color: '#FF4F00' },
  { code: 'PPL', id: 2017, name: 'Primeira Liga',     country: 'Portugal',      flag: '🇵🇹', color: '#006600' },
  { code: 'BSA', id: 2013, name: 'Brasileirão',       country: 'Brazil',        flag: '🇧🇷', color: '#009C3B' },
  { code: 'WC',  id: 2000, name: 'World Cup',         country: 'World',         flag: '🌍',  color: '#C8A21A' },
  { code: 'EC',  id: 2018, name: 'Euro Championship', country: 'Europe',        flag: '🇪🇺', color: '#003DA5' },
  { code: 'CLI', id: 2152, name: 'Copa Libertadores', country: 'South America', flag: '🌎',  color: '#CF142B' },
] as const;

const COMP_BY_CODE = new Map(COMPETITIONS.map(c => [c.code, c as typeof COMPETITIONS[number]]));
const COMP_BY_ID: Map<number, typeof COMPETITIONS[number]> = new Map(COMPETITIONS.map(c => [c.id, c]));
const SUPPORTED_CODES = COMPETITIONS.map(c => c.code).join(',');
const SUPPORTED_IDS: Set<number> = new Set(COMPETITIONS.map(c => c.id));

function compMeta(id: number) {
  const c = COMP_BY_ID.get(id);
  return c ? { id: c.id, name: c.name, color: c.color, flag: c.flag } : { id, name: `League ${id}`, color: '#444', flag: '⚽' };
}

// ── In-memory cache ───────────────────────────────────────────────────────────

interface CEntry { data: unknown; ts: number; ttl: number }
const CACHE = new Map<string, CEntry>();

function cGet(key: string): unknown | null {
  const e = CACHE.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > e.ttl) { CACHE.delete(key); return null; }
  return e.data;
}
function cSet(key: string, data: unknown, ttlMs: number): void {
  CACHE.set(key, { data, ts: Date.now(), ttl: ttlMs });
}
function cGetStale(key: string): unknown | null { return CACHE.get(key)?.data ?? null; }

// ── Per-minute rate limiter (football-data.org free: 10 req/min) ──────────────

let minReqs = 0;
let minStart = Date.now();

async function ensureMinuteCapacity(): Promise<void> {
  if (Date.now() - minStart >= 60_000) { minReqs = 0; minStart = Date.now(); }
  if (minReqs >= 9) {
    const waitMs = 61_000 - (Date.now() - minStart);
    console.log(`[football] Rate limit reached — waiting ${waitMs}ms`);
    await new Promise(r => setTimeout(r, waitMs));
    minReqs = 0;
    minStart = Date.now();
  }
}

// ── football-data.org fetch ───────────────────────────────────────────────────

const FD_BASE = 'https://api.football-data.org/v4';

async function fdFetch<T>(path: string): Promise<T> {
  await ensureMinuteCapacity();
  const key = process.env.FOOTBALL_DATA_KEY;
  if (!key) throw new Error('FOOTBALL_DATA_KEY not configured — register free at football-data.org/client/register');

  minReqs++;
  console.log(`[football] API (${minReqs}/10 min): ${path}`);

  const res = await fetch(`${FD_BASE}${path}`, { headers: { 'X-Auth-Token': key } });
  if (res.status === 429) { minReqs = 9; throw new Error('RATE_LIMIT'); }
  if (!res.ok) throw new Error(`FD ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

async function cachedFdFetch<T>(cacheKey: string, ttlMs: number, path: string): Promise<{ data: T; stale: boolean }> {
  const hit = cGet(cacheKey);
  if (hit) { console.log(`[football] Cache HIT: ${cacheKey}`); return { data: hit as T, stale: false }; }
  try {
    const data = await fdFetch<T>(path);
    cSet(cacheKey, data, ttlMs);
    return { data, stale: false };
  } catch (err) {
    const stale = cGetStale(cacheKey) as T | null;
    if (stale) { console.warn(`[football] Stale cache: ${cacheKey}`); return { data: stale, stale: true }; }
    throw err;
  }
}

// ── football-data.org response types ─────────────────────────────────────────

interface FDTeam { id: number; name: string; shortName: string; tla: string; crest: string }
interface FDScore {
  winner: string | null;
  halfTime: { home: number | null; away: number | null };
  fullTime: { home: number | null; away: number | null };
}
interface FDMatch {
  id: number;
  competition: { id: number; name: string; code: string };
  utcDate: string;
  status: string;
  minute?: number | null;
  matchday: number | null;
  stage: string;
  homeTeam: FDTeam;
  awayTeam: FDTeam;
  score: FDScore;
  goals?: FDGoal[];
  bookings?: FDBooking[];
  substitutions?: FDSubstitution[];
}
interface FDGoal {
  minute: number; injuryTime: number | null; type: string;
  team: { id: number; name: string };
  scorer: { id: number; name: string };
  assist: { id: number; name: string } | null;
}
interface FDBooking {
  minute: number; team: { id: number; name: string };
  player: { id: number; name: string }; card: string;
}
interface FDSubstitution {
  minute: number; team: { id: number; name: string };
  playerOut: { id: number; name: string }; playerIn: { id: number; name: string };
}
interface FDTableRow {
  position: number; team: FDTeam;
  playedGames: number; won: number; draw: number; lost: number;
  points: number; goalsFor: number; goalsAgainst: number; goalDifference: number;
  form: string | null;
}
interface FDStandings {
  competition: { id: number; name: string; code: string };
  season: { id: number; startDate: string; endDate: string; currentMatchday: number };
  standings: { stage: string; type: string; group: string | null; table: FDTableRow[] }[];
}
interface FDMatchList { matches: FDMatch[] }
interface FDTeamSearch {
  count: number;
  teams: { id: number; name: string; shortName: string; tla: string; crest: string; area: { id: number; name: string } }[];
}

// ── Match mapper ──────────────────────────────────────────────────────────────

const LIVE_STATUSES = new Set(['IN_PLAY', 'PAUSED']);
const DONE_STATUSES = new Set(['FINISHED', 'AWARDED']);

function mapMatch(m: FDMatch) {
  const isLive = LIVE_STATUSES.has(m.status);
  const isDone = DONE_STATUSES.has(m.status);
  const homeScore = (isLive || isDone) ? (m.score.fullTime.home) : null;
  const awayScore = (isLive || isDone) ? (m.score.fullTime.away) : null;
  return {
    fixtureId: m.id,
    date:      m.utcDate,
    round:     m.matchday != null ? `Matchday ${m.matchday}` : (m.stage ?? ''),
    status:    { short: m.status, long: m.status, elapsed: m.minute ?? null },
    home:      { id: m.homeTeam.id, name: m.homeTeam.name, logo: m.homeTeam.crest, score: homeScore },
    away:      { id: m.awayTeam.id, name: m.awayTeam.name, logo: m.awayTeam.crest, score: awayScore },
  };
}

// ── GET /api/football/live ────────────────────────────────────────────────────

footballRouter.get('/live', requireAuth, async (_req: AuthRequest, res: Response) => {
  try {
    const { data, stale } = await cachedFdFetch<FDMatchList>(
      'live', 60_000,
      `/matches?status=IN_PLAY,PAUSED&competitions=${SUPPORTED_CODES}`,
    );
    const matches = (data.matches ?? []).map(m => ({
      ...mapMatch(m),
      home: { ...mapMatch(m).home, score: m.score.fullTime.home ?? 0 },
      away: { ...mapMatch(m).away, score: m.score.fullTime.away ?? 0 },
      competition: compMeta(m.competition.id),
      minute: m.minute ?? null,
      events: [] as unknown[],
    }));
    res.json({ matches, stale });
  } catch (err) {
    console.error('[football/live]', err);
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/football/today ───────────────────────────────────────────────────

footballRouter.get('/today', requireAuth, async (_req: AuthRequest, res: Response) => {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const { data, stale } = await cachedFdFetch<FDMatchList>(
      `today:${date}`, 5 * 60_000,
      `/matches?dateFrom=${date}&dateTo=${date}&competitions=${SUPPORTED_CODES}`,
    );
    const grouped = new Map<number, ReturnType<typeof mapMatch>[]>();
    for (const m of data.matches ?? []) {
      if (!SUPPORTED_IDS.has(m.competition.id)) continue;
      if (!grouped.has(m.competition.id)) grouped.set(m.competition.id, []);
      grouped.get(m.competition.id)!.push(mapMatch(m));
    }
    const groups = Array.from(grouped.entries()).map(([id, matches]) => ({ competition: compMeta(id), matches }));
    res.json({ date, groups, stale });
  } catch (err) {
    console.error('[football/today]', err);
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/football/standings/:leagueId ─────────────────────────────────────

footballRouter.get('/standings/:leagueId', requireAuth, async (req: AuthRequest, res: Response) => {
  const leagueId = parseInt(req.params.leagueId, 10);
  const comp = COMP_BY_ID.get(leagueId);
  if (!comp) { res.status(404).json({ error: 'Unknown league' }); return; }
  try {
    const { data, stale } = await cachedFdFetch<FDStandings>(
      `standings:${comp.code}`, 3_600_000,
      `/competitions/${comp.code}/standings`,
    );
    const group = data.standings?.find(s => s.type === 'TOTAL') ?? data.standings?.[0];
    const rows = (group?.table ?? []).map(r => ({
      rank:         r.position,
      team:         { id: r.team.id, name: r.team.name, logo: r.team.crest },
      played:       r.playedGames,
      won:          r.won,
      drawn:        r.draw,
      lost:         r.lost,
      goalsFor:     r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      goalsDiff:    r.goalDifference,
      points:       r.points,
      form:         r.form ?? '',
      description:  null as string | null,
    }));
    res.json({ leagueId, season: data.season?.startDate?.slice(0, 4) ?? '', standings: rows, stale });
  } catch (err) {
    console.error(`[football/standings/${leagueId}]`, err);
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/football/fixtures/:leagueId ─────────────────────────────────────

footballRouter.get('/fixtures/:leagueId', requireAuth, async (req: AuthRequest, res: Response) => {
  const leagueId = parseInt(req.params.leagueId, 10);
  const comp = COMP_BY_ID.get(leagueId);
  if (!comp) { res.status(404).json({ error: 'Unknown league' }); return; }

  const today  = new Date().toISOString().slice(0, 10);
  const past   = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
  const future = new Date(Date.now() + 56 * 86_400_000).toISOString().slice(0, 10);
  const TTL    = 30 * 60_000;

  try {
    const [lastRes, nextRes] = await Promise.all([
      cachedFdFetch<FDMatchList>(`fixt:last:${comp.code}`, TTL, `/competitions/${comp.code}/matches?dateFrom=${past}&dateTo=${today}&status=FINISHED`),
      cachedFdFetch<FDMatchList>(`fixt:next:${comp.code}`, TTL, `/competitions/${comp.code}/matches?dateFrom=${today}&dateTo=${future}&status=SCHEDULED,TIMED,POSTPONED`),
    ]);
    res.json({
      leagueId,
      last: (lastRes.data.matches ?? []).slice(-5).map(mapMatch),
      next: (nextRes.data.matches ?? []).slice(0, 10).map(mapMatch),
      stale: lastRes.stale || nextRes.stale,
    });
  } catch (err) {
    console.error(`[football/fixtures/${leagueId}]`, err);
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/football/match/:fixtureId ───────────────────────────────────────

footballRouter.get('/match/:fixtureId', requireAuth, async (req: AuthRequest, res: Response) => {
  const fixtureId = req.params.fixtureId;
  const cacheKey  = `match:${fixtureId}`;
  const cached    = cGet(cacheKey);
  if (cached) { res.json({ ...(cached as object), stale: false }); return; }

  try {
    const m   = await fdFetch<FDMatch>(`/matches/${fixtureId}`);
    const isLive    = LIVE_STATUSES.has(m.status);
    const isDone    = DONE_STATUSES.has(m.status);
    const ttl       = isDone ? 86_400_000 : 60_000;
    const homeScore = (isLive || isDone) ? m.score.fullTime.home : null;
    const awayScore = (isLive || isDone) ? m.score.fullTime.away : null;

    // Combine all events into a unified, sorted timeline
    const events: { minute: number; extra: number | null; teamId: number; type: string; detail: string; player: string; assist: string | null }[] = [];
    for (const g of m.goals ?? []) {
      events.push({ minute: g.minute, extra: g.injuryTime, teamId: g.team.id, type: 'Goal', detail: g.type === 'OWN_GOAL' ? 'Own Goal' : g.type === 'PENALTY' ? 'Penalty' : 'Normal Goal', player: g.scorer.name, assist: g.assist?.name ?? null });
    }
    for (const b of m.bookings ?? []) {
      events.push({ minute: b.minute, extra: null, teamId: b.team.id, type: 'Card', detail: b.card === 'YELLOW' ? 'Yellow Card' : b.card === 'RED' ? 'Red Card' : 'Yellow Red Card', player: b.player.name, assist: null });
    }
    for (const s of m.substitutions ?? []) {
      events.push({ minute: s.minute, extra: null, teamId: s.team.id, type: 'subst', detail: 'Substitution', player: s.playerIn.name, assist: s.playerOut.name });
    }
    events.sort((a, b) => a.minute - b.minute);

    const compInfo = COMP_BY_ID.get(m.competition.id);
    const result = {
      fixtureId: m.id,
      date:      m.utcDate,
      isLive,
      competition: { id: m.competition.id, name: m.competition.name, round: m.matchday != null ? `Matchday ${m.matchday}` : m.stage, flag: compInfo?.flag ?? '⚽', color: compInfo?.color ?? '#444' },
      status: { short: m.status, long: m.status, elapsed: m.minute ?? null },
      home: { id: m.homeTeam.id, name: m.homeTeam.name, logo: m.homeTeam.crest, score: homeScore },
      away: { id: m.awayTeam.id, name: m.awayTeam.name, logo: m.awayTeam.crest, score: awayScore },
      score: { halftime: m.score.halfTime, extratime: { home: null as number | null, away: null as number | null }, penalty: { home: null as number | null, away: null as number | null } },
      events,
      statistics: [] as { type: string; home: string | number | null; away: string | number | null }[],
      lineups: { home: null, away: null },
    };

    cSet(cacheKey, result, ttl);
    res.json({ ...result, stale: false });
  } catch (err) {
    console.error(`[football/match/${fixtureId}]`, err);
    const stale = cGetStale(cacheKey);
    if (stale) { res.json({ ...(stale as object), stale: true }); return; }
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /api/football/search?q= ──────────────────────────────────────────────

footballRouter.get('/search', requireAuth, async (req: AuthRequest, res: Response) => {
  const q = ((req.query.q as string) ?? '').trim();
  if (!q || q.length < 2) { res.json({ results: [] }); return; }
  try {
    const { data } = await cachedFdFetch<FDTeamSearch>(`search:${q.toLowerCase()}`, 10 * 60_000, `/teams?name=${encodeURIComponent(q)}`);
    res.json({ results: (data.teams ?? []).slice(0, 10).map(t => ({ teamId: t.id, name: t.name, logo: t.crest, country: t.area?.name ?? '' })) });
  } catch {
    res.json({ results: [] });
  }
});

// ── GET /api/football/favorites ──────────────────────────────────────────────

footballRouter.get('/favorites', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase.from('football_favorites').select('type, external_id, name, logo_url').eq('user_id', req.user!.id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  const rows = (data ?? []) as { type: string; external_id: number; name: string; logo_url: string | null }[];
  res.json({
    teams:        rows.filter(r => r.type === 'team').map(r => ({ teamId: r.external_id, name: r.name, logoUrl: r.logo_url })),
    competitions: rows.filter(r => r.type === 'competition').map(r => ({ leagueId: r.external_id, name: r.name })),
  });
});

footballRouter.post('/favorites/team', requireAuth, async (req: AuthRequest, res: Response) => {
  const { teamId, name, logoUrl } = req.body as { teamId: number; name: string; logoUrl?: string };
  if (!teamId || !name) { res.status(400).json({ error: 'teamId and name required' }); return; }
  const { error } = await supabase.from('football_favorites').upsert({ user_id: req.user!.id, type: 'team', external_id: teamId, name, logo_url: logoUrl ?? null }, { onConflict: 'user_id,type,external_id' });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

footballRouter.delete('/favorites/team/:teamId', requireAuth, async (req: AuthRequest, res: Response) => {
  const { error } = await supabase.from('football_favorites').delete().eq('user_id', req.user!.id).eq('type', 'team').eq('external_id', parseInt(req.params.teamId, 10));
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

footballRouter.post('/favorites/competition', requireAuth, async (req: AuthRequest, res: Response) => {
  const { leagueId, name } = req.body as { leagueId: number; name: string };
  if (!leagueId || !name) { res.status(400).json({ error: 'leagueId and name required' }); return; }
  const { error } = await supabase.from('football_favorites').upsert({ user_id: req.user!.id, type: 'competition', external_id: leagueId, name, logo_url: null }, { onConflict: 'user_id,type,external_id' });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

footballRouter.delete('/favorites/competition/:leagueId', requireAuth, async (req: AuthRequest, res: Response) => {
  const { error } = await supabase.from('football_favorites').delete().eq('user_id', req.user!.id).eq('type', 'competition').eq('external_id', parseInt(req.params.leagueId, 10));
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// Suppress unused import warning — COMP_BY_CODE is available for future use
void COMP_BY_CODE;
