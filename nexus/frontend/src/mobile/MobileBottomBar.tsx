import { useState, useEffect } from 'react';
import { useTodos } from '../hooks/useTodos';

// ── SVG icons for fullscreen toggle ──────────────────────────────────────────
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

interface Props {
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

type Sheet = 'quickadd' | null;

export function MobileBottomBar({ onOpenSearch, onOpenSettings, isFullscreen, onToggleFullscreen }: Props) {
  const [sheet, setSheet] = useState<Sheet>(null);

  return (
    <>
      <div style={{
        height: 56, flexShrink: 0,
        background: 'var(--bar-bg)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-around',
        paddingBottom: 'env(safe-area-inset-bottom)',
        position: 'relative', zIndex: 200,
      }}>
        <BarBtn icon="🔍" label="Search" onClick={onOpenSearch} />
        <BarBtn icon="＋" label="Add" onClick={() => setSheet('quickadd')} />
        <BarBtn icon="⚙️" label="Settings" onClick={onOpenSettings} />
        {/* Fullscreen toggle — rightmost button */}
        <button
          onClick={onToggleFullscreen}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            background: 'none', border: 'none', cursor: 'pointer',
            minWidth: 44, minHeight: 44, padding: '4px 16px',
            justifyContent: 'center', color: 'var(--text-muted)',
            touchAction: 'manipulation',
          }}
        >
          {isFullscreen ? <CollapseIcon /> : <ExpandIcon />}
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
            {isFullscreen ? 'Restore' : 'Focus'}
          </span>
        </button>
      </div>

      {sheet === 'quickadd' && (
        <QuickAddSheet onClose={() => setSheet(null)} />
      )}
    </>
  );
}

function BarBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      background: 'none', border: 'none', cursor: 'pointer',
      minWidth: 44, minHeight: 44, padding: '4px 16px',
      justifyContent: 'center',
    }}>
      <span style={{ fontSize: 20 }}>{icon}</span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>{label}</span>
    </button>
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
              { icon: '✅', label: 'Add task', action: () => setMode('task') },
              { icon: '🍅', label: 'Start focus session', action: () => { /* open pomodoro */ dismiss(); } },
              { icon: '📝', label: 'New note', action: () => { /* handled via notes card */ dismiss(); } },
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
