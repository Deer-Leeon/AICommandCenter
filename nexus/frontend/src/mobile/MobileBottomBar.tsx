import { useState, useEffect } from 'react';
import { useTodos } from '../hooks/useTodos';

// ── SVG icon set ──────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 19 19" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <line x1="13" y1="13" x2="17.5" y2="17.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 19 19" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <line x1="9.5" y1="2" x2="9.5" y2="17" />
      <line x1="2" y1="9.5" x2="17" y2="9.5" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 19 19" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round">
      <line x1="1.5" y1="5.5" x2="17.5" y2="5.5" />
      <circle cx="6" cy="5.5" r="2.2" fill="currentColor" stroke="none" />
      <line x1="1.5" y1="13.5" x2="17.5" y2="13.5" />
      <circle cx="13" cy="13.5" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 6V1h5M1 1l4.5 4.5" />
      <path d="M16 6V1h-5M16 1l-4.5 4.5" />
      <path d="M1 11v5h5M1 16l4.5-4.5" />
      <path d="M16 11v5h-5M16 16l-4.5-4.5" />
    </svg>
  );
}

function CollapseIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 1v5H1M6 6L1.5 1.5" />
      <path d="M11 1v5h5M11 6l4.5-4.5" />
      <path d="M6 16v-5H1M6 11l-4.5 4.5" />
      <path d="M11 16v-5h5M11 11l4.5 4.5" />
    </svg>
  );
}

// ── Pill button ───────────────────────────────────────────────────────────────

type BtnVariant = 'default' | 'accent' | 'active';

function PillBtn({
  icon, label, onClick, variant = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  variant?: BtnVariant;
}) {
  const [pressed, setPressed] = useState(false);

  const isAccent = variant === 'accent';
  const isActive = variant === 'active';

  return (
    <button
      onClick={onClick}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        background: 'none', border: 'none', cursor: 'pointer',
        padding: '6px 10px',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
        flex: 1,
      }}
    >
      {/* Icon pill */}
      <div style={{
        width: 46, height: 34,
        borderRadius: 11,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isAccent
          ? 'linear-gradient(135deg, rgba(var(--accent-rgb),0.28) 0%, rgba(var(--accent-rgb),0.16) 100%)'
          : isActive
          ? 'rgba(var(--accent-rgb),0.12)'
          : pressed
          ? 'rgba(255,255,255,0.08)'
          : 'rgba(255,255,255,0.04)',
        border: isAccent
          ? '1px solid rgba(var(--accent-rgb),0.4)'
          : isActive
          ? '1px solid rgba(var(--accent-rgb),0.25)'
          : '1px solid rgba(255,255,255,0.07)',
        color: isAccent || isActive ? 'var(--accent)' : 'var(--text-muted)',
        transform: pressed ? 'scale(0.88)' : 'scale(1)',
        transition: 'transform 0.13s cubic-bezier(0.25,0.46,0.45,0.94), background 0.15s ease, border-color 0.15s ease',
        boxShadow: isAccent
          ? '0 0 14px rgba(var(--accent-rgb),0.18), inset 0 1px 0 rgba(255,255,255,0.08)'
          : isActive
          ? '0 0 8px rgba(var(--accent-rgb),0.1)'
          : 'none',
      }}>
        {icon}
      </div>

      {/* Label */}
      <span style={{
        fontSize: 9,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: isAccent || isActive ? 'var(--accent)' : 'var(--text-faint)',
        fontWeight: isAccent || isActive ? 700 : 400,
        transition: 'color 0.15s ease',
        lineHeight: 1,
      }}>
        {label}
      </span>
    </button>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

type Sheet = 'quickadd' | null;

// ── Bottom bar ────────────────────────────────────────────────────────────────

export function MobileBottomBar({ onOpenSearch, onOpenSettings, isFullscreen, onToggleFullscreen }: Props) {
  const [sheet, setSheet] = useState<Sheet>(null);

  return (
    <>
      <div style={{
        height: 62, flexShrink: 0,
        background: 'var(--bar-bg)',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        position: 'relative', zIndex: 200,
        display: 'flex', flexDirection: 'column',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {/* Gradient top border line */}
        <div style={{
          height: 1, flexShrink: 0,
          background: 'linear-gradient(90deg, transparent 0%, rgba(var(--accent-rgb),0.35) 35%, rgba(var(--accent-rgb),0.35) 65%, transparent 100%)',
        }} />

        {/* Buttons row */}
        <div style={{
          flex: 1,
          display: 'flex', alignItems: 'center',
          padding: '0 4px',
        }}>
          <PillBtn icon={<SearchIcon />}  label="Search"   onClick={onOpenSearch} />
          <PillBtn icon={<PlusIcon />}    label="Add"      onClick={() => setSheet('quickadd')} variant="accent" />
          <PillBtn icon={<SlidersIcon />} label="Settings" onClick={onOpenSettings} />
          <PillBtn
            icon={isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
            label={isFullscreen ? 'Restore' : 'Focus'}
            onClick={onToggleFullscreen}
            variant={isFullscreen ? 'active' : 'default'}
          />
        </div>
      </div>

      {sheet === 'quickadd' && (
        <QuickAddSheet onClose={() => setSheet(null)} />
      )}
    </>
  );
}

// ── Quick Add Sheet ───────────────────────────────────────────────────────────

interface QuickAddSheetProps { onClose: () => void; }

function QuickAddSheet({ onClose }: QuickAddSheetProps) {
  const { createTodo } = useTodos();
  const [taskText, setTaskText] = useState('');
  const [mode, setMode] = useState<'menu' | 'task'>('menu');
  const [slideIn, setSlideIn] = useState(false);

  useEffect(() => { requestAnimationFrame(() => setSlideIn(true)); }, []);

  const dismiss = () => { setSlideIn(false); setTimeout(onClose, 300); };

  const handleAddTask = async () => {
    if (!taskText.trim()) return;
    await createTodo(taskText.trim());
    dismiss();
  };

  return (
    <>
      {/* Backdrop */}
      <div onClick={dismiss} style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      }} />

      {/* Sheet */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 301,
        background: 'var(--surface2)',
        borderRadius: '20px 20px 0 0',
        border: '1px solid var(--border)',
        transform: slideIn ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-hover)' }} />
        </div>

        {mode === 'menu' ? (
          <div style={{ padding: '8px 20px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Quick Add
            </div>
            {[
              { icon: '✅', label: 'Add task',          action: () => setMode('task') },
              { icon: '🍅', label: 'Start focus session', action: () => { dismiss(); } },
              { icon: '📝', label: 'New note',           action: () => { dismiss(); } },
            ].map(item => (
              <button key={item.label} onClick={item.action} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px', borderRadius: 14,
                background: 'var(--surface3)', border: '1px solid var(--border)',
                cursor: 'pointer', textAlign: 'left',
              }}>
                <span style={{ fontSize: 22 }}>{item.icon}</span>
                <span style={{ fontSize: 16, color: 'var(--text)', fontWeight: 500 }}>{item.label}</span>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ padding: '8px 20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button onClick={() => setMode('menu')} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', textAlign: 'left', fontSize: 14, padding: '4px 0' }}>← Back</button>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>New Task</div>
            <input
              autoFocus
              value={taskText}
              onChange={e => setTaskText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddTask(); }}
              placeholder="What needs to be done?"
              style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
                borderRadius: 12, padding: '13px 16px', fontSize: 16,
                color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
              }}
            />
            <button onClick={handleAddTask} style={{
              background: 'var(--accent)', border: 'none', borderRadius: 12,
              padding: '14px', fontSize: 16, color: '#fff', cursor: 'pointer', fontWeight: 600,
            }}>
              Add Task
            </button>
          </div>
        )}
      </div>
    </>
  );
}
