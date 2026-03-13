import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { apiFetch } from '../../lib/api';
import { useWidgetReady } from '../../hooks/useWidgetReady';

// ── Content ───────────────────────────────────────────────────────────────────

const WORDS_200 = [
  'the','be','to','of','and','a','in','that','have','it','for','not','on',
  'with','as','you','do','at','this','but','by','from','they','we','say',
  'her','she','or','an','will','my','one','all','would','there','their',
  'what','so','up','out','if','about','who','get','which','go','me','when',
  'make','can','like','time','no','just','him','know','take','people','into',
  'year','your','good','some','could','them','see','other','than','then',
  'now','look','only','come','its','over','think','also','back','after',
  'use','two','how','our','work','first','well','way','even','new','want',
  'because','any','these','give','day','most','us','great','between','need',
  'large','often','hand','high','place','hold','turn','part','keep','down',
  'child','few','open','seem','together','next','white','begin','walk',
  'example','group','always','music','both','book','until','mile','river',
  'care','second','plain','girl','young','ready','above','ever','red','list',
  'though','feel','bird','soon','body','dog','family','leave','song','door',
  'black','short','class','wind','question','happen','complete','ship','area',
  'half','rock','order','fire','south','problem','piece','told','knew','pass',
  'since','top','whole','king','space','heard','best','hour','better','true',
  'play','small','number','move','try','kind','picture','again','change',
  'spell','air','away','animal','house','point','page','answer','found',
  'study','still','learn','plant','cover','food','sun','four','state','never',
  'last','let','thought','city','tree','cross','farm','hard','start','story',
  'saw','far','sea','draw','left','late','run','while','close','night','real',
  'life','push','pull','mark','carry','drop','stand','save','cut','reach',
];

const QUOTES = [
  'The only way to do great work is to love what you do.',
  'In the middle of every difficulty lies opportunity.',
  'It does not matter how slowly you go as long as you do not stop.',
  'Life is what happens when you are busy making other plans.',
  'The future belongs to those who believe in the beauty of their dreams.',
  'It is during our darkest moments that we must focus to see the light.',
  'Whoever is happy will make others happy too.',
  'You will face many defeats in life but never let yourself be defeated.',
  'Never let the fear of striking out keep you from playing the game.',
  'The secret of getting ahead is getting started.',
  'Your time is limited do not waste it living someone else\'s life.',
  'Whatever you do do it well.',
  'All our dreams can come true if we have the courage to pursue them.',
  'It takes courage to grow up and become who you really are.',
  'Two roads diverged in a wood and I took the one less traveled by.',
  'In three words I can sum up everything I know about life it goes on.',
  'Not all those who wander are lost.',
  'You only live once but if you do it right once is enough.',
  'Be yourself everyone else is already taken.',
  'So it goes.',
];

const CODE_SNIPPETS = [
  'const add = (a, b) => a + b',
  'function square(n) { return n * n }',
  'const arr = [1, 2, 3].map(x => x * 2)',
  'const obj = { name: "Alice", age: 30 }',
  'const { name, age } = obj',
  'const unique = arr => [...new Set(arr)]',
  'let count = 0; while (count < 10) { count++ }',
  'const sum = arr.reduce((a, b) => a + b, 0)',
  'const greet = name => `Hello, ${name}!`',
  'const isEven = n => n % 2 === 0',
  'const max = (a, b) => a > b ? a : b',
  'const keys = Object.keys(obj)',
  'const first = arr.find(x => x > 2)',
  'const sorted = [...arr].sort((a, b) => a - b)',
  'const filtered = arr.filter(Boolean)',
];

// ── Types ─────────────────────────────────────────────────────────────────────

type View        = 'test' | 'results' | 'stats';
type TestStatus  = 'idle' | 'running' | 'paused' | 'done';
type TimeMode    = '15s' | '30s' | '60s' | '120s';
type ContentType = 'words' | 'quotes' | 'code';
type LBPeriod    = 'daily' | 'monthly' | 'alltime';

interface CharState {
  char: string;
  status: 'upcoming' | 'correct' | 'incorrect';
  wordIdx: number;
}

interface TestResult {
  wpm: number; rawWpm: number; accuracy: number;
  consistency: number; errorCount: number;
  wpmHistory: number[]; mode: TimeMode; contentType: ContentType;
  isPB?: boolean; pbDiff?: number | null;
  isBestToday?: boolean; prevBestWpm?: number | null;
}

interface PBEntry   { mode: TimeMode; wpm: number; accuracy: number; achievedAt: string }
interface HistEntry { completed_at: string; wpm: number; mode: TimeMode }
interface LBEntry {
  rank: number;
  displayName: string;
  username?: string | null;
  wpm: number;
  accuracy: number;
  achievedAt: string;
  isCurrentUser: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TIME_SECONDS: Record<TimeMode, number> = { '15s': 15, '30s': 30, '60s': 60, '120s': 120 };
const MODES: TimeMode[] = ['15s', '30s', '60s', '120s'];

function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

function generateWords(contentType: ContentType, mode: TimeMode): string[] {
  const count = TIME_SECONDS[mode] * 3;
  if (contentType === 'quotes') return rand(QUOTES).split(' ');
  if (contentType === 'code')   return rand(CODE_SNIPPETS).split(/\s+/).filter(Boolean);
  const r: string[] = [];
  for (let i = 0; i < count; i++) r.push(rand(WORDS_200));
  return r;
}

function calcWpm(correctChars: number, elapsedSeconds: number): number {
  if (elapsedSeconds <= 0) return 0;
  return +((correctChars / 5) / (elapsedSeconds / 60)).toFixed(1);
}

function calcConsistency(samples: number[]): number {
  if (samples.length < 2) return 100;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  if (mean === 0) return 100;
  const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length;
  return +Math.max(0, Math.min(100, (1 - Math.sqrt(variance) / mean) * 100)).toFixed(1);
}

function timeAgo(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (s < 60) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

// ── Audio ─────────────────────────────────────────────────────────────────────

let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') _audioCtx = new AudioContext();
  return _audioCtx;
}
function playClick() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.value = 600 + Math.random() * 200;
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.04);
  } catch { /* ignore */ }
}
function playError() {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sawtooth'; osc.frequency.value = 180;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.07);
  } catch { /* ignore */ }
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const STYLE_ID = 'nexus-typing-styles';
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@300;400;500&display=swap');
    @keyframes tpCaretBlink  { 0%,100%{opacity:1}50%{opacity:0} }
    @keyframes tpCaretPulse  { 0%,100%{box-shadow:0 0 6px rgba(124,106,255,.6)}50%{box-shadow:0 0 12px rgba(124,106,255,.9)} }
    @keyframes tpWpmCount    { from{opacity:0;transform:translateY(12px) scale(.9)} to{opacity:1;transform:translateY(0) scale(1)} }
    @keyframes tpPBSlide     { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
    @keyframes tpFadeIn      { from{opacity:0} to{opacity:1} }
    @keyframes tpDailyPulse  { 0%,100%{box-shadow:0 0 0 0 rgba(255,215,0,.25)}60%{box-shadow:0 0 0 5px rgba(255,215,0,0)} }
    @keyframes tpSkeleton    { 0%,100%{opacity:.4}50%{opacity:.15} }
    .tp-caret-idle   { animation: tpCaretBlink 1.1s ease-in-out infinite; }
    .tp-caret-typing { animation: tpCaretPulse 0.8s ease-in-out infinite; }
    .tp-word-display::-webkit-scrollbar { display:none; }
    .tp-word-display { scrollbar-width:none; }
    .tp-pill { transition:background .15s,color .15s; }
    .tp-pill:hover { background:rgba(124,106,255,.12) !important; }
    .tp-lb-skeleton { animation:tpSkeleton 1.4s ease-in-out infinite; border-radius:3px; background:var(--surface2); }
    .tp-daily-top { animation:tpDailyPulse 2.5s ease-in-out infinite; border-radius:6px; }
  `;
  document.head.appendChild(s);
}

// ── TimerRing ─────────────────────────────────────────────────────────────────

function TimerRing({ timeLeft, totalTime }: { timeLeft: number; totalTime: number }) {
  const R = 26, CIRC = 2 * Math.PI * R;
  const isUrgent = timeLeft <= 5 && timeLeft > 0;
  const offset = CIRC * (1 - (totalTime > 0 ? timeLeft / totalTime : 1));
  return (
    <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
      <svg width={64} height={64} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={32} cy={32} r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={3} />
        <circle cx={32} cy={32} r={R} fill="none"
          stroke={isUrgent ? '#3de8b0' : '#7c6aff'} strokeWidth={3} strokeLinecap="round"
          strokeDasharray={CIRC} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.5s ease' }} />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Roboto Mono', monospace", fontSize: 15, fontWeight: 500,
        color: isUrgent ? '#3de8b0' : 'var(--text)', transition: 'color 0.5s',
      }}>{timeLeft}</div>
    </div>
  );
}

// ── WordDisplay ───────────────────────────────────────────────────────────────

interface WordDisplayProps {
  chars: CharState[]; caretIdx: number; isTyping: boolean;
  status: TestStatus; containerRef: React.RefObject<HTMLDivElement>;
}

function WordDisplay({ chars, caretIdx, isTyping, status, containerRef: _containerRef }: WordDisplayProps) {
  const caretRef = useRef<HTMLDivElement>(null);
  const charRefs = useRef<Map<number, HTMLSpanElement>>(new Map());
  const innerRef = useRef<HTMLDivElement>(null);
  const lineHRef = useRef(29); // 16px × 1.8em

  // Group flat chars into word-chunks so the browser wraps at word boundaries,
  // putting multiple words on each line instead of one per line.
  const wordGroups = useMemo(() => {
    type Group = { chars: Array<CharState & { idx: number }>; isSpace: boolean };
    const groups: Group[] = [];
    let cur: Array<CharState & { idx: number }> = [];
    chars.forEach((c, i) => {
      if (c.char === ' ') {
        if (cur.length) { groups.push({ chars: cur, isSpace: false }); cur = []; }
        groups.push({ chars: [{ ...c, idx: i }], isSpace: true });
      } else {
        cur.push({ ...c, idx: i });
      }
    });
    if (cur.length) groups.push({ chars: cur, isSpace: false });
    return groups;
  }, [chars]);

  useLayoutEffect(() => {
    const inner = innerRef.current;
    const caret = caretRef.current;
    if (!inner || !caret) return;

    // Reset scroll when test is not running
    if (status !== 'running' && status !== 'paused') {
      inner.scrollTop = 0;
      return;
    }

    const idx = Math.min(caretIdx, chars.length);
    const el = charRefs.current.get(idx) ?? charRefs.current.get(idx - 1);
    if (!el) return;

    // Use innerRef as the coordinate origin — the caret is position:absolute inside it.
    // Using containerRef would be off by the parent's padding (14px).
    const iRect = inner.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();

    const x = idx < chars.length ? eRect.left - iRect.left : eRect.right - iRect.left;
    // Content-Y = visible-Y + scrollTop (absolute position lives in content space, not viewport)
    const contentY = (eRect.top - iRect.top) + inner.scrollTop;
    lineHRef.current = eRect.height * 1.8;
    caret.style.transform = `translate(${x}px, ${contentY}px)`;

    // Auto-scroll: keep active line at row 2 so one completed line is always visible above.
    // Row 0 and 1 → no scroll; row 2+ → scroll up by (lineIndex - 1) * lh.
    const lh = lineHRef.current;
    const lineIndex = Math.floor(contentY / lh);
    const targetScroll = Math.max(0, (lineIndex - 1) * lh);
    if (Math.abs(inner.scrollTop - targetScroll) > lh * 0.3) {
      inner.style.scrollBehavior = 'smooth';
      inner.scrollTop = targetScroll;
    }
  });

  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden', userSelect: 'none' }}>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 40, background: 'linear-gradient(to top, var(--surface), transparent)', zIndex: 2, pointerEvents: 'none' }} />
      <div ref={innerRef} className="tp-word-display" style={{ height: '100%', overflowY: 'scroll', position: 'relative' }}>
        {(status === 'running' || status === 'paused') && (
          <div ref={caretRef} className={isTyping ? 'tp-caret-typing' : 'tp-caret-idle'}
            style={{ position: 'absolute', top: 0, left: 0, width: 2, height: '1.3em', background: 'var(--accent)', borderRadius: 1, pointerEvents: 'none', zIndex: 3, transition: 'transform 80ms ease', boxShadow: '0 0 8px rgba(124,106,255,0.7)' }} />
        )}
        <div style={{ fontFamily: "'Roboto Mono', monospace", fontSize: 16, fontWeight: 500, lineHeight: '1.8em', padding: '4px 0 80px', letterSpacing: '0.03em' }}>
          {wordGroups.map((group, gi) =>
            group.isSpace ? (
              // Space between words — inline so the browser can break here
              <span key={`sp${gi}`}
                ref={el => {
                  const i = group.chars[0].idx;
                  if (el) charRefs.current.set(i, el); else charRefs.current.delete(i);
                }}
                style={{ display: 'inline', color: 'transparent' }}>{' '}</span>
            ) : (
              // Word — inline-block + nowrap keeps letters together; browser breaks between words
              <span key={`w${gi}`} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
                {group.chars.map(c => (
                  <span key={c.idx}
                    ref={el => { if (el) charRefs.current.set(c.idx, el); else charRefs.current.delete(c.idx); }}
                    style={{
                      color: c.status === 'correct' ? 'var(--accent)' : c.status === 'incorrect' ? '#f87171' : 'var(--text-muted)',
                      textDecoration: c.status === 'incorrect' ? 'underline' : 'none',
                      textDecorationColor: '#f87171',
                    }}>{c.char}</span>
                ))}
              </span>
            )
          )}
          {/* End-of-text sentinel for caret positioning */}
          <span ref={el => { if (el) charRefs.current.set(chars.length, el); else charRefs.current.delete(chars.length); }}
            style={{ display: 'inline', fontSize: 0 }} />
        </div>
      </div>
    </div>
  );
}

// ── ResetCountdown ────────────────────────────────────────────────────────────

function ResetCountdown({ period }: { period: 'daily' | 'monthly' }) {
  const [text, setText] = useState('');
  useEffect(() => {
    function update() {
      const now = new Date();
      if (period === 'daily') {
        const midnight = new Date();
        midnight.setUTCDate(midnight.getUTCDate() + 1);
        midnight.setUTCHours(0, 0, 0, 0);
        const ms = midnight.getTime() - now.getTime();
        const h = Math.floor(ms / 3_600_000);
        const m = Math.floor((ms % 3_600_000) / 60_000);
        const s = Math.floor((ms % 60_000) / 1000);
        setText(`${h}h ${m}m ${s}s`);
      } else {
        const next = new Date();
        next.setUTCMonth(next.getUTCMonth() + 1);
        next.setUTCDate(1); next.setUTCHours(0, 0, 0, 0);
        const ms = next.getTime() - now.getTime();
        const d = Math.floor(ms / 86_400_000);
        const h = Math.floor((ms % 86_400_000) / 3_600_000);
        setText(`${d}d ${h}h`);
      }
    }
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [period]);
  return <>{text}</>;
}

// ── GlobalLeaderboard ─────────────────────────────────────────────────────────

interface GlobalLeaderboardProps {
  period: LBPeriod; mode: TimeMode;
  onPeriodChange(p: LBPeriod): void;
  onModeChange(m: TimeMode): void;
  onStartTest(): void;
}

function GlobalLeaderboard({ period, mode, onPeriodChange, onModeChange, onStartTest }: GlobalLeaderboardProps) {
  const [entries, setEntries]   = useState<LBEntry[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(false);

  const fetchKey = `${period}:${mode}`;
  const fetchKeyRef = useRef('');

  useEffect(() => {
    if (fetchKeyRef.current === fetchKey) return;
    fetchKeyRef.current = fetchKey;
    setLoading(true); setError(false);
    apiFetch(`/api/typing/leaderboard?mode=${mode}&period=${period}`)
      .then(r => r.json())
      .then(d => {
        setEntries(d.leaderboard ?? []);
        setTotal(d.total ?? 0);
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
  }, [fetchKey, period, mode]);

  const now = new Date();
  const todayLabel = now.toLocaleDateString('en', { month: 'long', day: 'numeric' });
  const monthLabel = now.toLocaleDateString('en', { month: 'long', year: 'numeric' });

  const PERIOD_TABS: { id: LBPeriod; label: string }[] = [
    { id: 'daily',   label: 'Daily'    },
    { id: 'monthly', label: 'Monthly'  },
    { id: 'alltime', label: 'All-time' },
  ];

  const medalColor = (rank: number) =>
    rank === 1 ? '#ffd700' : rank === 2 ? '#c0c0c0' : rank === 3 ? '#cd7f32' : undefined;

  const medalSize = (rank: number, p: LBPeriod) =>
    p === 'alltime' && rank <= 3 ? 14 : 11;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* Period tabs */}
      <div style={{ display: 'flex', gap: 1, marginBottom: 6 }}>
        {PERIOD_TABS.map(t => (
          <button key={t.id} onClick={() => onPeriodChange(t.id)} style={{
            flex: 1, padding: '5px 4px', border: 'none', cursor: 'pointer',
            borderRadius: 5, fontSize: 10,
            fontFamily: "'Roboto Mono', monospace", fontWeight: period === t.id ? 700 : 400,
            background: period === t.id ? 'rgba(124,106,255,0.18)' : 'transparent',
            color: period === t.id ? 'var(--accent)' : 'var(--text-faint)',
            transition: 'background .15s, color .15s',
            borderBottom: period === t.id ? '2px solid var(--accent)' : '2px solid transparent',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Subtitle + countdown */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: "'Roboto Mono', monospace" }}>
          {period === 'daily'   ? `Today · ${todayLabel}` :
           period === 'monthly' ? monthLabel : 'All-time rankings'}
        </span>
        {period !== 'alltime' && (
          <span style={{ fontSize: 8, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace" }}>
            resets in <ResetCountdown period={period} />
          </span>
        )}
      </div>

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
        {MODES.map(m => (
          <button key={m} onClick={() => onModeChange(m)} style={{
            padding: '2px 7px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 9,
            fontFamily: "'Roboto Mono', monospace",
            background: mode === m ? 'var(--accent)' : 'var(--surface2)',
            color: mode === m ? '#fff' : 'var(--text-faint)',
            transition: 'background .15s',
          }}>{m}</button>
        ))}
        {total > 20 && (
          <span style={{ marginLeft: 'auto', fontSize: 8, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace", alignSelf: 'center' }}>
            {total} players
          </span>
        )}
      </div>

      {/* Content */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}>
              <div className="tp-lb-skeleton" style={{ width: 20, height: 10 }} />
              <div className="tp-lb-skeleton" style={{ flex: 1, height: 10 }} />
              <div className="tp-lb-skeleton" style={{ width: 32, height: 10 }} />
              <div className="tp-lb-skeleton" style={{ width: 28, height: 10 }} />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace", marginBottom: 8 }}>
            Could not load leaderboard
          </div>
          <button onClick={() => { setError(false); fetchKeyRef.current = ''; }}
            style={{ fontSize: 9, padding: '3px 10px', borderRadius: 4, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', fontFamily: "'Roboto Mono', monospace" }}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div style={{ textAlign: 'center', padding: '14px 0' }}>
          <div style={{ fontSize: 11, marginBottom: 4 }}>
            {period === 'daily' ? '🏁' : period === 'monthly' ? '🏆' : '⌨️'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace", marginBottom: 10, lineHeight: 1.5 }}>
            {period === 'daily'   ? 'Be the first to set a score today!' :
             period === 'monthly' ? 'No scores this month yet.' :
             'No all-time scores yet.'}
          </div>
          <button onClick={onStartTest} style={{
            fontSize: 10, padding: '5px 14px', borderRadius: 5, cursor: 'pointer',
            border: '1px solid rgba(124,106,255,0.4)',
            background: 'rgba(124,106,255,0.15)', color: 'var(--accent)',
            fontFamily: "'Roboto Mono', monospace", fontWeight: 600,
          }}>Start Test</button>
        </div>
      )}

      {!loading && !error && entries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {entries.map((e, idx) => {
            const medal = medalColor(e.rank);
            const mSize = medalSize(e.rank, period);
            const isTopDaily = period === 'daily' && e.rank === 1;
            // Insert separator before out-of-top-20 current user
            const showSep = idx > 0 && entries[idx - 1].rank !== e.rank - 1 && e.rank > 20;

            return (
              <div key={`${e.rank}-${e.displayName}`}>
                {showSep && <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />}
                <div
                  className={isTopDaily ? 'tp-daily-top' : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 7px', borderRadius: 5,
                    background: e.isCurrentUser ? 'rgba(124,106,255,0.1)' :
                                isTopDaily     ? 'rgba(255,215,0,0.06)'   : 'transparent',
                    border: e.isCurrentUser ? '1px solid rgba(124,106,255,0.25)' :
                            isTopDaily      ? '1px solid rgba(255,215,0,0.25)'  :
                            '1px solid transparent',
                  }}
                >
                  {/* Rank */}
                  <span style={{
                    width: mSize === 14 ? 22 : 18, textAlign: 'center', flexShrink: 0,
                    fontSize: mSize, fontWeight: medal ? 700 : 400,
                    color: medal ?? 'var(--text-faint)',
                    fontFamily: "'Roboto Mono', monospace",
                  }}>
                    {medal && e.rank <= 3 ? (e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : '🥉') : e.rank}
                  </span>

                  {/* Name */}
                  <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <div style={{
                      fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      fontFamily: "'Roboto Mono', monospace",
                      color: e.isCurrentUser ? 'var(--accent)' : 'var(--text)',
                    }}>
                      {e.displayName}{e.isCurrentUser ? ' (you)' : ''}
                    </div>
                    {e.username && (
                      <div style={{
                        fontSize: 8, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        fontFamily: "'Roboto Mono', monospace",
                      }}>
                        @{e.username}
                      </div>
                    )}
                  </div>

                  {/* WPM */}
                  <span style={{
                    fontSize: 13, fontWeight: 700, minWidth: 38, textAlign: 'right',
                    fontFamily: "'Roboto Mono', monospace",
                    color: e.isCurrentUser ? 'var(--accent)' : medal ?? 'var(--text)',
                  }}>
                    {e.wpm.toFixed(0)}
                  </span>

                  {/* Accuracy */}
                  <span style={{ fontSize: 9, color: 'var(--text-faint)', minWidth: 34, textAlign: 'right', fontFamily: "'Roboto Mono', monospace" }}>
                    {e.accuracy.toFixed(0)}%
                  </span>

                  {/* When */}
                  <span style={{ fontSize: 8, color: 'var(--text-faint)', minWidth: 40, textAlign: 'right', fontFamily: "'Roboto Mono', monospace" }}>
                    {timeAgo(e.achievedAt)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── ResultsView ───────────────────────────────────────────────────────────────

interface ResultsViewProps {
  result: TestResult; onRetry(): void;
}

function ResultsView({ result, onRetry }: ResultsViewProps) {
  const [displayWpm, setDisplayWpm] = useState(0);

  useEffect(() => {
    const target = result.wpm, duration = 600, start = performance.now();
    function tick(now: number) {
      const p = Math.min((now - start) / duration, 1);
      setDisplayWpm(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }, [result.wpm]);

  const chartData = result.wpmHistory.map((w, i) => ({ s: i + 1, wpm: w }));

  // Build PB comparison badge
  const pbBadge = (() => {
    if (result.isPB) {
      const diff = result.pbDiff != null && result.pbDiff > 0 ? ` +${result.pbDiff} wpm` : '';
      return { text: `⚡ New personal best${diff}`, bg: 'rgba(61,232,176,0.15)', fg: '#3de8b0', border: 'rgba(61,232,176,0.35)', glow: 'rgba(61,232,176,0.2)' };
    }
    if (result.isBestToday) {
      return { text: '🏆 Your best today', bg: 'rgba(255,180,0,0.12)', fg: '#f5c842', border: 'rgba(255,180,0,0.3)', glow: 'rgba(255,180,0,0.15)' };
    }
    return null;
  })();

  return (
    <div style={{ flex: 1, overflow: 'hidden', padding: '8px 14px 8px', display: 'flex', flexDirection: 'column', gap: 7, animation: 'tpFadeIn 0.25s ease' }}>

      {/* PB / best-today badge */}
      {pbBadge && (
        <div style={{ display: 'flex', justifyContent: 'center', animation: 'tpPBSlide 0.4s ease', flexShrink: 0 }}>
          <span style={{
            padding: '2px 10px', borderRadius: 20, fontSize: 9,
            fontFamily: "'Roboto Mono', monospace", fontWeight: 500,
            background: pbBadge.bg, color: pbBadge.fg,
            border: `1px solid ${pbBadge.border}`,
            boxShadow: `0 0 10px ${pbBadge.glow}`,
          }}>{pbBadge.text}</span>
        </div>
      )}

      {/* Hero WPM */}
      <div style={{ textAlign: 'center', flexShrink: 0 }}>
        <div style={{ fontFamily: "'Roboto Mono', monospace", fontSize: 46, fontWeight: 700, color: 'var(--accent)', lineHeight: 1, animation: 'tpWpmCount 0.5s ease' }}>
          {displayWpm}
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace", marginTop: 1 }}>WPM</div>
        {!result.isPB && !result.isBestToday && result.prevBestWpm != null && result.prevBestWpm > 0 && (
          <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace", marginTop: 2 }}>
            Your best: {result.prevBestWpm.toFixed(0)} wpm
            {result.wpm < result.prevBestWpm && (
              <span style={{ color: '#f87171', marginLeft: 4 }}>
                ({(result.wpm - result.prevBestWpm).toFixed(1)} wpm)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, flexShrink: 0 }}>
        {[
          { label: 'Raw',         value: result.rawWpm.toFixed(0) },
          { label: 'Accuracy',    value: `${result.accuracy.toFixed(1)}%` },
          { label: 'Errors',      value: result.errorCount.toString() },
          { label: 'Consistency', value: `${result.consistency.toFixed(0)}%` },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: 'var(--surface2)', borderRadius: 5, padding: '4px 6px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: "'Roboto Mono', monospace" }}>{value}</div>
            <div style={{ fontSize: 8, color: 'var(--text-faint)', marginTop: 1, fontFamily: "'Roboto Mono', monospace" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* WPM over time chart */}
      {chartData.length > 1 && (
        <div style={{ flex: 1, minHeight: 0, maxHeight: 160 }}>
          <div style={{ fontSize: 8, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace", marginBottom: 3, letterSpacing: '0.05em' }}>WPM OVER TIME</div>
          <ResponsiveContainer width="100%" height="90%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id="tpGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="10%" stopColor="#7c6aff" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#7c6aff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="s" tick={{ fill: 'var(--text-faint)', fontSize: 8, fontFamily: 'inherit' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 8, fontFamily: 'inherit' }} axisLine={false} tickLine={false} tickCount={3} width={28} />
              <Tooltip content={<WpmTooltip />} />
              <Area type="monotone" dataKey="wpm" stroke="#7c6aff" strokeWidth={2} fill="url(#tpGrad)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0, padding: '0 0 12px' }}>
        <button onClick={onRetry} title="Try again" style={{
          background: 'rgba(124,106,255,0.12)', border: '1px solid rgba(124,106,255,0.35)',
          borderRadius: 10, width: 44, height: 44, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent)', transition: 'background 0.15s',
          boxShadow: '0 0 10px rgba(124,106,255,0.15)',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(124,106,255,0.22)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(124,106,255,0.12)'; }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function WpmTooltip({ active, payload }: { active?: boolean; payload?: { value: number; payload: { s: number } }[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 5, padding: '4px 8px', fontFamily: "'Roboto Mono', monospace", fontSize: 10, color: 'var(--text)' }}>
      {payload[0].payload.s}s — {payload[0].value} wpm
    </div>
  );
}

// ── MiniLeaderboard (shown on the idle test screen) ───────────────────────────

function miniMedalColor(rank: number) {
  return rank === 1 ? '#ffd700' : rank === 2 ? '#c0c0c0' : rank === 3 ? '#cd7f32' : undefined;
}

interface MiniLeaderboardProps {
  mode: TimeMode;
  period: LBPeriod;
}

function MiniLeaderboard({ mode, period }: MiniLeaderboardProps) {
  const [entries, setEntries] = useState<LBEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(false);

  useEffect(() => {
    // Clear entries immediately so the previous period's data never shows while loading
    setEntries([]); setLoading(true); setError(false);
    apiFetch(`/api/typing/leaderboard?mode=${mode}&period=${period}`)
      .then(r => r.json())
      .then(d => { setEntries(d.leaderboard ?? []); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [mode, period]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {/* No skeleton — API responds fast enough that a blank transition is cleaner */}

        {!loading && error && (
          <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-faint)', fontSize: 10, fontFamily: "'Roboto Mono', monospace" }}>
            Could not load leaderboard
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>⌨️</div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace" }}>
              {period === 'daily' ? 'No scores today yet — be first!' : 'No scores yet. Start typing!'}
            </div>
          </div>
        )}

        {!loading && !error && entries.slice(0, 12).map(e => {
          const medal = miniMedalColor(e.rank);
          return (
            <div key={`${e.rank}-${e.displayName}`} style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '4px 6px', borderRadius: 5,
              background: e.isCurrentUser ? 'rgba(124,106,255,0.10)' : 'transparent',
              border: e.isCurrentUser ? '1px solid rgba(124,106,255,0.22)' : '1px solid transparent',
            }}>
              <span style={{
                width: 20, textAlign: 'center', fontSize: medal ? 12 : 9, fontWeight: medal ? 700 : 400,
                color: medal ?? 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace", flexShrink: 0,
              }}>
                {e.rank <= 3 ? (e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : '🥉') : e.rank}
              </span>
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <div style={{
                  fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontFamily: "'Roboto Mono', monospace",
                  color: e.isCurrentUser ? 'var(--accent)' : 'var(--text)',
                }}>
                  {e.displayName}{e.isCurrentUser ? ' (you)' : ''}
                </div>
                {e.username && (
                  <div style={{ fontSize: 8, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace" }}>
                    @{e.username}
                  </div>
                )}
              </div>
              <span style={{
                fontSize: 13, fontWeight: 700, minWidth: 32, textAlign: 'right',
                fontFamily: "'Roboto Mono', monospace",
                color: e.isCurrentUser ? 'var(--accent)' : medal ?? 'var(--text)',
              }}>
                {e.wpm.toFixed(0)}
              </span>
              <span style={{ fontSize: 8, color: 'var(--text-faint)', minWidth: 28, textAlign: 'right', fontFamily: "'Roboto Mono', monospace" }}>
                {e.accuracy.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>

    </div>
  );
}

// ── StatsView ─────────────────────────────────────────────────────────────────

interface StatsViewProps {
  lbPeriod: LBPeriod;
  onLbPeriodChange(p: LBPeriod): void;
  onStartTest(): void;
}

// @ts-ignore – reserved stats panel, not yet wired up
function _StatsView({ lbPeriod, onLbPeriodChange, onStartTest }: StatsViewProps) {
  const [lbMode, setLbMode] = useState<TimeMode>('30s');
  const [pbs, setPbs]         = useState<PBEntry[]>([]);
  const [history, setHistory] = useState<HistEntry[]>([]);
  const [streak, setStreak]   = useState({ current: 0, max: 0, days: [] as boolean[] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/typing/stats').then(r => r.json()).then(d => {
      setPbs(d.personalBests ?? []);
      setHistory((d.history ?? []).slice(-50));
      setStreak({ current: d.currentStreak ?? 0, max: d.maxStreak ?? 0, days: d.streakDays ?? [] });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const histData = history.map((h, i) => ({ i: i + 1, wpm: +h.wpm }));
  const trendData = useMemo(() => {
    if (histData.length < 2) return [];
    const n = histData.length;
    const sx  = histData.reduce((a, d) => a + d.i,       0);
    const sy  = histData.reduce((a, d) => a + d.wpm,     0);
    const sxy = histData.reduce((a, d) => a + d.i*d.wpm, 0);
    const sx2 = histData.reduce((a, d) => a + d.i*d.i,   0);
    const slope     = (n*sxy - sx*sy) / (n*sx2 - sx*sx);
    const intercept = (sy - slope*sx) / n;
    return histData.map(d => ({ i: d.i, trend: +(slope*d.i + intercept).toFixed(1) }));
  }, [histData]);

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace", fontSize: 11 }}>
      Loading stats…
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 16, animation: 'tpFadeIn 0.2s ease' }}>

      {/* Personal bests */}
      <div>
        <div style={secHdr}>PERSONAL BESTS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {MODES.map(m => {
            const pb = pbs.find(p => p.mode === m);
            const isTop = pb != null && pb === pbs.reduce((b, p) => p.wpm > (b?.wpm ?? 0) ? p : b, null as PBEntry | null);
            return (
              <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 8px', borderRadius: 5, background: isTop ? 'rgba(124,106,255,0.08)' : 'transparent', border: isTop ? '1px solid rgba(124,106,255,0.2)' : '1px solid transparent' }}>
                <span style={{ width: 32, fontFamily: "'Roboto Mono', monospace", fontSize: 10, color: isTop ? 'var(--accent)' : 'var(--text-faint)' }}>{m}</span>
                {pb ? (
                  <>
                    <span style={{ fontFamily: "'Roboto Mono', monospace", fontSize: 15, fontWeight: 600, color: isTop ? 'var(--accent)' : 'var(--text)', minWidth: 50 }}>
                      {(+pb.wpm).toFixed(0)}<span style={{ fontSize: 9, color: 'var(--text-faint)', marginLeft: 3 }}>wpm</span>
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace" }}>{(+pb.accuracy).toFixed(1)}%</span>
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace" }}>{new Date(pb.achievedAt).toLocaleDateString()}</span>
                  </>
                ) : (
                  <span style={{ fontSize: 10, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace" }}>no tests yet</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* History chart */}
      {histData.length > 1 && (
        <div>
          <div style={secHdr}>WPM HISTORY (last {histData.length} tests)</div>
          <ResponsiveContainer width="100%" height={78}>
            <LineChart data={histData} margin={{ top: 2, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="i" hide />
              <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 8, fontFamily: 'inherit' }} axisLine={false} tickLine={false} tickCount={3} />
              <Tooltip content={<WpmTooltip />} />
              <Line type="monotone" dataKey="wpm" stroke="#7c6aff" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              {trendData.length > 0 && (
                <Line data={trendData} type="monotone" dataKey="trend" stroke="#3de8b0" strokeWidth={1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Global Leaderboard (Daily / Monthly / All-time) */}
      <div>
        <div style={secHdr}>LEADERBOARD</div>
        <GlobalLeaderboard
          period={lbPeriod} mode={lbMode}
          onPeriodChange={onLbPeriodChange}
          onModeChange={setLbMode}
          onStartTest={onStartTest}
        />
      </div>

      {/* Streak */}
      <div>
        <div style={secHdr}>STREAK</div>
        <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Roboto Mono', monospace", color: 'var(--accent)' }}>{streak.current}</div>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace" }}>current</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Roboto Mono', monospace", color: 'var(--text-muted)' }}>{streak.max}</div>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace" }}>best</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {streak.days.map((filled, i) => (
            <div key={i} style={{ width: 8, height: 8, borderRadius: 2, background: filled ? 'var(--accent)' : 'var(--surface2)', border: '1px solid var(--border)' }} />
          ))}
        </div>
      </div>
    </div>
  );
}

const secHdr: React.CSSProperties = {
  fontSize: 9, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace",
  letterSpacing: '0.1em', marginBottom: 6,
};

// ── TypingWidget (main) ───────────────────────────────────────────────────────

export function TypingWidget({ onClose: _onClose }: { onClose: () => void }) {
  useEffect(() => injectStyles(), []);

  const [view, setView]                     = useState<View>('test');
  const [mode, setMode]                     = useState<TimeMode>('30s');
  const [_contentType, _setContentType]       = useState<ContentType>('words');
  const [soundEnabled, setSoundEnabled]     = useState(false);
  const [lbPeriod, setLbPeriod]             = useState<LBPeriod>('alltime');
  const [mainTab, setMainTab]               = useState<'session' | 'leaderboard'>('session');

  const [words, setWords]                   = useState<string[]>(() => generateWords('words', '30s'));
  const [status, setStatus]                 = useState<TestStatus>('idle');
  const [timeLeft, setTimeLeft]             = useState(30);
  const [completedTyped, setCompletedTyped] = useState<string[]>([]);
  const [currentInput, setCurrentInput]     = useState('');
  const [isTyping, setIsTyping]             = useState(false);
  const [result, setResult]                 = useState<TestResult | null>(null);
  const [isPaused, setIsPaused]             = useState(false);

  const statusRef          = useRef<TestStatus>('idle');
  const wpmHistoryRef      = useRef<number[]>([]);
  const totalCharsTypedRef = useRef(0);
  const correctCharsRef    = useRef(0);
  const elapsedRef         = useRef(0);
  const timerRef           = useRef<ReturnType<typeof setInterval> | null>(null);
  const typingTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef           = useRef<HTMLInputElement>(null);
  const wordContainerRef   = useRef<HTMLDivElement>(null);
  const currentModeRef     = useRef<TimeMode>('30s');
  const wordsRef           = useRef(words);

  useEffect(() => { statusRef.current = status; },         [status]);
  useEffect(() => { currentModeRef.current = mode; },      [mode]);
  useEffect(() => { wordsRef.current = words; },           [words]);

  useWidgetReady('typing', true);

  const chars = useMemo((): CharState[] => {
    const out: CharState[] = [];
    for (let wi = 0; wi < words.length; wi++) {
      const word  = words[wi];
      const typed = wi < completedTyped.length ? completedTyped[wi]
                  : wi === completedTyped.length ? currentInput : '';
      for (let ci = 0; ci < word.length; ci++) {
        let s: CharState['status'];
        if      (wi < completedTyped.length)   s = ci < typed.length ? (typed[ci] === word[ci] ? 'correct' : 'incorrect') : 'incorrect';
        else if (wi === completedTyped.length)  s = ci >= typed.length ? 'upcoming' : (typed[ci] === word[ci] ? 'correct' : 'incorrect');
        else                                    s = 'upcoming';
        out.push({ char: word[ci], status: s, wordIdx: wi });
      }
      if (wi < words.length - 1) out.push({ char: ' ', status: wi < completedTyped.length ? 'correct' : 'upcoming', wordIdx: wi });
    }
    return out;
  }, [words, completedTyped, currentInput]);

  const caretIdx = useMemo(() => {
    let idx = 0;
    for (let wi = 0; wi < completedTyped.length; wi++) idx += words[wi].length + 1;
    return idx + currentInput.length;
  }, [completedTyped, currentInput, words]);

  const startTimer = useCallback(() => {
    const totalSec = TIME_SECONDS[currentModeRef.current];
    elapsedRef.current = 0; wpmHistoryRef.current = [];
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      const remaining = totalSec - elapsedRef.current;
      wpmHistoryRef.current.push(calcWpm(correctCharsRef.current, elapsedRef.current));
      setTimeLeft(remaining);
      if (remaining <= 0) finishTest();
    }, 1000);
  }, []);

  const finishTest = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (statusRef.current === 'done') return;
    setStatus('done'); statusRef.current = 'done';

    const history = wpmHistoryRef.current;
    const wpm     = history.length > 0 ? history[history.length - 1] : 0;
    const rawWpm  = calcWpm(totalCharsTypedRef.current, elapsedRef.current);
    const accuracy = totalCharsTypedRef.current > 0
      ? +(correctCharsRef.current / totalCharsTypedRef.current * 100).toFixed(1) : 100;
    const consistency = calcConsistency(history);
    const errorCount  = Math.max(0, totalCharsTypedRef.current - correctCharsRef.current);

    const testResult: TestResult = { wpm, rawWpm, accuracy, consistency, errorCount, wpmHistory: history, mode: currentModeRef.current, contentType: 'words' };

    apiFetch('/api/typing/result', {
      method: 'POST',
      body: JSON.stringify({
        mode: testResult.mode, content_type: 'words',
        wpm, raw_wpm: rawWpm, accuracy, consistency,
        error_count: errorCount, wpm_history: history,
      }),
    }).then(r => r.json()).then(d => {
      setResult({ ...testResult, isPB: d.isPB, pbDiff: d.pbDiff, isBestToday: d.isBestToday, prevBestWpm: d.prevBestWpm });
    }).catch(() => setResult(testResult));

    setView('results');
  }, []);

  const resetTest = useCallback((newMode?: TimeMode) => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const m  = newMode ?? currentModeRef.current;
    const nw = generateWords('words', m);
    wordsRef.current = nw; setWords(nw);
    setStatus('idle'); statusRef.current = 'idle';
    setTimeLeft(TIME_SECONDS[m]);
    setCompletedTyped([]); setCurrentInput('');
    correctCharsRef.current = 0; totalCharsTypedRef.current = 0;
    elapsedRef.current = 0; wpmHistoryRef.current = [];
    setIsTyping(false); setIsPaused(false); setView('test'); setResult(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab')       { e.preventDefault(); resetTest(); return; }
    if (e.key === 'Escape')    { e.preventDefault(); if (statusRef.current === 'running') finishTest(); return; }
    if (e.key === 'Backspace' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setCurrentInput(''); setCompletedTyped(prev => prev.slice(0, -1));
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [resetTest, finishTest]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (statusRef.current === 'done') return;
    const val = e.target.value;
    if (statusRef.current === 'idle') { setStatus('running'); statusRef.current = 'running'; startTimer(); }

    if (val.endsWith(' ') || val.endsWith('\n')) {
      const typed    = val.trimEnd();
      // Each character was already counted keystroke-by-keystroke below.
      // Only count the space itself here (standard WPM includes spaces).
      totalCharsTypedRef.current += 1; // the space
      correctCharsRef.current    += 1; // space is always correct
      if (soundEnabled) playClick();
      setCompletedTyped(prev => { const next = [...prev, typed]; if (next.length >= wordsRef.current.length) finishTest(); return next; });
      setCurrentInput('');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    const isBackspace = val.length < currentInput.length;
    if (!isBackspace) {
      totalCharsTypedRef.current += 1;
      const wordIdx  = completedTyped.length;
      const expected = wordsRef.current[wordIdx] ?? '';
      const ci       = val.length - 1;
      const isCorrect = val[ci] === expected[ci];
      if (isCorrect) correctCharsRef.current += 1;
      if (soundEnabled) { if (isCorrect) playClick(); else playError(); }
    }
    setCurrentInput(val);
    setIsTyping(true);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => setIsTyping(false), 400);
  }, [completedTyped, currentInput, soundEnabled, startTimer, finishTest]);

  const realtimeWpm = useMemo(() => {
    if (elapsedRef.current <= 0 || status !== 'running') return 0;
    return calcWpm(correctCharsRef.current, elapsedRef.current);
  }, [status, timeLeft]);

  const accuracy = totalCharsTypedRef.current > 0
    ? Math.round(correctCharsRef.current / totalCharsTypedRef.current * 100) : 100;

  const handleContainerBlur = useCallback(() => {
    if (statusRef.current === 'running') {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setStatus('paused'); statusRef.current = 'paused'; setIsPaused(true);
    }
  }, []);

  const handleContainerFocus = useCallback(() => {
    if (statusRef.current === 'paused') {
      setStatus('running'); statusRef.current = 'running'; setIsPaused(false); startTimer();
    }
  }, [startTimer]);

  const handleModeChange = useCallback((m: TimeMode) => {
    setMode(m); currentModeRef.current = m; resetTest(m);
  }, [resetTest]);

  useEffect(() => {
    // Do NOT auto-focus on mount — the search bar owns focus on page load.
    // The word-display click overlay (below) re-focuses this input on user click.
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--surface)', overflow: 'hidden', fontFamily: "'Roboto Mono', monospace" }}
      onBlur={handleContainerBlur} onFocus={handleContainerFocus}
    >
      {/* ── Header row 1: mode + content pills ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {MODES.map(m => (
            <button key={m} onClick={() => handleModeChange(m)} className="tp-pill" style={{
              padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 9,
              background: mode === m ? 'rgba(124,106,255,0.2)' : 'transparent',
              color: mode === m ? 'var(--accent)' : 'var(--text-faint)',
              fontFamily: "'Roboto Mono', monospace",
            }}>{m}</button>
          ))}
          <div style={{ width: 1, height: 12, background: 'var(--border)', margin: '0 4px', alignSelf: 'center' }} />
          {/* Reload — generates a fresh set of words and resets the timer */}
          <button onClick={() => { const nw = generateWords('words', mode); setWords(nw); wordsRef.current = nw; resetTest(); }} className="tp-pill" style={{
            padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 13,
            background: 'transparent', color: 'var(--text-faint)', lineHeight: 1,
            transition: 'color 0.15s',
          }} title="New words">↺</button>
        </div>
        <button onClick={() => setSoundEnabled(s => !s)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, opacity: soundEnabled ? 1 : 0.3, transition: 'opacity 0.15s' }}>
          {soundEnabled ? '🔊' : '🔇'}
        </button>
      </div>

      {/* ── Header row 2: tab bar (hidden while test is running) ── */}
      {view !== 'results' && status === 'idle' && (
        <div style={{ display: 'flex', margin: '6px 12px 0', borderRadius: 6, background: 'var(--surface2)', padding: 2, flexShrink: 0 }}>
          {([['session', 'New Session'], ['leaderboard', 'Leaderboard']] as const).map(([tab, label]) => (
            <button key={tab} onClick={() => {
              setMainTab(tab);
              if (tab === 'session') setTimeout(() => inputRef.current?.focus(), 50);
            }} style={{
              flex: 1, padding: '5px 8px', border: 'none', cursor: 'pointer', fontSize: 10,
              fontFamily: "'Roboto Mono', monospace", fontWeight: 600,
              borderRadius: 5,
              background: mainTab === tab ? 'var(--surface)' : 'transparent',
              color: mainTab === tab ? 'var(--accent)' : 'var(--text-faint)',
              boxShadow: mainTab === tab ? '0 1px 4px rgba(0,0,0,0.25)' : 'none',
              transition: 'all 0.15s',
            }}>{label}</button>
          ))}
        </div>
      )}

      {/* ── Results view ── */}
      {view === 'results' && result && (
        <ResultsView
          result={result}
          onRetry={() => { resetTest(); setMainTab('session'); }}
        />
      )}

      {/* ── Leaderboard tab ── */}
      {view !== 'results' && mainTab === 'leaderboard' && status === 'idle' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '8px 12px 4px' }}>
          {/* Period sub-tabs */}
          <div style={{ display: 'flex', gap: 2, marginBottom: 8, flexShrink: 0 }}>
            {([['daily', 'Today'], ['monthly', 'Monthly'], ['alltime', 'All-time']] as const).map(([p, label]) => (
              <button key={p} onClick={() => setLbPeriod(p)} style={{
                padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 9,
                fontFamily: "'Roboto Mono', monospace", fontWeight: lbPeriod === p ? 700 : 400,
                background: lbPeriod === p ? 'rgba(124,106,255,0.18)' : 'transparent',
                color: lbPeriod === p ? 'var(--accent)' : 'var(--text-faint)',
                borderBottom: lbPeriod === p ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'all 0.15s',
              }}>{label}</button>
            ))}
          </div>
          {/* List */}
          <MiniLeaderboard mode={mode} period={lbPeriod} />
        </div>
      )}

      {/* ── Session tab (typing test) ── */}
      {view !== 'results' && (mainTab === 'session' || status !== 'idle') && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Timer + live stats — only while test is active */}
          {status !== 'idle' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px 4px', flexShrink: 0 }}>
              <TimerRing timeLeft={timeLeft} totalTime={TIME_SECONDS[mode]} />
              <div style={{ display: 'flex', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--accent)', lineHeight: 1 }}>{status === 'running' ? realtimeWpm : '—'}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 1 }}>wpm</div>
                </div>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-muted)', lineHeight: 1 }}>{status === 'running' ? `${accuracy}%` : '—'}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 1 }}>acc</div>
                </div>
              </div>
            </div>
          )}

          {/* Word display */}
          <div ref={wordContainerRef} style={{ flex: 1, padding: '0 14px', position: 'relative', overflow: 'hidden' }}>
            <WordDisplay chars={chars} caretIdx={caretIdx} isTyping={isTyping} status={status} containerRef={wordContainerRef} />
            {/* "type to begin" hint when idle */}
            {status === 'idle' && (
              <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center', fontSize: 9, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace", pointerEvents: 'none' }}>
                type to begin
              </div>
            )}
            {isPaused && (
              <div onClick={() => inputRef.current?.focus()} style={{ position: 'absolute', inset: 0, background: 'rgba(10,10,15,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', animation: 'tpFadeIn 0.2s ease' }}>
                <div style={{ fontFamily: "'Roboto Mono', monospace", fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em' }}>click to resume</div>
              </div>
            )}
          </div>

          <div style={{ padding: '8px 14px 4px', flexShrink: 0 }}>
            <input ref={inputRef} type="text"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
              disabled={status === 'done'} onKeyDown={handleKeyDown} onChange={handleInput}
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 12px', outline: 'none', fontFamily: "'Roboto Mono', monospace", fontSize: 13, color: 'var(--text)', caretColor: 'transparent', transition: 'border-color 0.15s' }}
              onFocus={e => { e.currentTarget.style.borderColor = 'rgba(124,106,255,0.4)'; }}
              onBlur={e  => { e.currentTarget.style.borderColor = 'var(--border)'; }}
            />
            <div style={{ display: 'flex', gap: 12, marginTop: 4, paddingLeft: 2, fontSize: 8, color: 'var(--text-faint)', fontFamily: "'Roboto Mono', monospace" }}>
              <span><span style={{ color: 'var(--text-muted)' }}>tab</span> restart</span>
              <span><span style={{ color: 'var(--text-muted)' }}>esc</span> stop</span>
              <span><span style={{ color: 'var(--text-muted)' }}>ctrl+⌫</span> undo word</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
