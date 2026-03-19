import { useEffect, useState, useRef } from 'react';
import { useStore } from '../store/useStore';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../hooks/useAuth';
import { useProfileContext } from '../contexts/ProfileContext';
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
  if (state.lastConfirmedAt === null) return '#f59e0b';
  return '#ef4444';
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

// ── Sidebar toggle ────────────────────────────────────────────────────────────
function SidebarToggle({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={isOpen ? 'Hide sidebar' : 'Show sidebar'}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 18,
        padding: 0,
        border: '1px solid var(--border)',
        borderRadius: 4,
        background: isOpen ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
        color: isOpen ? 'var(--accent)' : 'var(--text-muted)',
        cursor: 'pointer',
        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
        flexShrink: 0,
      }}
    >
      {/* Panel-layout icon: outer rect + vertical divider */}
      <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <rect x="0.7" y="0.7" width="12.6" height="8.6" rx="1.5" />
        <line x1="4.5" y1="0.7" x2="4.5" y2="9.3" />
      </svg>
    </button>
  );
}

// ── Theme toggle ──────────────────────────────────────────────────────────────
const THEME_OPTIONS: { value: ThemeMode; label: string; title: string }[] = [
  { value: 'dark',  label: '☾', title: 'Dark mode' },
  { value: 'auto',  label: '◐', title: 'Auto (follows system)' },
  { value: 'light', label: '☀', title: 'Light mode' },
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

// ── Profile button ────────────────────────────────────────────────────────────
function ProfileButton({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { user } = useAuth();
  const profile  = useProfileContext();
  const [hover, setHover] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!user) return null;

  const avatarUrl    = user.user_metadata?.avatar_url as string | undefined;
  const displayLabel = profile?.displayName || user.email?.split('@')[0] || '?';
  const initial      = displayLabel.charAt(0).toUpperCase();

  const handleMouseEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setHover(true);
  };
  const handleMouseLeave = () => {
    timerRef.current = setTimeout(() => setHover(false), 80);
  };

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        onClick={onOpenSettings}
        title={`${displayLabel} · Open settings`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          padding: 0,
          border: 'none',
          borderRadius: '50%',
          cursor: 'pointer',
          background: 'none',
          overflow: 'hidden',
          flexShrink: 0,
          outline: hover ? '2px solid rgba(var(--accent-rgb),0.5)' : '2px solid transparent',
          outlineOffset: '1px',
          transition: 'outline-color 0.15s',
        }}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={displayLabel}
            style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{
            width: 22, height: 22, borderRadius: '50%',
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 700,
            color: 'var(--accent)',
          }}>
            {initial}
          </div>
        )}
      </button>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface StatusBarProps {
  onLayoutClick?: () => void;
  isLayoutMode?: boolean;
  isSidebarOpen?: boolean;
  onSidebarToggle?: () => void;
  onOpenSettings?: () => void;
}

export function StatusBar({
  onLayoutClick,
  isLayoutMode = false,
  isSidebarOpen = false,
  onSidebarToggle,
  onOpenSettings,
}: StatusBarProps) {
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
      {/* Left cluster — service connection indicators */}
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

      {/* Right cluster — controls + clock + profile */}
      <div className="flex items-center gap-3">
        {/* Sidebar toggle */}
        {onSidebarToggle && (
          <SidebarToggle isOpen={isSidebarOpen} onToggle={onSidebarToggle} />
        )}

        {/* Theme toggle */}
        <ThemeToggle />

        {/* Layout mode button */}
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

        {/* Clock */}
        <span
          className="font-mono text-xs"
          style={{ color: 'var(--text-muted)', fontSize: '11px' }}
        >
          {clock}
        </span>

        {/* Profile avatar — rightmost */}
        {onOpenSettings && <ProfileButton onOpenSettings={onOpenSettings} />}
      </div>
    </div>
  );
}
