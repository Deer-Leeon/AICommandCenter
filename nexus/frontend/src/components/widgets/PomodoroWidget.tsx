import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { apiFetch } from '../../lib/api';
import { awaitPrefetchOrFetch, wcRead, wcWrite, WC_KEY } from '../../lib/widgetCache';
import { useWidgetReady } from '../../hooks/useWidgetReady';
import { useStore } from '../../store/useStore';
import type { TodoItem } from '../../types';

// ── Constants ─────────────────────────────────────────────────────────────────

const POMO_STATE_KEY = 'nexus_pomodoro_v1';
const POMO_SOUND_KEY = 'nexus_pom_sound';
const STATS_ENDPOINT = '/api/pomodoro/stats';
const SESSION_ENDPOINT = '/api/pomodoro/sessions';

type SessionType = 'focus' | 'short_break' | 'long_break';

interface PomoStats {
  todaySessions: number;
  todayMinutes:  number;
  streak:        number;
  allTimeSessions: number;
  allTimeMinutes:  number;
}

interface PomoState {
  timeLeft:             number;
  isRunning:            boolean;
  sessionType:          SessionType;
  sessionNumber:        number;   // 1–4 in the 4-session cycle
  focusDuration:        number;   // minutes
  shortBreakDuration:   number;
  longBreakDuration:    number;
  autoAdvance:          boolean;
  startTimestamp:       number | null;  // Date.now() when timer last started
}

const DEFAULT_STATE: PomoState = {
  timeLeft:           25 * 60,
  isRunning:          false,
  sessionType:        'focus',
  sessionNumber:      1,
  focusDuration:      25,
  shortBreakDuration: 5,
  longBreakDuration:  15,
  autoAdvance:        true,
  startTimestamp:     null,
};

// ── Session color schemes ─────────────────────────────────────────────────────

const SESSION_COLORS: Record<SessionType, { primary: string; secondary: string; label: string; textColor: string }> = {
  focus:       { primary: '#7c6aff', secondary: '#4f3fb3', label: 'FOCUS',       textColor: '#a899ff' },
  short_break: { primary: '#3de8b0', secondary: '#0d9488', label: 'SHORT BREAK', textColor: '#3de8b0' },
  long_break:  { primary: '#f59e0b', secondary: '#b45309', label: 'LONG BREAK',  textColor: '#fbbf24' },
};

// ── localStorage helpers ──────────────────────────────────────────────────────

function savePomoState(s: PomoState) {
  try { localStorage.setItem(POMO_STATE_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

function loadPomoState(): PomoState {
  try {
    const raw = localStorage.getItem(POMO_STATE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<PomoState>;
    const state: PomoState = { ...DEFAULT_STATE, ...parsed };
    // Drift correction: if the timer was running while tab was away, subtract elapsed seconds
    if (state.isRunning && state.startTimestamp) {
      const elapsed = Math.floor((Date.now() - state.startTimestamp) / 1000);
      state.timeLeft = Math.max(0, state.timeLeft - elapsed);
      state.startTimestamp = null;
    }
    return state;
  } catch {
    return { ...DEFAULT_STATE };
  }
}

// ── Web Audio ─────────────────────────────────────────────────────────────────

function getAudioContext(ref: React.MutableRefObject<AudioContext | null>): AudioContext | null {
  try {
    if (!ref.current) ref.current = new AudioContext();
    if (ref.current.state === 'suspended') ref.current.resume();
    return ref.current;
  } catch { return null; }
}

function playSessionEndChime(ctx: AudioContext) {
  // Ascending C-E-G chord, meditation-bell style
  const notes: [number, number][] = [[261.63, 0], [329.63, 0.18], [392.00, 0.36]];
  notes.forEach(([freq, delay]) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.28, t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 2.8);
    osc.start(t);
    osc.stop(t + 2.8);
  });
}

function playBreakEndChime(ctx: AudioContext) {
  // Two-tone ascending, more urgent
  const notes: [number, number][] = [[392.00, 0], [523.25, 0.12]];
  notes.forEach(([freq, delay]) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    osc.start(t);
    osc.stop(t + 1.4);
  });
}

function playTick(ctx: AudioContext) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.value = 880;
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.06, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  osc.start(t);
  osc.stop(t + 0.04);
}

// ── Browser notifications ─────────────────────────────────────────────────────

async function requestNotifPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function sendNotification(title: string, body: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body, icon: '/favicon.svg' }); } catch { /* */ }
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PomodoroWidget({ onClose: _onClose }: { onClose: () => void }) {
  // ── Persistent state (localStorage) ──────────────────────────────────────
  const [state, setStateRaw] = useState<PomoState>(() => loadPomoState());

  const { timeLeft, isRunning, sessionType, sessionNumber,
          focusDuration, shortBreakDuration, longBreakDuration,
          autoAdvance } = state;

  // Convenience setter that always persists
  const setState = useCallback((updater: Partial<PomoState> | ((s: PomoState) => PomoState)) => {
    setStateRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      savePomoState(next);
      return next;
    });
  }, []);

  // ── UI state (not persisted) ──────────────────────────────────────────────
  const [showSettings,      setShowSettings]      = useState(false);
  const [showTaskCompletion, setShowTaskCompletion] = useState(false);
  const [attachedTask,       setAttachedTask]       = useState<TodoItem | null>(null);
  const [notifDenied,        setNotifDenied]        = useState(false);
  const [soundEnabled,       setSoundEnabled]       = useState(
    () => localStorage.getItem(POMO_SOUND_KEY) !== 'false'
  );
  const [stats, setStats] = useState<PomoStats | null>(
    () => wcRead<PomoStats>(WC_KEY.POMODORO_STATS)?.data ?? null
  );
  const [hasLoaded, setHasLoaded] = useState(
    () => wcRead(WC_KEY.POMODORO_STATS) !== null
  );

  // Session start time — stored in a ref for POST body
  const sessionStartRef = useRef<Date>(new Date());

  // ── Sizing ────────────────────────────────────────────────────────────────
  const wrapperRef   = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 200, h: 200 });

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0) setSize({ w: width, h: height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const minDim      = Math.min(size.w, size.h);
  const ringDia     = Math.round(minDim * 0.82);
  const strokeW     = Math.max(4, Math.round(ringDia * 0.072));
  const r           = ringDia / 2 - strokeW / 2;
  const cx          = ringDia / 2;
  const cy          = ringDia / 2;
  const circum      = 2 * Math.PI * r;

  // Layout tiers based on min dimension
  const isTiny   = minDim < 120;
  const isMedium = minDim >= 200 && minDim < 280;
  const isFull    = minDim >= 280;

  // ── Derived timer values ──────────────────────────────────────────────────
  const totalSeconds = useMemo(() => {
    if (sessionType === 'focus')       return focusDuration * 60;
    if (sessionType === 'short_break') return shortBreakDuration * 60;
    return longBreakDuration * 60;
  }, [sessionType, focusDuration, shortBreakDuration, longBreakDuration]);

  const progress = totalSeconds > 0 ? timeLeft / totalSeconds : 0; // 1.0 = full, 0 = empty
  const dashOffset = circum * (1 - progress);

  // Glow dot at the trailing edge of the remaining arc
  const dotAngle = -Math.PI / 2 + (1 - progress) * 2 * Math.PI;
  const dotX = cx + r * Math.cos(dotAngle);
  const dotY = cy + r * Math.sin(dotAngle);
  const dotR = Math.max(3, strokeW * 0.62);

  const colors = SESSION_COLORS[sessionType];

  // ── Audio context ─────────────────────────────────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null);

  // ── Todos ─────────────────────────────────────────────────────────────────
  const todos = useStore(s => s.todos);
  const incompleteTasks = useMemo(() => todos.filter(t => !t.completed), [todos]);

  // Clear attached task if it gets completed elsewhere
  useEffect(() => {
    if (attachedTask && !incompleteTasks.find(t => t.id === attachedTask.id)) {
      setAttachedTask(null);
    }
  }, [incompleteTasks, attachedTask]);

  // ── Stats fetch ───────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const res = await awaitPrefetchOrFetch(STATS_ENDPOINT, () => apiFetch(STATS_ENDPOINT));
      if (!res.ok) return;
      const data: PomoStats = await res.json();
      setStats(data);
      wcWrite(WC_KEY.POMODORO_STATS, data);
    } catch { /* keep cached */ } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  // ── Reveal signal ─────────────────────────────────────────────────────────
  useWidgetReady('pomodoro', hasLoaded);

  // ── Session end handler ───────────────────────────────────────────────────
  const handleSessionEnd = useCallback(async () => {
    const ctx = getAudioContext(audioCtxRef);
    if (ctx && soundEnabled) {
      if (sessionType === 'focus') playSessionEndChime(ctx);
      else playBreakEndChime(ctx);
    }

    // Browser notification
    const allowed = await requestNotifPermission();
    if (allowed) {
      if (sessionType === 'focus') {
        sendNotification('Focus session complete 🎯', 'Time for a break!');
      } else {
        sendNotification('Break over ⚡', 'Ready to focus?');
      }
    } else if (!allowed && Notification.permission === 'denied') {
      setNotifDenied(true);
      setTimeout(() => setNotifDenied(false), 5000);
    }

    // Persist completed focus session to database
    if (sessionType === 'focus') {
      const completedAt = new Date();
      apiFetch(SESSION_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify({
          startedAt:       sessionStartRef.current.toISOString(),
          completedAt:     completedAt.toISOString(),
          durationMinutes: focusDuration,
          wasInterrupted:  false,
          attachedTaskId:  attachedTask?.id ?? null,
        }),
      }).then(() => fetchStats()).catch(() => {/* non-fatal */});

      if (attachedTask) setShowTaskCompletion(true);
    }

    // Advance to next session
    setState(prev => {
      let nextType: SessionType;
      let nextNum  = prev.sessionNumber;

      if (prev.sessionType === 'focus') {
        if (prev.sessionNumber >= 4) {
          nextType = 'long_break';
          nextNum  = 1; // reset cycle counter, will increment after long break
        } else {
          nextType = 'short_break';
        }
      } else {
        // Coming off a break → next focus session
        if (prev.sessionType === 'long_break') {
          nextNum  = 1;
        } else {
          nextNum  = prev.sessionNumber + 1;
        }
        nextType = 'focus';
      }

      const nextTotal = nextType === 'focus'
        ? prev.focusDuration * 60
        : nextType === 'short_break'
          ? prev.shortBreakDuration * 60
          : prev.longBreakDuration * 60;

      return {
        ...prev,
        sessionType:  nextType,
        sessionNumber: nextNum,
        timeLeft:     nextTotal,
        isRunning:    prev.autoAdvance,
        startTimestamp: prev.autoAdvance ? Date.now() : null,
      };
    });
  }, [sessionType, focusDuration, soundEnabled, attachedTask, fetchStats, setState]);

  // ── Tick interval ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      setState(prev => {
        if (prev.timeLeft <= 1) {
          // Fire session end asynchronously to avoid setState-in-setState
          setTimeout(() => handleSessionEnd(), 0);
          return { ...prev, timeLeft: 0, isRunning: false, startTimestamp: null };
        }
        // Subtle tick sound during focus only
        if (soundEnabled && prev.sessionType === 'focus') {
          const ctx = getAudioContext(audioCtxRef);
          if (ctx) playTick(ctx);
        }
        return { ...prev, timeLeft: prev.timeLeft - 1 };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isRunning, soundEnabled, handleSessionEnd, setState]);

  // Update startTimestamp whenever isRunning flips to true
  useEffect(() => {
    if (isRunning) {
      sessionStartRef.current = new Date();
      setState(prev => ({ ...prev, startTimestamp: Date.now() }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const handlePlayPause = useCallback(() => {
    const ctx = getAudioContext(audioCtxRef); // init AudioContext on user gesture
    void ctx; // intentionally unused here — just warms up the context
    if (!isRunning && Notification.permission === 'default') {
      requestNotifPermission().catch(() => {/* */});
    }
    setState(prev => ({ ...prev, isRunning: !prev.isRunning }));
  }, [isRunning, setState]);

  const handleSkipForward = useCallback(() => {
    setState(prev => {
      let nextType: SessionType;
      let nextNum = prev.sessionNumber;

      if (prev.sessionType === 'focus') {
        if (prev.sessionNumber >= 4) {
          nextType = 'long_break';
          nextNum  = 1;
        } else {
          nextType = 'short_break';
        }
      } else {
        if (prev.sessionType === 'long_break') nextNum = 1;
        else nextNum = prev.sessionNumber + 1;
        nextType = 'focus';
      }

      // Record interrupted focus session
      if (prev.sessionType === 'focus' && prev.timeLeft < prev.focusDuration * 60) {
        const now = new Date();
        apiFetch(SESSION_ENDPOINT, {
          method: 'POST',
          body: JSON.stringify({
            startedAt:       sessionStartRef.current.toISOString(),
            completedAt:     now.toISOString(),
            durationMinutes: prev.focusDuration,
            wasInterrupted:  true,
            attachedTaskId:  attachedTask?.id ?? null,
          }),
        }).catch(() => {/* */});
      }

      const nextTotal = nextType === 'focus'
        ? prev.focusDuration * 60
        : nextType === 'short_break'
          ? prev.shortBreakDuration * 60
          : prev.longBreakDuration * 60;

      return { ...prev, sessionType: nextType, sessionNumber: nextNum, timeLeft: nextTotal, isRunning: false, startTimestamp: null };
    });
  }, [attachedTask, setState]);

  const handleSkipBack = useCallback(() => {
    setState(prev => {
      // If more than 3 seconds have elapsed — restart current session
      const totalSec = prev.sessionType === 'focus'
        ? prev.focusDuration * 60
        : prev.sessionType === 'short_break'
          ? prev.shortBreakDuration * 60
          : prev.longBreakDuration * 60;
      if ((totalSec - prev.timeLeft) > 3) {
        return { ...prev, timeLeft: totalSec, isRunning: false, startTimestamp: null };
      }
      // Otherwise go to previous session type
      let prevType: SessionType;
      let prevNum = prev.sessionNumber;
      if (prev.sessionType === 'focus') {
        if (prev.sessionNumber <= 1) { prevType = 'long_break'; prevNum = 4; }
        else { prevType = 'short_break'; prevNum = prev.sessionNumber - 1; }
      } else if (prev.sessionType === 'short_break') {
        prevType = 'focus';
      } else {
        prevType = 'focus'; prevNum = 4;
      }
      const prevTotal = prevType === 'focus'
        ? prev.focusDuration * 60
        : prevType === 'short_break'
          ? prev.shortBreakDuration * 60
          : prev.longBreakDuration * 60;
      return { ...prev, sessionType: prevType, sessionNumber: prevNum, timeLeft: prevTotal, isRunning: false, startTimestamp: null };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setState]);

  const toggleSound = () => {
    setSoundEnabled(v => {
      const next = !v;
      localStorage.setItem(POMO_SOUND_KEY, String(next));
      return next;
    });
  };

  // ── Task completion ───────────────────────────────────────────────────────
  const toggleTodo = useStore(s => s.toggleTodo);

  const handleTaskDone = useCallback(async (done: boolean) => {
    if (done && attachedTask) {
      toggleTodo(attachedTask.id);
      apiFetch(`/api/todos/${attachedTask.id}`, {
        method: 'PUT',
        body: JSON.stringify({ completed: true }),
      }).catch(() => {/* */});
      setAttachedTask(null);
    }
    setShowTaskCompletion(false);
  }, [attachedTask, toggleTodo]);

  // ── Render helpers ────────────────────────────────────────────────────────

  const timeFontSize  = Math.max(14, ringDia * 0.22);
  const labelFontSize = Math.max(7,  ringDia * 0.08);
  const uiFs          = Math.max(9,  Math.round(minDim * 0.042));
  const uiPad         = Math.max(4,  Math.round(minDim * 0.025));

  // Unique SVG IDs per instance (avoids conflicts if widget placed multiple times)
  const gradId   = 'pomoRingGrad';
  const glowId   = 'pomoGlowFilter';
  const trackId  = 'pomoTrackGrad';

  // Session dots (4 per cycle, only visible at MEDIUM+)
  const completedInCycle = sessionType === 'focus'
    ? sessionNumber - 1
    : sessionType === 'short_break' ? sessionNumber : 4;

  function renderSessionDots() {
    const dotSz = Math.max(5, ringDia * 0.04);
    const gap   = dotSz * 1.8;
    return (
      <div style={{ display: 'flex', gap: gap, alignItems: 'center', justifyContent: 'center' }}>
        {[0, 1, 2, 3].map(i => {
          const filled  = i < completedInCycle;
          const current = i === completedInCycle && sessionType === 'focus';
          return (
            <div
              key={i}
              style={{
                width:        dotSz,
                height:       dotSz,
                borderRadius: '50%',
                background:   filled ? colors.primary : 'transparent',
                border:       `${Math.max(1.5, dotSz * 0.25)}px solid ${filled ? colors.primary : 'var(--text-faint)'}`,
                boxShadow:    current ? `0 0 6px ${colors.primary}` : 'none',
                animation:    current ? 'pomoDotPulse 1.8s ease-in-out infinite' : 'none',
                flexShrink:   0,
                transition:   'all 0.3s ease',
              }}
            />
          );
        })}
      </div>
    );
  }

  function renderRing() {
    return (
      <svg
        width={ringDia}
        height={ringDia}
        style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}
        aria-label={`${fmtTime(timeLeft)} remaining`}
      >
        <defs>
          {/* Track gradient (very subtle) */}
          <linearGradient id={trackId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="rgba(255,255,255,0.04)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
          </linearGradient>
          {/* Progress arc gradient: bright accent → deeper shade */}
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor={colors.primary} />
            <stop offset="100%" stopColor={colors.secondary} />
          </linearGradient>
          {/* Glow filter for leading-edge dot */}
          <filter id={glowId} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation={dotR * 1.6} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track ring */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={`url(#${trackId})`}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />

        {/* Progress arc */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={strokeW}
          strokeLinecap="round"
          strokeDasharray={circum}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.6s ease' }}
        />

        {/* Glow dot at the trailing edge */}
        {progress > 0.005 && (
          <circle
            cx={dotX} cy={dotY} r={dotR}
            fill={colors.primary}
            filter={`url(#${glowId})`}
            style={{ transition: 'cx 1s linear, cy 1s linear' }}
          />
        )}

        {/* Time display */}
        <text
          x={cx} y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--text)"
          fontFamily="var(--font-sans)"
          fontWeight="700"
          fontSize={timeFontSize}
          style={{ letterSpacing: '-0.02em', userSelect: 'none' }}
        >
          {fmtTime(timeLeft)}
        </text>

        {/* Session label (MEDIUM+ only, inside ring) */}
        {(isMedium || isFull) && (
          <text
            x={cx} y={cy + timeFontSize * 0.62}
            textAnchor="middle"
            dominantBaseline="hanging"
            fill={colors.textColor}
            fontFamily="var(--font-sans)"
            fontWeight="700"
            fontSize={labelFontSize}
            style={{ letterSpacing: '0.12em', userSelect: 'none', textTransform: 'uppercase' }}
          >
            {colors.label}
          </text>
        )}

        {/* TINY: invisible play/pause overlay tap target */}
        {isTiny && (
          <circle
            cx={cx} cy={cy} r={r * 0.5}
            fill="transparent"
            style={{ cursor: 'pointer' }}
            onClick={handlePlayPause}
          />
        )}
      </svg>
    );
  }

  function renderControls() {
    const btnSz   = Math.max(24, uiFs * 2.2);
    const mainSz  = Math.max(30, uiFs * 2.8);
    const btnFs   = Math.max(10, uiFs * 0.85);
    const mainFs  = Math.max(12, uiFs * 1.05);

    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: Math.max(6, uiFs * 0.7) }}>
        <button
          onClick={handleSkipBack}
          title="Restart / previous session"
          style={ctrlBtnStyle(btnSz, btnFs, false)}
        >⟨⟨</button>

        <button
          onClick={handlePlayPause}
          title={isRunning ? 'Pause' : 'Start'}
          style={{
            ...ctrlBtnStyle(mainSz, mainFs, true),
            background:  isRunning ? `rgba(${hexToRgb(colors.primary)}, 0.2)` : colors.primary,
            border:      `1.5px solid ${colors.primary}`,
            boxShadow:   isRunning ? `0 0 12px rgba(${hexToRgb(colors.primary)}, 0.35)` : 'none',
            color:       isRunning ? colors.primary : '#fff',
          }}
        >
          {isRunning ? '⏸' : '▶'}
        </button>

        <button
          onClick={handleSkipForward}
          title="Next session"
          style={ctrlBtnStyle(btnSz, btnFs, false)}
        >⟩⟩</button>
      </div>
    );
  }

  function renderSettings() {
    if (!showSettings) return null;
    const sliderStyle: React.CSSProperties = {
      width: '100%', accentColor: colors.primary, cursor: 'pointer',
    };
    return (
      <div style={{
        background:   'var(--surface2)',
        border:       '1px solid var(--border)',
        borderRadius: 8,
        padding:      `${uiPad * 0.8}px ${uiPad}px`,
        display:      'flex',
        flexDirection:'column',
        gap:          uiPad * 0.6,
      }}>
        {[
          { label: 'Focus',       val: focusDuration,      key: 'focusDuration',      min: 1,  max: 60 },
          { label: 'Short Break', val: shortBreakDuration,  key: 'shortBreakDuration', min: 1,  max: 30 },
          { label: 'Long Break',  val: longBreakDuration,   key: 'longBreakDuration',  min: 5,  max: 60 },
        ].map(({ label, val, key, min, max }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: uiPad * 0.5 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: uiFs - 1, minWidth: 66, flexShrink: 0 }}>{label}</span>
            <input
              type="range" min={min} max={max} value={val}
              style={sliderStyle}
              onChange={e => {
                const v = Number(e.target.value);
                setState(prev => {
                  const next = { ...prev, [key]: v };
                  // If changing the current session's duration, reset timeLeft
                  if (
                    (key === 'focusDuration'      && prev.sessionType === 'focus')       ||
                    (key === 'shortBreakDuration' && prev.sessionType === 'short_break') ||
                    (key === 'longBreakDuration'  && prev.sessionType === 'long_break')
                  ) {
                    next.timeLeft  = v * 60;
                    next.isRunning = false;
                    next.startTimestamp = null;
                  }
                  return next;
                });
              }}
            />
            <span style={{ color: 'var(--text-faint)', fontSize: uiFs - 1, minWidth: 24, textAlign: 'right', flexShrink: 0 }}>
              {val}m
            </span>
          </div>
        ))}

        {/* Auto-advance toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 2 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: uiFs - 1 }}>Auto-advance</span>
          <button
            onClick={() => setState(prev => ({ ...prev, autoAdvance: !prev.autoAdvance }))}
            style={{
              background:   autoAdvance ? `rgba(${hexToRgb(colors.primary)}, 0.18)` : 'var(--surface3)',
              border:       `1px solid ${autoAdvance ? colors.primary : 'var(--border)'}`,
              borderRadius: 12,
              padding:      '2px 10px',
              fontSize:     uiFs - 1,
              color:        autoAdvance ? colors.textColor : 'var(--text-faint)',
              cursor:       'pointer',
              fontWeight:   600,
              transition:   'all 0.2s',
            }}
          >
            {autoAdvance ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>
    );
  }

  function renderTaskArea() {
    if (!isFull) return null;

    if (showTaskCompletion && attachedTask) {
      return (
        <div style={{
          background:   'var(--surface2)',
          border:       `1px solid ${colors.primary}44`,
          borderRadius: 8,
          padding:      `${uiPad * 0.6}px ${uiPad}px`,
          display:      'flex',
          alignItems:   'center',
          gap:          8,
        }}>
          <span style={{ color: 'var(--text-muted)', fontSize: uiFs - 1, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Finished "{attachedTask.text}"?
          </span>
          <button onClick={() => handleTaskDone(true)}  style={taskDoneBtnStyle(true,  colors.primary, uiFs)}>✓</button>
          <button onClick={() => handleTaskDone(false)} style={taskDoneBtnStyle(false, colors.primary, uiFs)}>✗</button>
        </div>
      );
    }

    return (
      <div style={{
        background:   'var(--surface2)',
        border:       `1px solid ${attachedTask ? `${colors.primary}55` : 'var(--border)'}`,
        borderLeft:   attachedTask ? `3px solid ${colors.primary}` : '1px solid var(--border)',
        borderRadius: 8,
        padding:      `${uiPad * 0.55}px ${uiPad}px`,
        display:      'flex',
        alignItems:   'center',
        gap:          8,
        minHeight:    uiFs * 2.6,
      }}>
        {attachedTask ? (
          <>
            <span style={{ color: 'var(--text)', fontSize: uiFs - 1, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {attachedTask.text}
            </span>
            <button
              onClick={() => setAttachedTask(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontSize: uiFs, padding: '0 2px', lineHeight: 1 }}
            >×</button>
          </>
        ) : (
          <>
            <span style={{ color: 'var(--text-faint)', fontSize: uiFs - 1, flex: 1, fontStyle: 'italic' }}>
              What are you working on?
            </span>
            {incompleteTasks.length > 0 && (
              <select
                onChange={e => {
                  const task = incompleteTasks.find(t => t.id === e.target.value);
                  if (task) setAttachedTask(task);
                  e.target.value = '';
                }}
                defaultValue=""
                style={{
                  background:   'var(--surface3)',
                  border:       '1px solid var(--border)',
                  borderRadius: 5,
                  color:        'var(--text-muted)',
                  fontSize:     uiFs - 1,
                  padding:      '2px 4px',
                  cursor:       'pointer',
                  maxWidth:     120,
                }}
              >
                <option value="" disabled>Pick task</option>
                {incompleteTasks.map(t => (
                  <option key={t.id} value={t.id}>{t.text}</option>
                ))}
              </select>
            )}
          </>
        )}
      </div>
    );
  }

  // ── Full render ───────────────────────────────────────────────────────────

  const breathingActive = isRunning && sessionType === 'focus';

  return (
    <>
      <style>{`
        @keyframes pomoDotPulse {
          0%, 100% { transform: scale(1);    opacity: 1;   }
          50%       { transform: scale(1.35); opacity: 0.7; }
        }
        @keyframes pomodoroBreath {
          0%, 100% { opacity: 0.03; }
          50%       { opacity: 0.09; }
        }
      `}</style>

      <div
        ref={wrapperRef}
        style={{
          position:   'relative',
          display:    'flex',
          flexDirection: 'column',
          alignItems: 'center',
          height:     '100%',
          width:      '100%',
          overflow:   'hidden',
          padding:    isTiny ? 0 : uiPad,
          gap:        isTiny ? 0 : Math.max(3, uiPad * 0.6),
          background: 'var(--surface)',
        }}
      >
        {/* Ambient breathing overlay */}
        <div style={{
          position:   'absolute',
          inset:       0,
          background: `radial-gradient(circle at center, ${colors.primary} 0%, transparent 70%)`,
          pointerEvents: 'none',
          opacity:    0,
          animation:  breathingActive ? 'pomodoroBreath 8s ease-in-out infinite' : 'none',
          transition: 'animation 0.5s',
          zIndex:     0,
        }} />

        {/* Top bar (COMPACT+): sound toggle + settings gear + stat */}
        {!isTiny && (
          <div style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            width:          '100%',
            flexShrink:     0,
            position:       'relative',
            zIndex:         1,
          }}>
            <button onClick={toggleSound} title={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
              style={iconBtnStyle(uiFs)}>
              {soundEnabled ? '🔊' : '🔇'}
            </button>

            {(isMedium || isFull) && stats && (
              <span style={{ color: 'var(--text-faint)', fontSize: uiFs - 1 }}>
                {stats.todaySessions > 0 ? `${stats.todaySessions} today${stats.streak > 1 ? ` · 🔥${stats.streak}` : ''}` : 'No sessions yet'}
              </span>
            )}

            {(isMedium || isFull) && (
              <button onClick={() => setShowSettings(v => !v)} title="Settings"
                style={{ ...iconBtnStyle(uiFs), color: showSettings ? colors.textColor : 'var(--text-faint)' }}>
                ⚙
              </button>
            )}
            {!(isMedium || isFull) && <div style={{ width: uiFs * 1.8 }} />}
          </div>
        )}

        {/* Notification denied banner */}
        {notifDenied && (
          <div style={{
            width:        '100%',
            background:   'rgba(245,158,11,0.12)',
            border:       '1px solid rgba(245,158,11,0.35)',
            borderRadius: 6,
            padding:      `${uiPad * 0.4}px ${uiPad}px`,
            fontSize:     uiFs - 2,
            color:        '#fbbf24',
            textAlign:    'center',
            flexShrink:   0,
            zIndex:       1,
          }}>
            Notifications blocked. Allow them in browser settings.
          </div>
        )}

        {/* Ring — grows to fill available vertical space */}
        <div style={{
          flex:           '1 1 0',
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            isTiny ? 0 : Math.max(4, uiPad * 0.5),
          width:          '100%',
          position:       'relative',
          zIndex:         1,
          minHeight:      ringDia,
        }}>
          {renderRing()}
          {/* Session dots: MEDIUM+ only */}
          {(isMedium || isFull) && renderSessionDots()}
        </div>

        {/* Controls (COMPACT+) */}
        {!isTiny && (
          <div style={{ flexShrink: 0, width: '100%', position: 'relative', zIndex: 1 }}>
            {renderControls()}
          </div>
        )}

        {/* Task area (FULL only) */}
        {isFull && (
          <div style={{ flexShrink: 0, width: '100%', position: 'relative', zIndex: 1 }}>
            {renderTaskArea()}
          </div>
        )}

        {/* Stats line (FULL only) */}
        {isFull && stats && stats.todaySessions > 0 && (
          <div style={{
            color:      'var(--text-faint)',
            fontSize:   uiFs - 1,
            fontFamily: 'var(--font-sans)',
            textAlign:  'center',
            flexShrink: 0,
            position:   'relative',
            zIndex:     1,
          }}>
            {stats.todaySessions} session{stats.todaySessions !== 1 ? 's' : ''} · {fmtMinutes(stats.todayMinutes)} today
            {stats.streak > 1 ? ` · 🔥 ${stats.streak} day streak` : ''}
          </div>
        )}

        {/* Settings panel (MEDIUM+) */}
        {(isMedium || isFull) && showSettings && (
          <div style={{ flexShrink: 0, width: '100%', position: 'relative', zIndex: 1 }}>
            {renderSettings()}
          </div>
        )}
      </div>
    </>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function ctrlBtnStyle(size: number, fs: number, isMain: boolean): React.CSSProperties {
  return {
    width:        size,
    height:       size,
    borderRadius: '50%',
    background:   isMain ? 'var(--accent)' : 'var(--surface2)',
    border:       `1.5px solid ${isMain ? 'var(--accent)' : 'var(--border)'}`,
    color:        isMain ? '#fff' : 'var(--text-muted)',
    fontSize:     fs,
    cursor:       'pointer',
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
    flexShrink:   0,
    transition:   'background 0.15s, box-shadow 0.15s, color 0.15s',
    lineHeight:   1,
    padding:      0,
  };
}

function iconBtnStyle(uiFs: number): React.CSSProperties {
  return {
    background:   'none',
    border:       'none',
    color:        'var(--text-faint)',
    cursor:       'pointer',
    fontSize:     uiFs,
    padding:      '2px 4px',
    borderRadius: 4,
    lineHeight:   1,
    transition:   'color 0.15s',
  };
}

function taskDoneBtnStyle(isDone: boolean, accent: string, uiFs: number): React.CSSProperties {
  return {
    background:   isDone ? `${accent}28` : 'var(--surface3)',
    border:       `1px solid ${isDone ? accent : 'var(--border)'}`,
    borderRadius: 6,
    color:        isDone ? accent : 'var(--text-faint)',
    cursor:       'pointer',
    fontSize:     uiFs,
    padding:      '2px 8px',
    fontWeight:   700,
    transition:   'all 0.15s',
  };
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '124, 106, 255';
  return `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`;
}
