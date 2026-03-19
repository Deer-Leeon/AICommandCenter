import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { broadcastToUser } from '../lib/sseRegistry.js';

export const wordleRouter = Router();

// ── Types ─────────────────────────────────────────────────────────────────────

interface LetterResult {
  letter: string;
  result: 'correct' | 'present' | 'absent';
}

interface GuessEntry {
  guess: string;
  results: LetterResult[];
}

interface GameStateRow {
  id: string;
  user_id: string;
  date: string;
  guesses: GuessEntry[];
  status: 'playing' | 'won' | 'lost';
  wordle_number: number | null;
  created_at: string;
  updated_at: string;
}

interface StatsRow {
  id: string;
  user_id: string;
  games_played: number;
  games_won: number;
  current_streak: number;
  max_streak: number;
  guess_distribution: Record<string, number>;
  last_played_date: string | null;
  created_at: string;
  updated_at: string;
}

// ── Validation word list (public-domain; loaded once at startup) ───────────────
// Used only to reject guesses that are not real English words.
// NEVER used as an answer source.

let validWords: Set<string> = new Set();

async function initWordList(): Promise<void> {
  try {
    const res = await fetch(
      'https://raw.githubusercontent.com/tabatkins/wordle-list/main/words',
      { signal: AbortSignal.timeout(12_000) },
    );
    if (res.ok) {
      const text = await res.text();
      validWords = new Set(
        text.split('\n')
          .map(w => w.trim().toLowerCase())
          .filter(w => w.length === 5 && /^[a-z]+$/.test(w)),
      );
      console.log(`✓ Wordle word list: ${validWords.size} words`);
    } else {
      console.warn('⚠️  Wordle word list: HTTP', res.status, '— accepting all 5-letter words');
    }
  } catch (err) {
    console.warn('⚠️  Wordle word list unavailable —', (err as Error).message);
  }
}

initWordList();

// ── NYT daily word cache ───────────────────────────────────────────────────────

interface DailyCache {
  date: string;       // YYYY-MM-DD UTC
  solution: string;   // lowercase — NEVER sent to frontend unless game over
  wordleNumber: number;
}

let dailyCache: DailyCache | null = null;

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

// Accept a YYYY-MM-DD date string from the client (their local date).
// Falls back to UTC today if missing or malformed.
function parseClientDate(raw: unknown): string {
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return todayUTC();
}

async function fetchDailyWord(dateStr: string): Promise<DailyCache | null> {
  if (dailyCache?.date === dateStr) return dailyCache;

  try {
    const res = await fetch(
      `https://www.nytimes.com/svc/wordle/v2/${dateStr}.json`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;

    const json = await res.json() as { solution?: string; days_since_launch?: number };
    if (!json.solution) return null;

    dailyCache = {
      date: dateStr,
      solution: json.solution.toLowerCase(),
      wordleNumber: json.days_since_launch ?? 0,
    };
    return dailyCache;
  } catch {
    return null;
  }
}

// ── Guess evaluation — NYT-accurate duplicate-letter handling ──────────────────
// Pass 1: mark correct positions.
// Pass 2: for each non-correct guess letter, mark present if the solution still
//         has an unmatched instance of that letter (greedy left-to-right).
// This ensures a letter is never marked more times than it appears in the solution.

function evaluateGuess(guess: string, solution: string): LetterResult[] {
  const results: LetterResult[] = Array.from({ length: 5 }, (_, i) => ({
    letter: guess[i],
    result: 'absent' as const,
  }));

  // Track unmatched solution letters for the present-check pass
  const remaining: Record<string, number> = {};
  for (let i = 0; i < 5; i++) {
    if (guess[i] !== solution[i]) {
      remaining[solution[i]] = (remaining[solution[i]] ?? 0) + 1;
    } else {
      results[i] = { letter: guess[i], result: 'correct' };
    }
  }

  for (let i = 0; i < 5; i++) {
    if (results[i].result !== 'correct') {
      const ch = guess[i];
      if ((remaining[ch] ?? 0) > 0) {
        results[i] = { letter: ch, result: 'present' };
        remaining[ch]--;
      }
    }
  }

  return results;
}

// ── Stats updater ─────────────────────────────────────────────────────────────

async function updateStats(
  userId: string,
  result: 'won' | 'lost',
  guessCount: number,
  today: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from('wordle_stats')
    .select('*')
    .eq('user_id', userId)
    .single();

  const s = existing as StatsRow | null;

  const yesterday = new Date(today + 'T00:00:00Z');
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const streakContinued = s?.last_played_date === yesterdayStr;
  const newStreak = result === 'won' ? (streakContinued ? (s?.current_streak ?? 0) + 1 : 1) : 0;

  const dist: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, ...(s?.guess_distribution ?? {}) };
  if (result === 'won') {
    const key = String(guessCount);
    dist[key] = (Number(dist[key]) || 0) + 1;
  }

  await supabase.from('wordle_stats').upsert({
    user_id:            userId,
    games_played:       (s?.games_played ?? 0) + 1,
    games_won:          (s?.games_won ?? 0) + (result === 'won' ? 1 : 0),
    current_streak:     newStreak,
    max_streak:         Math.max(s?.max_streak ?? 0, newStreak),
    guess_distribution: dist,
    last_played_date:   today,
    updated_at:         new Date().toISOString(),
  }, { onConflict: 'user_id' });
}

// ── GET /api/wordle/daily ─────────────────────────────────────────────────────
// Returns puzzle metadata only — solution is never exposed here.

wordleRouter.get('/daily', requireAuth, async (req: AuthRequest, res: Response) => {
  const today = parseClientDate((req as AuthRequest & { query: Record<string, unknown> }).query.date);
  const daily = await fetchDailyWord(today);
  if (!daily) {
    res.status(503).json({ error: "Could not load today's Wordle" });
    return;
  }
  res.json({ date: daily.date, wordleNumber: daily.wordleNumber });
});

// ── POST /api/wordle/guess ────────────────────────────────────────────────────

wordleRouter.post('/guess', requireAuth, async (req: AuthRequest, res: Response) => {
  const { guess, date: clientDate } = req.body as { guess?: string; date?: string };

  if (!guess || typeof guess !== 'string' || guess.length !== 5 || !/^[a-zA-Z]+$/.test(guess)) {
    res.status(400).json({ error: 'Guess must be exactly 5 letters' });
    return;
  }

  const normalized = guess.toLowerCase();

  if (validWords.size > 0 && !validWords.has(normalized)) {
    res.status(422).json({ error: 'Not in word list' });
    return;
  }

  const today = parseClientDate(clientDate);
  const daily = await fetchDailyWord(today);
  if (!daily) {
    res.status(503).json({ error: "Could not load today's Wordle" });
    return;
  }

  // Load current game state for this user/date
  const { data: stateData } = await supabase
    .from('wordle_game_state')
    .select('*')
    .eq('user_id', req.user!.id)
    .eq('date', today)
    .single();

  const current = stateData as GameStateRow | null;

  if (current?.status === 'won' || current?.status === 'lost') {
    res.status(409).json({ error: 'Game already over' });
    return;
  }

  const existingGuesses: GuessEntry[] = current?.guesses ?? [];
  if (existingGuesses.length >= 6) {
    res.status(409).json({ error: 'Game already over' });
    return;
  }

  const results = evaluateGuess(normalized, daily.solution);
  const isCorrect = results.every(r => r.result === 'correct');
  const newGuesses = [...existingGuesses, { guess: normalized, results }];
  const newStatus: 'playing' | 'won' | 'lost' =
    isCorrect ? 'won' : newGuesses.length >= 6 ? 'lost' : 'playing';

  // Persist game state
  await supabase.from('wordle_game_state').upsert({
    user_id:       req.user!.id,
    date:          today,
    guesses:       newGuesses,
    status:        newStatus,
    wordle_number: daily.wordleNumber,
    updated_at:    new Date().toISOString(),
  }, { onConflict: 'user_id,date' });

  if (newStatus === 'won' || newStatus === 'lost') {
    await updateStats(req.user!.id, newStatus, newGuesses.length, today);
  }

  // Push updated state to all other devices logged in with the same account
  // so cross-device play stays in sync in real-time.
  broadcastToUser(req.user!.id, {
    type:     'wordle:state_updated',
    date:     today,
    guesses:  newGuesses,
    status:   newStatus,
    solution: newStatus !== 'playing' ? daily.solution : undefined,
  });

  res.json({
    results,
    status: newStatus,
    // Only reveal the solution when the game is over
    solution: newStatus !== 'playing' ? daily.solution : undefined,
  });
});

// ── GET /api/wordle/state ─────────────────────────────────────────────────────

wordleRouter.get('/state', requireAuth, async (req: AuthRequest, res: Response) => {
  const today = parseClientDate((req as AuthRequest & { query: Record<string, unknown> }).query.date);
  const daily = await fetchDailyWord(today);

  const [stateResult, statsResult] = await Promise.all([
    supabase
      .from('wordle_game_state')
      .select('*')
      .eq('user_id', req.user!.id)
      .eq('date', today)
      .single(),
    supabase
      .from('wordle_stats')
      .select('*')
      .eq('user_id', req.user!.id)
      .single(),
  ]);

  const gameState = stateResult.data as GameStateRow | null;
  const statsRow  = statsResult.data as StatsRow | null;
  const gameOver  = gameState?.status === 'won' || gameState?.status === 'lost';

  res.json({
    date:         today,
    wordleNumber: daily?.wordleNumber ?? null,
    guesses:      gameState?.guesses ?? [],
    status:       gameState?.status  ?? 'playing',
    solution:     gameOver ? daily?.solution : undefined,
    stats: statsRow ? {
      gamesPlayed:        statsRow.games_played,
      gamesWon:           statsRow.games_won,
      currentStreak:      statsRow.current_streak,
      maxStreak:          statsRow.max_streak,
      guessDistribution:  statsRow.guess_distribution,
      lastPlayedDate:     statsRow.last_played_date,
    } : null,
  });
});

// ── DELETE /api/wordle/state ──────────────────────────────────────────────────
// Resets today's game for the current user (deletes the game_state row).
// Stats are NOT rolled back — this is intentional; it's a debug/retry tool.

wordleRouter.delete('/state', requireAuth, async (req: AuthRequest, res: Response) => {
  const today = parseClientDate((req as AuthRequest & { query: Record<string, unknown> }).query.date);

  const { error } = await supabase
    .from('wordle_game_state')
    .delete()
    .eq('user_id', req.user!.id)
    .eq('date', today);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ success: true });
});

// ── GET /api/wordle/friends ───────────────────────────────────────────────────
// Returns today's Wordle results for all actively connected friends.
// Guesses are stripped to result-only (no letters) so this never leaks the
// solution to a friend who hasn't finished yet.

wordleRouter.get('/friends', requireAuth, async (req: AuthRequest, res: Response) => {
  const today  = parseClientDate((req as AuthRequest & { query: Record<string, unknown> }).query.date);
  const userId = req.user!.id;

  const { data: connectionsData } = await supabase
    .from('connections')
    .select('user_id_a, user_id_b')
    .or(`user_id_a.eq.${userId},user_id_b.eq.${userId}`)
    .eq('status', 'accepted');

  if (!connectionsData || connectionsData.length === 0) {
    res.json([]);
    return;
  }

  const partnerIds: string[] = (connectionsData as Array<{ user_id_a: string; user_id_b: string }>)
    .map(c => c.user_id_a === userId ? c.user_id_b : c.user_id_a);

  const [statesResult, profilesResult] = await Promise.all([
    supabase
      .from('wordle_game_state')
      .select('user_id, guesses, status')
      .in('user_id', partnerIds)
      .eq('date', today),
    supabase
      .from('profiles')
      .select('user_id, username, display_name')
      .in('user_id', partnerIds),
  ]);

  const statesByUser = new Map<string, { guesses: GuessEntry[]; status: string }>();
  for (const s of (statesResult.data ?? []) as Array<{ user_id: string; guesses: GuessEntry[]; status: string }>) {
    statesByUser.set(s.user_id, { guesses: s.guesses, status: s.status });
  }

  const results = ((profilesResult.data ?? []) as Array<{ user_id: string; username: string | null; display_name: string | null }>)
    .map(p => {
      const state  = statesByUser.get(p.user_id);
      const isDone = state?.status === 'won' || state?.status === 'lost';
      return {
        userId:      p.user_id,
        username:    p.username,
        displayName: p.display_name ?? p.username ?? 'Unknown',
        status:      (state?.status ?? null) as 'won' | 'lost' | 'playing' | null,
        guessCount:  isDone ? state!.guesses.length : null,
        // Strip letters — only send result type, never the actual guess character
        emojiRows:   isDone
          ? state!.guesses.map(g => g.results.map(r => r.result))
          : [],
      };
    });

  res.json(results);
});

// ── POST /api/wordle/state ────────────────────────────────────────────────────
// Auxiliary upsert — primarily used to sync state for edge-case recovery.

wordleRouter.post('/state', requireAuth, async (req: AuthRequest, res: Response) => {
  const { guesses, status, wordleNumber, date: clientDate } = req.body as {
    guesses?: GuessEntry[];
    status?: 'playing' | 'won' | 'lost';
    wordleNumber?: number;
    date?: string;
  };
  const today = parseClientDate(clientDate);

  const { error } = await supabase.from('wordle_game_state').upsert({
    user_id:       req.user!.id,
    date:          today,
    guesses:       guesses ?? [],
    status:        status  ?? 'playing',
    wordle_number: wordleNumber ?? null,
    updated_at:    new Date().toISOString(),
  }, { onConflict: 'user_id,date' });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ success: true });
});
