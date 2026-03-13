import { useState, useEffect, useRef } from 'react';

const POMO_KEY = 'nexus_pomodoro_v1';

type SessionType = 'focus' | 'short_break' | 'long_break';

interface PomoState {
  timeLeft: number;
  isRunning: boolean;
  sessionType: SessionType;
  sessionNumber: number;
  focusDuration: number;
  shortBreakDuration: number;
  longBreakDuration: number;
  startTimestamp: number | null;
}

const DEFAULT: PomoState = {
  timeLeft: 25 * 60, isRunning: false, sessionType: 'focus',
  sessionNumber: 1, focusDuration: 25, shortBreakDuration: 5,
  longBreakDuration: 15, startTimestamp: null,
};

const COLORS: Record<SessionType, { primary: string; label: string }> = {
  focus:       { primary: '#7c6aff', label: 'FOCUS' },
  short_break: { primary: '#3de8b0', label: 'SHORT BREAK' },
  long_break:  { primary: '#f59e0b', label: 'LONG BREAK' },
};

function loadState(): PomoState {
  try {
    const raw = localStorage.getItem(POMO_KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw) as Partial<PomoState> };
  } catch { /* ignore */ }
  return DEFAULT;
}

function saveState(s: PomoState) {
  try { localStorage.setItem(POMO_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function MobilePomodoroCard() {
  const [pomo, setPomo] = useState<PomoState>(loadState);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync running timer
  useEffect(() => {
    if (pomo.isRunning && pomo.startTimestamp) {
      const elapsed = Math.floor((Date.now() - pomo.startTimestamp) / 1000);
      const total = (pomo.sessionType === 'focus' ? pomo.focusDuration
        : pomo.sessionType === 'short_break' ? pomo.shortBreakDuration
        : pomo.longBreakDuration) * 60;
      const tl = Math.max(0, total - elapsed);
      if (tl !== pomo.timeLeft) setPomo(p => ({ ...p, timeLeft: tl }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pomo.isRunning) {
      tickRef.current = setInterval(() => {
        setPomo(p => {
          if (!p.isRunning) return p;
          const tl = Math.max(0, p.timeLeft - 1);
          const next = { ...p, timeLeft: tl };
          saveState(next);
          return next;
        });
      }, 1000);
    } else if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [pomo.isRunning]);

  const colors = COLORS[pomo.sessionType];
  const total = (pomo.sessionType === 'focus' ? pomo.focusDuration
    : pomo.sessionType === 'short_break' ? pomo.shortBreakDuration
    : pomo.longBreakDuration) * 60;
  const progress = 1 - pomo.timeLeft / total;
  const r = 90; const circ = 2 * Math.PI * r;

  const toggle = () => {
    setPomo(p => {
      const next = { ...p, isRunning: !p.isRunning, startTimestamp: !p.isRunning ? Date.now() - (total - p.timeLeft) * 1000 : null };
      saveState(next);
      return next;
    });
  };

  const skip = () => {
    setPomo(p => {
      const isLast = p.sessionNumber >= 4;
      const next: PomoState = {
        ...p,
        isRunning: false,
        startTimestamp: null,
        sessionType: p.sessionType === 'focus' ? (isLast ? 'long_break' : 'short_break') : 'focus',
        sessionNumber: p.sessionType !== 'focus' ? (p.sessionNumber % 4) + 1 : p.sessionNumber,
        timeLeft: p.sessionType === 'focus'
          ? (isLast ? p.longBreakDuration : p.shortBreakDuration) * 60
          : p.focusDuration * 60,
      };
      saveState(next);
      return next;
    });
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 24 }}>
      {/* Session label */}
      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: colors.primary, letterSpacing: '0.12em' }}>
        {colors.label} · #{pomo.sessionNumber}
      </div>

      {/* Ring timer */}
      <div style={{ position: 'relative', width: 200, height: 200 }}>
        <svg width={200} height={200} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={100} cy={100} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={10} />
          <circle cx={100} cy={100} r={r} fill="none" stroke={colors.primary} strokeWidth={10}
            strokeDasharray={circ} strokeDashoffset={circ * (1 - progress)}
            strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.5s linear' }} />
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ fontSize: 40, fontWeight: 800, color: 'var(--text)', fontFamily: 'var(--font-mono)', letterSpacing: '-1px' }}>
            {fmt(pomo.timeLeft)}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <button onClick={skip} style={{
          width: 48, height: 48, borderRadius: '50%',
          background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
          fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>⏭</button>

        <button onClick={toggle} style={{
          width: 68, height: 68, borderRadius: '50%',
          background: colors.primary, border: 'none',
          fontSize: 24, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 0 24px ${colors.primary}66`,
        }}>
          {pomo.isRunning ? '⏸' : '▶'}
        </button>

        <button onClick={skip} style={{
          width: 48, height: 48, borderRadius: '50%',
          background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
          fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: 0.5,
        }}>↺</button>
      </div>
    </div>
  );
}
