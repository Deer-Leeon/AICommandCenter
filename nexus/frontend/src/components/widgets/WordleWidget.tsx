import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../../lib/api';
import { useWidgetReady } from '../../hooks/useWidgetReady';
import { useConnectionRefresh } from '../../hooks/useConnectionRefresh';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LetterResult {
  letter: string;
  result: 'correct' | 'present' | 'absent';
}

interface GuessEntry {
  guess: string;
  results: LetterResult[];
}

interface WordleStats {
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  maxStreak: number;
  guessDistribution: Record<string, number>;
  lastPlayedDate: string | null;
}

interface FriendResult {
  userId:      string;
  username:    string | null;
  displayName: string;
  status:      'won' | 'lost' | 'playing' | null;
  guessCount:  number | null;
  emojiRows:   Array<Array<'correct' | 'present' | 'absent'>>;
}

interface WordleWidgetProps {
  onClose: () => void;
}

// ── Layout constants ──────────────────────────────────────────────────────────

const TILE_GAP   = 5;   // gap between tiles (px)
const KEY_GAP    = 4;   // gap between keys in a row (px)
const KEY_ROW_GAP = 5;  // gap between keyboard rows (px)
const KEY_H      = 36;  // key height (px)
// KB_PAD_H reserved for future keyboard horizontal padding adjustments
const KB_PAD_V   = 10;  // vertical padding on keyboard section (px each side)
const BOARD_PAD  = 10;  // padding inside board area (px each side)
const HEADER_H   = 40;  // estimated header height (px)

// ── Game constants ────────────────────────────────────────────────────────────

const KEYBOARD_ROWS = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['ENTER','Z','X','C','V','B','N','M','⌫'],
];

const WIN_MESSAGES = ['Genius','Magnificent','Impressive','Splendid','Great','Phew!'];
const RESULT_PRIORITY: Record<string, number> = { correct: 3, present: 2, absent: 1 };

const RESULT_EMOJI: Record<'correct' | 'present' | 'absent', string> = {
  correct: '🟩',
  present: '🟨',
  absent:  '⬛',
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Returns today's date in the user's LOCAL timezone as YYYY-MM-DD. */
function localDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function computeKeyStates(
  guesses: GuessEntry[],
): Record<string, 'correct' | 'present' | 'absent'> {
  const s: Record<string, 'correct' | 'present' | 'absent'> = {};
  for (const g of guesses) {
    for (const { letter, result } of g.results) {
      const k = letter.toUpperCase();
      if (!s[k] || RESULT_PRIORITY[result] > RESULT_PRIORITY[s[k]]) s[k] = result;
    }
  }
  return s;
}

function resultColor(r: 'correct' | 'present' | 'absent', dark: boolean) {
  if (r === 'correct') return dark ? '#538d4e' : '#6aaa64';
  if (r === 'present') return dark ? '#b59f3b' : '#c9b458';
  return dark ? '#3a3a3c' : '#787c7e';
}

function keyBg(state: 'correct' | 'present' | 'absent' | undefined, dark: boolean) {
  if (state === 'correct') return dark ? '#538d4e' : '#6aaa64';
  if (state === 'present') return dark ? '#b59f3b' : '#c9b458';
  if (state === 'absent')  return dark ? '#3a3a3c' : '#787c7e';
  return dark ? '#818384' : '#d3d6da';
}

// ── CSS (animations) ──────────────────────────────────────────────────────────

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@700&display=swap');

@keyframes wdlPop {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.1); }
  100% { transform: scale(1); }
}

/* First half of the flip: tile rotates to edge (ease-in feels natural slowing) */
@keyframes wdlFlipIn {
  from { transform: perspective(250px) rotateX(0deg);
         background: var(--wt-pre-bg); border-color: var(--wt-pre-bd); color: var(--wt-pre-fg); }
  to   { transform: perspective(250px) rotateX(-90deg);
         background: var(--wt-pre-bg); border-color: var(--wt-pre-bd); color: var(--wt-pre-fg); }
}

/* Second half: tile opens back up revealing result color (ease-out for snap) */
@keyframes wdlFlipOut {
  from { transform: perspective(250px) rotateX(-90deg);
         background: var(--wt-res); border-color: var(--wt-res); color: #fff; }
  to   { transform: perspective(250px) rotateX(0deg);
         background: var(--wt-res); border-color: var(--wt-res); color: #fff; }
}

@keyframes wdlShake {
  0%,100% { transform: translateX(0); }
  15%     { transform: translateX(-5px); }
  35%     { transform: translateX(5px); }
  55%     { transform: translateX(-5px); }
  75%     { transform: translateX(5px); }
  90%     { transform: translateX(-3px); }
}

@keyframes wdlBounce {
  0%,100% { transform: translateY(0); }
  40%     { transform: translateY(-22px); }
  60%     { transform: translateY(-6px); }
  80%     { transform: translateY(-16px); }
}

@keyframes wdlFadeSlide {
  from { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(0.95); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0)    scale(1); }
}

@keyframes wdlModalIn {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to   { opacity: 1; transform: scale(1)    translateY(0); }
}
`;

// ── Component ─────────────────────────────────────────────────────────────────

export function WordleWidget({ onClose: _onClose }: WordleWidgetProps) {
  const [isDark, setIsDark] = useState(
    () => !window.matchMedia('(prefers-color-scheme: light)').matches,
  );

  // Game state
  const [guesses,   setGuesses]   = useState<GuessEntry[]>([]);
  const [input,     setInput]     = useState('');
  const [status,    setStatus]    = useState<'loading'|'error'|'playing'|'won'|'lost'>('loading');
  const [wordleNum, setWordleNum] = useState<number | null>(null);
  const [solution,  setSolution]  = useState<string | null>(null);
  const [stats,     setStats]     = useState<WordleStats | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const [keyMap,      setKeyMap]      = useState<Record<string, 'correct'|'present'|'absent'>>({});
  const [flippingRow, setFlippingRow] = useState<number | null>(null);
  const [revealedRows,setRevealedRows]= useState<Set<number>>(new Set());
  const [shakingRow,  setShakingRow]  = useState<number | null>(null);
  const [bouncingRow, setBouncingRow] = useState<number | null>(null);
  const [poppingCell, setPoppingCell] = useState<string | null>(null);

  const [toast,        setToast]        = useState<{msg:string;persist?:boolean;id:number}|null>(null);
  const [showModal,    setShowModal]    = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [resetting,    setResetting]    = useState(false);
  const [countdown,    setCountdown]    = useState('');

  const [modalTab,       setModalTab]       = useState<'stats' | 'friends'>('stats');
  const [friendResults,  setFriendResults]  = useState<FriendResult[] | null>(null);
  const [_friendsLoading, _setFriendsLoading] = useState(false);

  // Sizing state — starts at 0 so nothing renders until ResizeObserver measures
  const [tileSize,    setTileSize]    = useState(0);
  const [keyW,        setKeyW]        = useState(38);
  const [wideKeyW,    setWideKeyW]    = useState(58);

  // Refs
  const rootRef      = useRef<HTMLDivElement>(null);
  const boardAreaRef = useRef<HTMLDivElement>(null);
  const toastTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedDate   = useRef('');

  // Stable refs for callbacks
  const guessesRef   = useRef<GuessEntry[]>([]);
  const inputRef     = useRef('');
  const statusRef    = useRef<string>('loading');
  const flippingRef  = useRef<number | null>(null);
  const showModalRef        = useRef(false);
  const friendsPreloadedRef = useRef(false); // true when loadState/triggerFlip pre-fetched friends
  const friendResultsRef    = useRef<FriendResult[] | null>(null);
  guessesRef.current      = guesses;
  inputRef.current        = input;
  statusRef.current       = status;
  flippingRef.current     = flippingRow;
  showModalRef.current    = showModal;
  friendResultsRef.current = friendResults;

  useWidgetReady('wordle', hasLoaded);

  // ── ResizeObserver for layout sizing ──────────────────────────────────────
  useEffect(() => {
    function measure() {
      const root  = rootRef.current;
      const board = boardAreaRef.current;
      if (!root || !board) return;

      const rw = root.clientWidth;
      const bw = board.clientWidth;
      const bh = board.clientHeight;

      // Board: fit 5 cols × 6 rows of square tiles with gaps
      const maxByW = (bw - BOARD_PAD * 2 - 4 * TILE_GAP) / 5;
      const maxByH = (bh - BOARD_PAD * 2 - 5 * TILE_GAP) / 6;
      const ts = Math.max(10, Math.floor(Math.min(maxByW, maxByH)));
      setTileSize(ts);

      // Keyboard: use 80% of container width so ~10% margin shows on each side
      const kbW = rw * 0.80;
      const kw  = Math.max(16, Math.floor((kbW - 9 * KEY_GAP) / 10));
      setKeyW(kw);
      setWideKeyW(Math.floor(kw * 1.5));
    }

    const obs = new ResizeObserver(measure);
    if (rootRef.current)      obs.observe(rootRef.current);
    if (boardAreaRef.current) obs.observe(boardAreaRef.current);
    measure();
    return () => obs.disconnect();
  }, []);

  // ── Theme ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const h = (e: MediaQueryListEvent) => setIsDark(!e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  // ── Toast ──────────────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string, persist = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, persist, id: Date.now() });
    if (!persist) toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);

  // ── Load state ─────────────────────────────────────────────────────────────
  const loadState = useCallback(async () => {
    setStatus('loading');
    try {
      const today = localDateStr();
      // Fetch game state and friends data in parallel so the stats modal
      // can open immediately with all data ready — no sequential waterfall.
      const [stateRes, friendsRes] = await Promise.all([
        apiFetch(`/api/wordle/state?date=${today}`),
        apiFetch(`/api/wordle/friends?date=${today}`),
      ]);

      if (!stateRes.ok) { setStatus('error'); return; }
      const data = await stateRes.json();

      loadedDate.current = data.date ?? today;
      setWordleNum(data.wordleNumber ?? null);
      const loaded: GuessEntry[] = data.guesses ?? [];
      setGuesses(loaded);
      setStatus(data.status ?? 'playing');
      setSolution(data.solution ?? null);
      setStats(data.stats ?? null);
      setRevealedRows(new Set(loaded.map((_: GuessEntry, i: number) => i)));
      setKeyMap(computeKeyStates(loaded));

      // Always cache friends data (already fetched in parallel) so clicking
      // Stats at any point — mid-game or after finishing — shows instantly.
      const friendData: FriendResult[] = friendsRes.ok ? await friendsRes.json() : [];
      setFriendResults(friendData);
      friendsPreloadedRef.current = true;

      if (data.status === 'won' || data.status === 'lost') {
        setShowModal(true);
      }
    } catch {
      setStatus('error');
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => { loadState(); }, [loadState]);

  // ── Midnight reset ─────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const today = localDateStr();
      if (loadedDate.current && today !== loadedDate.current)
        showToast('🟩 New Wordle ready — click to refresh', true);
    }, 30_000);
    return () => clearInterval(id);
  }, [showToast]);

  // ── Modal countdown ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!showModal) return;
    function tick() {
      const now = new Date();
      // Count to LOCAL midnight — that's when the date flips for this user
      const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const d = localMidnight.getTime() - now.getTime();
      const h  = String(Math.floor(d / 3_600_000)).padStart(2, '0');
      const mn = String(Math.floor((d % 3_600_000) / 60_000)).padStart(2, '0');
      const s  = String(Math.floor((d % 60_000) / 1_000)).padStart(2, '0');
      setCountdown(`${h}:${mn}:${s}`);
    }
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [showModal]);

  // ── Friends data fetching ──────────────────────────────────────────────────
  // Stable fetch function — safe to call from multiple places
  const fetchFriends = useCallback(() => {
    // No loading spinner on re-fetches — data updates silently in the background.
    // The spinner only shows when friendResults === null (first load with no data).
    apiFetch(`/api/wordle/friends?date=${localDateStr()}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: FriendResult[]) => setFriendResults(data))
      .catch(() => {}); // swallow errors on background refreshes
  }, []);

  // Show modal — fetch friends only if we have absolutely no data yet
  useEffect(() => {
    if (!showModal) return;
    setModalTab('stats');
    // Pre-loaded by loadState or triggerFlip — consume the flag and bail out
    if (friendsPreloadedRef.current) {
      friendsPreloadedRef.current = false;
      return;
    }
    // Data already cached from a previous fetch — show immediately, no re-fetch
    if (friendResultsRef.current !== null) return;
    // Truly no data yet (e.g., very first open before loadState finished)
    fetchFriends();
  }, [showModal, fetchFriends]);

  // Auto-sync: silently re-fetch when connection state changes via SSE.
  // Never wipe existing data — new results swap in when the fetch completes,
  // so the Friends tab is always instantly visible (no loading flash).
  useConnectionRefresh(useCallback(() => {
    fetchFriends();
  }, [fetchFriends]));

  // ── Flip animation ─────────────────────────────────────────────────────────
  const triggerFlip = useCallback((
    rowIdx: number,
    next: GuessEntry[],
    newStatus: 'playing'|'won'|'lost',
    sol: string | null,
  ) => {
    setFlippingRow(rowIdx);
    setTimeout(() => {
      setFlippingRow(null);
      setRevealedRows(prev => new Set([...prev, rowIdx]));
      setKeyMap(computeKeyStates(next));
      if (newStatus === 'won') {
        showToast(WIN_MESSAGES[next.length - 1] ?? 'Genius');
        setBouncingRow(rowIdx);
        setTimeout(() => setBouncingRow(null), 1600);
        // Start friends fetch now — 2 s head-start means data is ready when modal opens
        friendsPreloadedRef.current = true;
        setFriendResults(null);
        apiFetch(`/api/wordle/friends?date=${localDateStr()}`)
          .then(r => r.ok ? r.json() : [])
          .then((d: FriendResult[]) => setFriendResults(d))
          .catch(() => setFriendResults([]));
        setTimeout(() => setShowModal(true), 2000);
      } else if (newStatus === 'lost') {
        if (sol) showToast(sol.toUpperCase()); // brief fade-out toast; modal shows it permanently
        // Same pre-fetch strategy for the lost path
        friendsPreloadedRef.current = true;
        setFriendResults(null);
        apiFetch(`/api/wordle/friends?date=${localDateStr()}`)
          .then(r => r.ok ? r.json() : [])
          .then((d: FriendResult[]) => setFriendResults(d))
          .catch(() => setFriendResults([]));
        setTimeout(() => setShowModal(true), 2000);
      }
    }, 4 * 300 + 500 + 50);  // last tile: delay 1200ms + 500ms duration = 1750ms
  }, [showToast]);

  // ── Submit guess ───────────────────────────────────────────────────────────
  const submitGuess = useCallback(async () => {
    if (statusRef.current !== 'playing' || flippingRef.current !== null) return;
    const word = inputRef.current;
    const cur  = guessesRef.current;

    if (word.length < 5) {
      showToast('Not enough letters');
      setShakingRow(cur.length);
      setTimeout(() => setShakingRow(null), 650);
      return;
    }

    try {
      const res = await apiFetch('/api/wordle/guess', {
        method: 'POST',
        body: JSON.stringify({ guess: word, date: localDateStr() }),
      });
      if (res.status === 422) {
        showToast('Not in word list');
        setShakingRow(cur.length);
        setTimeout(() => setShakingRow(null), 650);
        return;
      }
      if (!res.ok) { showToast('Something went wrong'); return; }

      const data  = await res.json();
      const entry: GuessEntry = { guess: word.toLowerCase(), results: data.results };
      const next  = [...cur, entry];
      setGuesses(next);
      setInput('');
      setStatus(data.status);
      if (data.solution) setSolution(data.solution);

      if (data.status === 'won' || data.status === 'lost') {
        apiFetch(`/api/wordle/state?date=${localDateStr()}`).then(r => r.json()).then(d => {
          if (d.stats) setStats(d.stats);
        }).catch(() => {});
      }
      triggerFlip(cur.length, next, data.status, data.solution ?? null);
    } catch {
      showToast('Network error');
    }
  }, [showToast, triggerFlip]);

  // ── Key handler ────────────────────────────────────────────────────────────
  const handleKey = useCallback((key: string) => {
    if (statusRef.current !== 'playing' || flippingRef.current !== null) return;
    if (key === 'ENTER') { submitGuess(); return; }
    if (key === '⌫' || key === 'BACKSPACE') {
      const c = inputRef.current;
      if (c.length > 0) setInput(c.slice(0, -1));
      return;
    }
    if (/^[A-Z]$/.test(key)) {
      const c = inputRef.current;
      if (c.length >= 5) return;
      const col = c.length;
      const row = guessesRef.current.length;
      setInput(c + key.toLowerCase());
      const ck = `${row},${col}`;
      setPoppingCell(ck);
      setTimeout(() => setPoppingCell(p => p === ck ? null : p), 100);
    }
  }, [submitGuess]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter')     handleKey('ENTER');
      else if (e.key === 'Backspace') handleKey('BACKSPACE');
      else if (/^[a-zA-Z]$/.test(e.key)) handleKey(e.key.toUpperCase());
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleKey]);

  // ── Reset game ─────────────────────────────────────────────────────────────
  const resetGame = useCallback(async () => {
    setResetting(true);
    try {
      await apiFetch(`/api/wordle/state?date=${localDateStr()}`, { method: 'DELETE' });
      setShowSettings(false);
      setShowModal(false);
      await loadState();
    } catch {
      showToast('Reset failed');
    } finally {
      setResetting(false);
    }
  }, [loadState, showToast]);

  // ── Share result ───────────────────────────────────────────────────────────
  const handleShare = useCallback(() => {
    const score = status === 'won' ? guesses.length : 'X';
    const header = wordleNum != null
      ? `Wordle #${wordleNum} — ${score}/6`
      : `My Wordle Attempts — ${score}/6`;

    const grid = guesses
      .map(g => g.results.map(r => RESULT_EMOJI[r.result]).join(''))
      .join('\n');

    const text = `${header}\n\n${grid}`;

    navigator.clipboard.writeText(text)
      .then(() => showToast('Copied!'))
      .catch(() => showToast('Could not copy'));
  }, [guesses, status, wordleNum, showToast]);

  // ── Derived colors ─────────────────────────────────────────────────────────
  const bg           = isDark ? '#121213' : '#ffffff';
  const fg           = isDark ? '#ffffff' : '#1a1a1b';
  const emptyBd      = isDark ? '#3a3a3c' : '#d3d6da';
  const activeBd     = isDark ? '#565758' : '#878a8c'; // NYT exact value — subtle, not white
  const divider      = isDark ? '#3a3a3c' : '#e6e6e6';
  const mutedFg      = isDark ? '#818384' : '#878a8c';
  const keyFg        = isDark ? '#ffffff' : '#1a1a1b';
  const tileFontSize = Math.max(14, Math.min(28, Math.floor(tileSize * 0.46)));

  // ── Tile renderer ──────────────────────────────────────────────────────────
  function renderTile(rowIdx: number, colIdx: number) {
    const submitted  = rowIdx < guesses.length;
    const isFlipping = flippingRow === rowIdx;
    const isRevealed = revealedRows.has(rowIdx);
    const isBouncing = bouncingRow === rowIdx;
    const isCurrent  = rowIdx === guesses.length;
    const ck         = `${rowIdx},${colIdx}`;
    const isPopping  = poppingCell === ck;

    let tileBg   = 'transparent';
    let tileBd   = `2px solid ${emptyBd}`;
    let tileFg   = fg;
    let anim: string | undefined;
    let extra: Record<string, string> = {};
    let letter   = '';

    if (submitted && isFlipping) {
      const rc    = resultColor(guesses[rowIdx].results[colIdx].result, isDark);
      const delay = colIdx * 300;  // 300 ms NYT-style stagger between tiles
      letter = guesses[rowIdx].guess[colIdx].toUpperCase();
      // Use emptyBd (subtle) so no bright border flashes before the flip
      tileBd = `2px solid ${emptyBd}`;
      // backwards on FlipIn: show FROM keyframe during delay so letter stays visible.
      // forwards (not both!) on FlipOut: no backwards fill so FlipOut's -90deg state
      // doesn't override FlipIn during FlipIn's active period.
      anim   = `wdlFlipIn 250ms ease-in ${delay}ms backwards, wdlFlipOut 250ms ease-out ${delay + 250}ms forwards`;
      extra  = { '--wt-pre-bg': 'transparent', '--wt-pre-bd': emptyBd, '--wt-pre-fg': fg, '--wt-res': rc };
    } else if (submitted && isRevealed) {
      const rc = resultColor(guesses[rowIdx].results[colIdx].result, isDark);
      letter = guesses[rowIdx].guess[colIdx].toUpperCase();
      tileBg = rc; tileBd = `2px solid ${rc}`; tileFg = 'white';
      if (isBouncing) anim = `wdlBounce 600ms ease ${colIdx * 100}ms both`;
    } else if (isCurrent) {
      const ch = input[colIdx];
      if (ch) {
        letter = ch.toUpperCase();
        tileBd = `2px solid ${activeBd}`;
        if (isPopping) anim = 'wdlPop 80ms ease';
      }
    }

    return (
      <div
        key={`t-${rowIdx}-${colIdx}`}
        style={{
          width:          tileSize,
          height:         tileSize,
          flexShrink:     0,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          background:     tileBg,
          border:         tileBd,
          color:          tileFg,
          fontSize:       tileFontSize,
          fontWeight:     700,
          lineHeight:     1,
          animation:      anim,
          userSelect:     'none',
          boxSizing:      'border-box',
          ...(extra as React.CSSProperties),
        }}
      >
        {letter}
      </div>
    );
  }

  // ── Keyboard renderer ──────────────────────────────────────────────────────
  function renderKeyboard() {
    const keyFontSize = Math.max(10, Math.min(13, Math.floor(keyW * 0.32)));
    return (
      <div
        style={{
          flexShrink:     0,
          width:          '100%',
          overflow:       'hidden',
          paddingTop:     KB_PAD_V,
          paddingBottom:  KB_PAD_V,
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          gap:            KEY_ROW_GAP,
          boxSizing:      'border-box',
        }}
      >
        {KEYBOARD_ROWS.map((row, ri) => (
          <div key={ri} style={{ display: 'flex', gap: KEY_GAP }}>
            {row.map(k => {
              const wide      = k === 'ENTER' || k === '⌫';
              const kbg       = keyBg(keyMap[k], isDark);
              const hasResult = !!keyMap[k];
              const kwidth    = wide ? wideKeyW : keyW;
              return (
                <button
                  key={k}
                  onMouseDown={e => { e.preventDefault(); handleKey(k === '⌫' ? 'BACKSPACE' : k); }}
                  style={{
                    width:                   kwidth,
                    minWidth:                kwidth,
                    height:                  KEY_H,
                    background:              kbg,
                    color:                   hasResult ? 'white' : keyFg,
                    border:                  'none',
                    borderRadius:            4,
                    fontSize:                wide ? Math.max(7, keyFontSize - 3) : keyFontSize,
                    fontWeight:              700,
                    fontFamily:              'inherit',
                    cursor:                  'pointer',
                    display:                 'flex',
                    alignItems:              'center',
                    justifyContent:          'center',
                    userSelect:              'none',
                    transition:              'background 0.15s',
                    WebkitTapHighlightColor: 'transparent',
                    touchAction:             'manipulation',
                    flexShrink:              0,
                  }}
                >
                  {k}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  // ── Stats modal ────────────────────────────────────────────────────────────
  function renderModal() {
    const {
      gamesPlayed = 0, gamesWon = 0,
      currentStreak = 0, maxStreak = 0,
      guessDistribution = {},
    } = stats ?? {};
    const winPct   = gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : 0;
    const hasFriends = friendResults !== null && friendResults.length > 0;
    const accentGreen = isDark ? '#538d4e' : '#6aaa64';

    // ── Friends tab content ───────────────────────────────────────────────
    function renderFriendsTab() {
      if (friendResults === null) {
        return (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: mutedFg, fontSize: 12 }}>Loading…</span>
          </div>
        );
      }
      // friendsLoading may be true during a background refresh — keep showing
      // existing data silently rather than replacing it with a spinner.
      return (
        <div style={{
          flex: 1, overflowY: 'auto', width: '100%', minHeight: 0,
          display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4,
        }}>
          {friendResults.map(friend => {
            const initials = (friend.displayName || '?')
              .split(' ')
              .map((w: string) => w[0] ?? '')
              .join('')
              .slice(0, 2)
              .toUpperCase();
            const avatarBg =
              friend.status === 'won'  ? accentGreen :
              friend.status === 'lost' ? (isDark ? '#b59f3b' : '#c9b458') :
              (isDark ? '#3a3a3c' : '#c0c0c0');
            const scoreStr =
              friend.status === 'won'     ? `${friend.guessCount}/6` :
              friend.status === 'lost'    ? 'X/6' :
              friend.status === 'playing' ? 'Playing…' : '—';
            const scoreColor =
              friend.status === 'won'  ? accentGreen :
              friend.status === 'lost' ? (isDark ? '#b59f3b' : '#c9b458') :
              mutedFg;

            return (
              <div
                key={friend.userId}
                style={{
                  background:   isDark ? '#1e1e1f' : '#f5f5f5',
                  border:       `1px solid ${divider}`,
                  borderRadius: 8,
                  padding:      '10px 12px',
                }}
              >
                {/* Top row: avatar + name + score */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: avatarBg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: 'white', flexShrink: 0,
                    letterSpacing: '0.02em',
                  }}>
                    {initials}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12, fontWeight: 700, color: fg, lineHeight: 1.2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {friend.displayName}
                    </div>
                    {friend.username && (
                      <div style={{ fontSize: 9, color: mutedFg, marginTop: 1 }}>
                        @{friend.username}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: scoreColor, flexShrink: 0 }}>
                    {scoreStr}
                  </div>
                </div>

                {/* Emoji grid — only when game is finished */}
                {friend.emojiRows.length > 0 && (
                  <div style={{
                    marginTop: 8, paddingLeft: 42,
                    display: 'flex', flexDirection: 'column', gap: 2,
                  }}>
                    {friend.emojiRows.map((row, ri) => (
                      <div key={ri} style={{ fontSize: 14, lineHeight: 1, letterSpacing: '1px' }}>
                        {row.map(r => RESULT_EMOJI[r]).join('')}
                      </div>
                    ))}
                  </div>
                )}

                {/* Still playing label */}
                {friend.status === 'playing' && (
                  <div style={{ marginTop: 6, paddingLeft: 42, fontSize: 10, color: mutedFg, fontStyle: 'italic' }}>
                    Still playing today's puzzle…
                  </div>
                )}

                {/* Hasn't played label */}
                {!friend.status && (
                  <div style={{ marginTop: 6, paddingLeft: 42, fontSize: 10, color: mutedFg, fontStyle: 'italic' }}>
                    Hasn't played today yet
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }

    // ── Stats tab content ─────────────────────────────────────────────────
    function renderStatsTab() {
      return (
        <div style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 0 }}>
          {/* 4 stat boxes — vertically centred between the tab bar and the divider */}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center',
                        width: '100%', flex: '0 0 auto', padding: '10px 0' }}>
            {[
              { v: gamesPlayed,   l: 'Played'  },
              { v: winPct,        l: 'Win %'   },
              { v: currentStreak, l: 'Current\nStreak' },
              { v: maxStreak,     l: 'Max\nStreak'     },
            ].map(({ v, l }) => (
              <div key={l} style={{ textAlign: 'center', flex: 1,
                                    display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: fg, lineHeight: 1 }}>{v}</div>
                <div style={{ fontSize: 8, color: mutedFg, whiteSpace: 'pre', lineHeight: 1.3, marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>

          <div style={{ width: '100%', height: 1, background: divider, marginBottom: 5 }} />

          <div style={{ fontSize: 9, fontWeight: 700, color: fg, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4, alignSelf: 'flex-start' }}>
            Guess Distribution
          </div>

          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
            {(() => {
              const losses = Math.max(0, gamesPlayed - gamesWon);
              const rows: Array<{ label: string; count: number; isLoss?: boolean; isCur?: boolean }> = [
                ...[1,2,3,4,5,6].map(n => ({
                  label: String(n),
                  count: Number(guessDistribution[String(n)] ?? 0),
                  isCur: status === 'won' && guesses.length === n,
                })),
                { label: '✕', count: losses, isLoss: true },
              ];
              const maxVal = Math.max(1, ...rows.map(r => r.count));
              return rows.map(({ label, count, isLoss, isCur }) => {
                const pct   = Math.max(8, Math.round((count / maxVal) * 100));
                const barBg = isCur  ? accentGreen
                            : isLoss ? (isDark ? '#b59f3b' : '#c9b458')
                            :           (isDark ? '#818384' : '#b0b0b0');
                return (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 9, fontSize: 9, fontWeight: 700, color: isLoss ? (isDark ? '#b59f3b' : '#c9b458') : fg, textAlign: 'right', flexShrink: 0 }}>{label}</div>
                    <div style={{ flex: 1, height: 14 }}>
                      <div style={{
                        width: `${pct}%`, height: '100%', background: barBg, borderRadius: 2,
                        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                        paddingRight: 4, boxSizing: 'border-box', minWidth: 18,
                      }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: 'white' }}>{count}</span>
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>

          <div style={{ width: '100%', height: 1, background: divider, marginBottom: 6 }} />

          {/* Countdown + Share row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', paddingBottom: 8 }}>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 8, fontWeight: 700, color: mutedFg, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Next Wordle</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: fg, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {countdown || '--:--:--'}
              </div>
            </div>
            <button
              onClick={handleShare}
              style={{
                flexShrink: 0, padding: '8px 14px',
                background: accentGreen, color: 'white',
                border: 'none', borderRadius: 4, fontSize: 12, fontWeight: 700,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              Share ⎘
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          position:      'absolute', inset: 0, zIndex: 100,
          background:    isDark ? 'rgba(18,18,19,0.97)' : 'rgba(255,255,255,0.97)',
          display:       'flex', flexDirection: 'column', alignItems: 'center',
          padding:       '8px 14px 8px',
          overflow:      'hidden',
          animation:     'wdlModalIn 220ms ease',
        }}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={{ width: '100%', flexShrink: 0, position: 'relative', marginBottom: 6 }}>
          {hasFriends ? (
            /* Tab bar */
            <div style={{ display: 'flex', justifyContent: 'center', borderBottom: `1px solid ${divider}`, paddingBottom: 0 }}>
              {(['stats', 'friends'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setModalTab(tab)}
                  style={{
                    background:    'none',
                    border:        'none',
                    borderBottom:  `2px solid ${modalTab === tab ? accentGreen : 'transparent'}`,
                    padding:       '0 14px 7px',
                    fontSize:      10,
                    fontWeight:    700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color:         modalTab === tab ? fg : mutedFg,
                    cursor:        'pointer',
                    transition:    'color 0.15s, border-color 0.15s',
                    marginBottom:  '-1px', // sit on top of the border
                  }}
                >
                  {tab === 'stats' ? 'Statistics' : 'Friends'}
                </button>
              ))}
            </div>
          ) : (
            /* Original title (no connections) */
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <h2 style={{
                fontFamily: '"Libre Baskerville", Georgia, serif',
                fontSize: 11, fontWeight: 700, color: fg, margin: 0,
                letterSpacing: '0.12em', textTransform: 'uppercase',
              }}>Statistics</h2>
            </div>
          )}

          {/* Close button — always top-right */}
          <button
            onClick={() => setShowModal(false)}
            style={{
              position: 'absolute', right: 0, top: 0,
              background: 'none', border: 'none', color: mutedFg,
              fontSize: 16, cursor: 'pointer', padding: 2, lineHeight: 1,
            }}
          >✕</button>

          {/* Solution word — shown on stats context when game was lost */}
          {modalTab === 'stats' && status === 'lost' && solution && (
            <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <span style={{ fontSize: 9, color: mutedFg, textTransform: 'uppercase', letterSpacing: '0.06em' }}>The word was</span>
              <span style={{
                fontSize: 13, fontWeight: 700, color: accentGreen,
                fontFamily: '"Libre Baskerville", Georgia, serif', letterSpacing: '0.1em',
              }}>{solution.toUpperCase()}</span>
            </div>
          )}
        </div>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        {hasFriends && modalTab === 'friends'
          ? renderFriendsTab()
          : renderStatsTab()
        }
      </div>
    );
  }

  // ── Board dimensions ───────────────────────────────────────────────────────
  const boardW    = 5 * tileSize + 4 * TILE_GAP;
  const boardH    = 6 * tileSize + 5 * TILE_GAP;
  const isPlayable = status !== 'loading' && status !== 'error';

  // ── Main render ────────────────────────────────────────────────────────────
  // IMPORTANT: No early returns — rootRef and boardAreaRef must always be
  // mounted so the ResizeObserver fires and tileSize / keyW are measured.
  return (
    <>
      <style>{STYLES}</style>
      <div
        ref={rootRef}
        className="h-full flex flex-col"
        style={{
          background: bg, color: fg, position: 'relative',
          fontFamily: "'DM Sans','Helvetica Neue',Arial,sans-serif",
          userSelect: 'none', overflow: 'hidden',
        }}
      >
        {/* Toast */}
        {toast && (
          <div
            key={toast.id}
            onClick={toast.persist && toast.msg.includes('New Wordle') ? () => { setToast(null); loadState(); } : undefined}
            style={{
              position: 'absolute', top: HEADER_H + 6, left: '50%',
              transform: 'translateX(-50%)',
              background: isDark ? '#ffffff' : '#1a1a1b',
              color: isDark ? '#1a1a1b' : '#ffffff',
              padding: '8px 14px', borderRadius: 4, fontSize: 12, fontWeight: 700,
              zIndex: 300, animation: 'wdlFadeSlide 150ms ease',
              whiteSpace: 'nowrap', pointerEvents: toast.persist ? 'auto' : 'none',
              cursor: toast.persist ? 'pointer' : 'default',
              boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
            }}
          >
            {toast.msg}
          </div>
        )}

        {/* Header */}
        <div style={{
          height: HEADER_H, flexShrink: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center', position: 'relative',
          borderBottom: `1px solid ${divider}`,
        }}>
          <h1 style={{
            fontFamily: '"Libre Baskerville", Georgia, serif',
            fontSize: 22, fontWeight: 700, color: fg, margin: 0,
            letterSpacing: '0.03em', lineHeight: 1,
          }}>
            Wordle
          </h1>

          {/* Stats button — always visible while game is playable.
              Color signals game status at a glance:
                green  = won · yellow = lost · muted = still playing */}
          {isPlayable && (
            <button
              onClick={() => { setShowSettings(false); setShowModal(true); }}
              title={status === 'playing' ? 'Statistics — game in progress' : 'Statistics'}
              style={{
                position:      'absolute', left: 10,
                background:    'none', border: 'none', cursor: 'pointer',
                padding:       '4px 6px', lineHeight: 1,
                fontSize:      9, fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase',
                color:   fg,
                opacity: status === 'playing' ? 0.5 : 1,
                transition:    'color 0.15s, opacity 0.15s',
              }}
            >
              Stats
            </button>
          )}

          {/* Settings gear */}
          <button
            onClick={() => setShowSettings(s => !s)}
            title="Settings"
            style={{
              position: 'absolute', right: 10,
              background: 'none', border: 'none',
              color: showSettings ? fg : mutedFg,
              fontSize: 15, cursor: 'pointer', padding: 4, lineHeight: 1,
              transition: 'color 0.15s',
            }}
          >⚙</button>
        </div>

        {/* Settings panel — slides in below header */}
        {showSettings && (
          <div style={{
            position: 'absolute', top: HEADER_H, left: 0, right: 0, zIndex: 200,
            background: isDark ? '#1e1e1f' : '#f5f5f5',
            borderBottom: `1px solid ${divider}`,
            padding: '10px 14px',
            animation: 'wdlModalIn 160ms ease',
          }}>
            <div style={{ fontSize: 11, color: fg, fontWeight: 600, marginBottom: 8 }}>
              Reset today's puzzle?
            </div>
            <div style={{ fontSize: 10, color: mutedFg, marginBottom: 10, lineHeight: 1.4 }}>
              Your guesses will be cleared so you can start fresh. Stats are not affected.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={resetGame}
                disabled={resetting}
                style={{
                  flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700,
                  background: isDark ? '#538d4e' : '#6aaa64', color: 'white',
                  border: 'none', borderRadius: 4, cursor: resetting ? 'default' : 'pointer',
                  opacity: resetting ? 0.6 : 1,
                }}
              >
                {resetting ? 'Resetting…' : 'Yes, reset'}
              </button>
              <button
                onClick={() => setShowSettings(false)}
                style={{
                  flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700,
                  background: 'transparent', color: mutedFg,
                  border: `1px solid ${divider}`, borderRadius: 4, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Board area — always mounted so boardAreaRef.clientHeight is always
            a real measured value when the ResizeObserver callback fires */}
        <div
          ref={boardAreaRef}
          style={{
            flex: 1, minHeight: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: BOARD_PAD,
            overflow: 'hidden',
          }}
        >
          {status === 'loading' && (
            <span style={{ color: mutedFg, fontSize: 12 }}>Loading…</span>
          )}

          {status === 'error' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 24 }}>🟩</span>
              <p style={{ color: fg, fontSize: 11, margin: 0, textAlign: 'center' }}>
                Could not load today&apos;s Wordle
              </p>
              <button
                onClick={loadState}
                style={{
                  background: isDark ? '#538d4e' : '#6aaa64', color: 'white',
                  border: 'none', borderRadius: 4, padding: '7px 18px',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          )}

          {isPlayable && tileSize > 0 && (
            <div style={{ width: boardW, height: boardH, display: 'flex', flexDirection: 'column', gap: TILE_GAP }}>
              {Array.from({ length: 6 }, (_, rowIdx) => (
                <div
                  key={rowIdx}
                  style={{
                    display: 'flex', gap: TILE_GAP, flexShrink: 0,
                    animation: shakingRow === rowIdx ? 'wdlShake 600ms ease' : undefined,
                  }}
                >
                  {Array.from({ length: 5 }, (_, colIdx) => renderTile(rowIdx, colIdx))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Keyboard — always in the layout tree so its height is included in
            the flex calculation when boardAreaRef.clientHeight is measured;
            hidden during loading/error so it doesn't show prematurely */}
        <div style={{ visibility: isPlayable ? 'visible' : 'hidden', paddingBottom: 6 }}>
          {renderKeyboard()}
        </div>

        {/* Modal */}
        {showModal && renderModal()}
      </div>
    </>
  );
}
