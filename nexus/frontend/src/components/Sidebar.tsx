import { useState, useRef, useEffect, useCallback } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { WIDGET_CONFIGS, type WidgetConfig } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useProfileContext } from '../contexts/ProfileContext';
import { PresenceDot } from './PresenceDot';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
  onOpenConnections?: () => void;
  layoutMode?: boolean;
  onExitLayout?: () => void;
}

const CATEGORY_ORDER: WidgetConfig['category'][] = ['Work', 'Music', 'Finance', 'Games', 'Info', 'Tools'];

function DraggableChip({ config, isOpen, pulse }: { config: WidgetConfig; isOpen: boolean; pulse: number }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: config.id });
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (pulse === 0) return;
    setAnimating(true);
    const t = setTimeout(() => setAnimating(false), 500);
    return () => clearTimeout(t);
  }, [pulse]);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="flex items-center rounded-md cursor-grab active:cursor-grabbing select-none"
      style={{
        opacity: isDragging ? 0.35 : 1,
        background: 'transparent',
        border: '1px solid transparent',
        padding: '5px 8px',
        gap: isOpen ? '9px' : '0px',
        justifyContent: isOpen ? 'flex-start' : 'center',
        marginBottom: isOpen ? '1px' : '0px',
        transition: 'background 0.15s, border-color 0.15s, margin-bottom 0.22s ease, gap 0.22s ease',
        animation: animating ? 'nexusChipPulse 0.45s ease' : 'none',
        transformOrigin: 'center',
        overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'var(--surface2)';
        (e.currentTarget as HTMLElement).style.borderColor = config.accentColor + '30';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
        (e.currentTarget as HTMLElement).style.borderColor = 'transparent';
      }}
    >
      {/* Icon pill — centers itself when sidebar is collapsed */}
      <div
        className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
        style={{ background: config.accentColor + '18', fontSize: '13px' }}
      >
        {config.icon}
      </div>

      {/* Label — collapses to zero width when closed so it never displaces the icon */}
      <span
        style={{
          fontWeight: 500,
          fontSize: '12px',
          color: 'var(--text-muted)',
          opacity: isOpen ? 1 : 0,
          maxWidth: isOpen ? '160px' : '0px',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          letterSpacing: '0.01em',
          flexShrink: 0,
          pointerEvents: 'none',
          transition: isOpen
            ? 'opacity 0.18s ease 0.12s, max-width 0.22s ease'
            : 'opacity 0.08s ease, max-width 0.22s ease 0.06s',
        }}
      >
        {config.label}
      </span>
    </div>
  );
}

function CategorySection({ category, configs, isOpen, pulse }: {
  category: WidgetConfig['category'];
  configs: WidgetConfig[];
  isOpen: boolean;
  pulse: number;
}) {
  return (
    <div style={{
      // Gap between groups only when expanded; collapses to nothing when closed
      marginBottom: isOpen ? '10px' : '0px',
      transition: isOpen ? 'margin-bottom 0.28s ease' : 'margin-bottom 0.28s ease 0.06s',
    }}>
      {/* Section label — collapses to 0 height when closed, so icons stack tight */}
      <div style={{
        overflow: 'hidden',
        maxHeight: isOpen ? '20px' : '0px',
        paddingBottom: isOpen ? '4px' : '0px',
        paddingLeft: '8px',
        paddingRight: '8px',
        transition: isOpen
          ? 'max-height 0.28s ease, padding-bottom 0.28s ease, opacity 0.18s ease 0.12s'
          : 'max-height 0.22s ease 0.06s, padding-bottom 0.22s ease 0.06s, opacity 0.08s ease',
        opacity: isOpen ? 1 : 0,
      }}>
        <span style={{
          display: 'block',
          fontSize: '9px',
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-faint)',
          fontFamily: 'var(--font-mono)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>
          {category}
        </span>
      </div>

      {configs.map(config => (
        <DraggableChip key={config.id} config={config} isOpen={isOpen} pulse={pulse} />
      ))}
    </div>
  );
}

function UserBlock({ isOpen, onOpenSettings }: { isOpen: boolean; onOpenSettings: () => void }) {
  const { user, signOut } = useAuth();
  const profile = useProfileContext();
  const [popupOpen, setPopupOpen] = useState(false);
  const avatarUrl = user?.user_metadata?.avatar_url as string | undefined;
  const containerRef = useRef<HTMLDivElement>(null);

  const displayLabel = profile?.displayName || user?.email?.split('@')[0] || user?.email || '—';
  const usernameLabel = profile?.username ? `@${profile.username}` : null;

  // Close popup when clicking outside
  useEffect(() => {
    if (!popupOpen) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPopupOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [popupOpen]);

  if (!user) return null;

  const avatarEl = avatarUrl ? (
    <img
      src={avatarUrl}
      alt="avatar"
      className="w-7 h-7 rounded-full flex-shrink-0"
      style={{ border: '1px solid var(--border)' }}
    />
  ) : (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono flex-shrink-0"
      style={{ background: 'var(--surface2)', color: 'var(--accent)', border: '1px solid var(--border)' }}
    >
      {displayLabel.charAt(0).toUpperCase() || '?'}
    </div>
  );

  return (
    <div ref={containerRef} className="relative px-2 pb-4">
      {/* "Drag widgets" hint — only visible when expanded */}
      <div
        style={{
          overflow: 'hidden',
          maxHeight: isOpen ? '40px' : '0px',
          opacity: isOpen ? 1 : 0,
          transition: isOpen
            ? 'opacity 0.18s ease 0.15s, max-height 0.28s ease'
            : 'opacity 0.06s ease, max-height 0.28s ease 0.06s',
        }}
      >
        <p className="text-xs mb-3" style={{ color: 'var(--text-faint)', fontSize: '10px', lineHeight: 1.5, fontFamily: 'var(--font-mono)' }}>
          Drag widgets onto the grid
        </p>
      </div>

      {/* Clickable user row — popup anchors to this wrapper */}
      <div className="relative">
        <button
          onClick={() => setPopupOpen((p) => !p)}
          className="flex items-center w-full transition-opacity"
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            gap: isOpen ? '8px' : '0px',
            justifyContent: isOpen ? 'flex-start' : 'center',
          }}
        >
          {avatarEl}
          <span
            className="text-xs truncate flex-1 min-w-0 text-left overflow-hidden"
            style={{
              color: 'var(--text-faint)',
              fontSize: '10px',
              opacity: isOpen ? 1 : 0,
              maxWidth: isOpen ? '160px' : '0px',
              whiteSpace: 'nowrap',
              transition: isOpen
                ? 'opacity 0.18s ease 0.15s, max-width 0.28s ease'
                : 'opacity 0.06s ease, max-width 0.28s ease 0.06s',
            }}
          >
            {usernameLabel ? `${displayLabel} ${usernameLabel}` : displayLabel}
          </span>
        </button>

        {/* Sign-out popup — floats 4px above the row, overlapping whatever is above */}
        {popupOpen && (
          <div
            className="absolute rounded-lg px-3 py-2 flex flex-col gap-1.5"
            style={{
              bottom: 'calc(100% + 4px)',
              left: 0,
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--shadow-popup)',
              minWidth: '160px',
              zIndex: 100,
            }}
          >
            <span className="text-xs truncate" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
              {usernameLabel ? `${displayLabel} ${usernameLabel}` : displayLabel}
            </span>
            <div className="my-1" style={{ borderTop: '1px solid var(--border)' }} />
            <button
              onClick={() => { setPopupOpen(false); onOpenSettings(); }}
              className="text-xs font-mono text-left flex items-center gap-1.5 transition-opacity"
              style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '11px' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)')}
            >
              ⚙ Settings
            </button>
            <button
              onClick={() => { setPopupOpen(false); signOut(); }}
              className="text-xs font-mono text-left transition-opacity"
              style={{ color: 'var(--color-danger)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '11px' }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.7')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Sidebar({ isOpen, onToggle, onOpenSettings, onOpenConnections, layoutMode = false, onExitLayout: _onExitLayout }: SidebarProps) {
  const [pulseCount, setPulseCount] = useState(0);

  const handleHint = useCallback(() => {
    setPulseCount(n => n + 1);
  }, []);

  useEffect(() => {
    window.addEventListener('nexus:hint-sidebar', handleHint);
    return () => window.removeEventListener('nexus:hint-sidebar', handleHint);
  }, [handleHint]);

  return (
    <>
      <style>{`
        @keyframes nexusChipPulse {
          0%   { transform: scale(1);    background: var(--surface2); border-color: var(--border); }
          35%  { transform: scale(1.07); background: rgba(167,139,250,0.18); border-color: rgba(167,139,250,0.55); }
          100% { transform: scale(1);    background: var(--surface2); border-color: var(--border); }
        }
      `}</style>
    <div
      className="relative flex-shrink-0 flex flex-col transition-all duration-300"
      style={{
        width: isOpen ? '220px' : '60px',
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'visible',
      }}
    >
      {/* Inner clipping wrapper for the chips list — min-h-0 prevents flex from
          ignoring the height constraint, which would push UserBlock off-screen */}
      <div className="flex flex-col flex-1 min-h-0" style={{ overflow: 'hidden' }}>
        {/* Header */}
        <div className="flex items-center px-3 pt-4 pb-3" style={{ minHeight: '52px', position: 'relative', zIndex: 1 }}>
          <div
            style={{
              overflow: 'hidden',
              opacity: isOpen ? 1 : 0,
              maxWidth: isOpen ? '160px' : '0px',
              whiteSpace: 'nowrap',
              transition: isOpen
                ? 'opacity 0.18s ease 0.15s, max-width 0.28s ease'
                : 'opacity 0.06s ease, max-width 0.28s ease 0.06s',
            }}
          >
            <span
              className="text-xs font-mono tracking-widest uppercase"
              style={{
                color: layoutMode ? 'var(--teal)' : 'var(--text-muted)',
                letterSpacing: '0.15em',
              }}
            >
              {layoutMode ? 'Layout Mode' : 'Widgets'}
            </span>
          </div>
        </div>

        {/* Layout mode instructions OR widget chips */}
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {layoutMode ? (
            /* ── Layout instructions ── */
            <div
              style={{
                overflow: 'hidden',
                opacity: isOpen ? 1 : 0,
                maxWidth: isOpen ? '220px' : '0px',
                padding: isOpen ? '0 10px' : 0,
                /* Only transition opacity — NOT padding/maxWidth, which cause text reflow */
                transition: 'opacity 0.2s ease',
                animation: 'nexusLayoutFadeIn 0.28s ease both',
              }}
            >
              {/* Merge instruction */}
              <div style={{
                borderRadius: 8, padding: '10px 10px',
                background: 'rgba(61,232,176,0.06)',
                border: '1px solid rgba(61,232,176,0.18)',
                marginBottom: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 13 }}>↔</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--teal)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Merge</span>
                </div>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                  Drag any <strong style={{ color: 'var(--teal)' }}>outer edge</strong> of an empty cell into the adjacent empty cell. Pull past 25% to commit.
                </p>
              </div>

              {/* Split instruction */}
              <div style={{
                borderRadius: 8, padding: '10px 10px',
                background: 'rgba(167,139,250,0.06)',
                border: '1px solid rgba(167,139,250,0.18)',
                marginBottom: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 13 }}>✂</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Split</span>
                </div>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                  <strong style={{ color: 'var(--accent)' }}>Double-click</strong> any merged empty cell to split it back into individual cells.
                </p>
              </div>

            </div>
          ) : (
            /* ── Widget chips grouped by category ── */
            <div className="h-full overflow-y-auto nexus-scroll" style={{ padding: '2px 8px 0', overflowX: 'hidden' }}>
              {CATEGORY_ORDER.map(cat => {
                const configs = WIDGET_CONFIGS.filter(c => c.category === cat);
                if (configs.length === 0) return null;
                return (
                  <CategorySection
                    key={cat}
                    category={cat}
                    configs={configs}
                    isOpen={isOpen}
                    pulse={pulseCount}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Presence dot — shows connected partner's online status; only when a connection exists */}
      {onOpenConnections && (
        <div
          style={{
            display:        'flex',
            justifyContent: isOpen ? 'flex-start' : 'center',
            padding:        '0 16px 6px',
          }}
        >
          <PresenceDot onOpenConnections={onOpenConnections} />
        </div>
      )}

      {/* User block — outside the clipped wrapper so popup can overflow upward */}
      <UserBlock isOpen={isOpen} onOpenSettings={onOpenSettings} />

      {/* Collapse toggle */}
      <button
        onClick={onToggle}
        className="absolute top-1/2 -translate-y-1/2 -right-3 z-10 w-6 h-6 rounded-full flex items-center justify-center text-xs transition-colors"
        style={{
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'var(--surface3)';
          (e.currentTarget as HTMLElement).style.color = 'var(--text)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = 'var(--surface2)';
          (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
        }}
      >
        {isOpen ? '◀' : '▶'}
      </button>
    </div>
    </>
  );
}
