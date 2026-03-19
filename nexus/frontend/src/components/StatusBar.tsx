import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { useTheme } from '../hooks/useTheme';
import type { ThemeMode } from '../hooks/useTheme';
import type { ServiceConnectionState } from '../types';

const SERVICE_LABELS: Record<string, string> = {
  ollama: 'Ollama',
  googleCalendar: 'Calendar',
  googleTasks: 'Tasks',
  googleDocs: 'Docs',
  googleDrive: 'Drive',
  slack: 'Slack',
  obsidian: 'Obsidian',
  plaid: 'Finance',
};

// Color rules:
// green  = confirmed connected within CONNECTION_TIMEOUT
// yellow = initial load only (never successfully connected yet)
// red    = confirmed disconnected (had good data before, now lost it)
function dotColor(state: ServiceConnectionState): string {
  if (state.connected) return '#3de8b0';
  if (state.lastConfirmedAt === null) return '#f59e0b'; // never been connected
  return '#ef4444'; // was connected before, now disconnected
}

function StatusDot({ state }: { state: ServiceConnectionState }) {
  const color = dotColor(state);
  return (
    <div
      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
      style={{
        background: color,
        boxShadow: state.connected ? `0 0 4px ${color}` : 'none',
      }}
    />
  );
}

// ── Theme toggle ──────────────────────────────────────────────────────────────
const THEME_OPTIONS: { value: ThemeMode; label: string; title: string }[] = [
  { value: 'dark',  label: '☾',  title: 'Dark mode' },
  { value: 'auto',  label: '◐',  title: 'Auto (follows system)' },
  { value: 'light', label: '☀',  title: 'Light mode' },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div
      title="Color scheme"
      style={{
        display: 'flex',
        border: '1px solid var(--border)',
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      {THEME_OPTIONS.map(({ value, label, title }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            onClick={() => setTheme(value)}
            title={title}
            style={{
              padding: '0 7px',
              height: 18,
              fontSize: 11,
              border: 'none',
              borderLeft: value !== 'dark' ? '1px solid var(--border)' : 'none',
              borderRadius: 0,
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              background: active ? 'rgba(var(--accent-rgb),0.15)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-muted)',
              transition: 'background 0.12s, color 0.12s',
              lineHeight: 1,
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

interface StatusBarProps {
  onLayoutClick?: () => void;
  isLayoutMode?: boolean;
}

export function StatusBar({ onLayoutClick, isLayoutMode = false }: StatusBarProps) {
  const { serviceStates } = useStore();
  const [clock, setClock] = useState('');

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      const h = now.getHours().toString().padStart(2, '0');
      const m = now.getMinutes().toString().padStart(2, '0');
      const s = now.getSeconds().toString().padStart(2, '0');
      setClock(`${h}:${m}:${s}`);
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="flex items-center justify-between px-4"
      style={{
        height: '28px',
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        flexShrink: 0,
      }}
    >
      <div className="flex items-center gap-4">
        {Object.entries(serviceStates).map(([service, state]) => (
          <div key={service} className="flex items-center gap-1.5">
            <StatusDot state={state} />
            <span
              className="font-mono text-xs"
              style={{ color: 'var(--text-muted)', fontSize: '11px' }}
            >
              {SERVICE_LABELS[service] || service}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <ThemeToggle />
        {onLayoutClick && (
          <button
            onClick={onLayoutClick}
            title={isLayoutMode ? 'Save layout' : 'Edit grid layout'}
            className="font-mono"
            style={{
              fontSize: '10px',
              padding: '1px 8px',
              borderRadius: '4px',
              lineHeight: '16px',
              letterSpacing: '0.04em',
              background: isLayoutMode ? 'rgba(61,232,176,0.1)' : 'transparent',
              border: isLayoutMode ? '1px solid rgba(61,232,176,0.55)' : '1px solid var(--border)',
              color: isLayoutMode ? 'var(--teal)' : 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'border-color 0.15s, color 0.15s, background 0.15s',
              fontWeight: isLayoutMode ? 700 : 400,
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = 'rgba(61,232,176,0.7)';
              el.style.color = 'var(--teal)';
              el.style.background = 'rgba(61,232,176,0.15)';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = isLayoutMode ? 'rgba(61,232,176,0.55)' : 'var(--border)';
              el.style.color = isLayoutMode ? 'var(--teal)' : 'var(--text-muted)';
              el.style.background = isLayoutMode ? 'rgba(61,232,176,0.1)' : 'transparent';
            }}
          >
            {isLayoutMode ? '✓ Save' : '⊞ Layout'}
          </button>
        )}
        <span
          className="font-mono text-xs"
          style={{ color: 'var(--text-muted)', fontSize: '11px' }}
        >
          {clock}
        </span>
      </div>
    </div>
  );
}
