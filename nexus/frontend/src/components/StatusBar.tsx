import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { useTheme } from '../hooks/useTheme';
import type { ThemeMode } from '../hooks/useTheme';
import { useAuth } from '../hooks/useAuth';
import { useProfileContext } from '../contexts/ProfileContext';
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

// ── Sidebar toggle ────────────────────────────────────────────────────────────
function SidebarToggleBtn({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={visible ? 'Hide sidebar' : 'Show sidebar'}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 6px',
        height: 18,
        border: '1px solid var(--border)',
        borderRadius: 4,
        background: visible ? 'transparent' : 'rgba(var(--accent-rgb),0.12)',
        color: visible ? 'var(--text-muted)' : 'var(--accent)',
        cursor: 'pointer',
        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = 'rgba(var(--accent-rgb),0.15)';
        el.style.color = 'var(--accent)';
        el.style.borderColor = 'rgba(var(--accent-rgb),0.4)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = visible ? 'transparent' : 'rgba(var(--accent-rgb),0.12)';
        el.style.color = visible ? 'var(--text-muted)' : 'var(--accent)';
        el.style.borderColor = 'var(--border)';
      }}
    >
      {/* Sidebar panel icon: outer rect + left column divider */}
      <svg width="14" height="12" viewBox="0 0 14 12" fill="none" style={{ display: 'block' }}>
        <rect x="0.6" y="0.6" width="12.8" height="10.8" rx="1.8" stroke="currentColor" strokeWidth="1.2"/>
        <line x1="4.5" y1="0.6" x2="4.5" y2="11.4" stroke="currentColor" strokeWidth="1.2"/>
        {visible && (
          <>
            <rect x="6" y="3.5" width="5.5" height="1.2" rx="0.6" fill="currentColor" opacity="0.55"/>
            <rect x="6" y="5.4" width="4" height="1.2" rx="0.6" fill="currentColor" opacity="0.4"/>
            <rect x="6" y="7.3" width="5" height="1.2" rx="0.6" fill="currentColor" opacity="0.45"/>
          </>
        )}
        {!visible && (
          /* ▶ arrow indicating panel is hidden */
          <path d="M6.5 6 L9.5 4 L9.5 8 Z" fill="currentColor" opacity="0.7"/>
        )}
      </svg>
    </button>
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

// ── User avatar ───────────────────────────────────────────────────────────────
function UserAvatarBtn({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { user, signOut } = useAuth();
  const profile = useProfileContext();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;
  const displayLabel = profile?.displayName || user?.email?.split('@')[0] || '?';

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!user) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(p => !p)}
        title={displayLabel}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 20, borderRadius: '50%',
          padding: 0, border: '1px solid var(--border)',
          background: 'var(--surface2)', cursor: 'pointer',
          overflow: 'hidden', flexShrink: 0,
          transition: 'border-color 0.12s, opacity 0.12s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(var(--accent-rgb),0.5)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 9, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
            {displayLabel.charAt(0).toUpperCase()}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            right: 0,
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: 'var(--shadow-popup)',
            minWidth: 160,
            padding: '8px 12px',
            zIndex: 200,
          }}
        >
          <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {profile?.username ? `@${profile.username}` : displayLabel}
          </span>
          <div style={{ borderTop: '1px solid var(--border)', marginBottom: 6 }} />
          <button
            onClick={() => { setOpen(false); onOpenSettings(); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', padding: '2px 0', marginBottom: 2 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
          >
            ⚙ Settings
          </button>
          <button
            onClick={() => { setOpen(false); signOut(); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-danger)', padding: '2px 0' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.7'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

interface StatusBarProps {
  onLayoutClick?: () => void;
  isLayoutMode?: boolean;
  sidebarVisible?: boolean;
  onToggleSidebar?: () => void;
  onOpenSettings?: () => void;
}

export function StatusBar({ onLayoutClick, isLayoutMode = false, sidebarVisible = true, onToggleSidebar, onOpenSettings }: StatusBarProps) {
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
      style={{
        height: '28px',
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        flexShrink: 0,
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        paddingLeft: '16px',
        paddingRight: '16px',
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

      {/* Center branding */}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '10px',
          fontWeight: 700,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          background: 'linear-gradient(135deg, var(--accent), var(--teal))',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          userSelect: 'none',
          pointerEvents: 'none',
          opacity: 0.7,
        }}
      >
        NEXUS
      </span>

      <div className="flex items-center gap-2" style={{ justifySelf: 'end' }}>
        {onToggleSidebar && (
          <SidebarToggleBtn visible={sidebarVisible} onToggle={onToggleSidebar} />
        )}
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
        {onOpenSettings && <UserAvatarBtn onOpenSettings={onOpenSettings} />}
      </div>
    </div>
  );
}
