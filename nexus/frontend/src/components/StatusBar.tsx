import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
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

interface StatusBarProps {
  onLayoutClick?: () => void;
}

export function StatusBar({ onLayoutClick }: StatusBarProps) {
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
        {onLayoutClick && (
          <button
            onClick={onLayoutClick}
            title="Edit grid layout"
            className="font-mono"
            style={{
              fontSize: '10px',
              padding: '1px 6px',
              borderRadius: '4px',
              lineHeight: '16px',
              letterSpacing: '0.04em',
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = 'rgba(61,232,176,0.45)';
              el.style.color = 'var(--teal)';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget as HTMLElement;
              el.style.borderColor = 'var(--border)';
              el.style.color = 'var(--text-muted)';
            }}
          >
            ⊞ Layout
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
