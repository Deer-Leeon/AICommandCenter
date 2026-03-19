import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import type { Page } from '../types';

// ── Curated emoji suggestions ─────────────────────────────────────────────
const EMOJI_SUGGESTIONS = [
  '🏠','💼','📊','💰','🎮','🎵','🏋️','✈️','🌍','💡','🔬','📚',
  '🎯','⚽','🏎️','🎬','🍕','🎸','🏖️','🧠','🚀','🌙','☀️','❄️',
  '🌿','🎨','📷','🛠️','🎪','🧪','🏆','💎','🔥','⚡','🌊','🎲',
  '📱','💻','🎧','🏔️','🎭','🌺','🦋','🐾','🍀','🎁','⭐','🔮',
];

const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  { label: 'Suggested', emojis: EMOJI_SUGGESTIONS.slice(0, 16) },
  { label: 'More',      emojis: EMOJI_SUGGESTIONS.slice(16) },
];

// ── Context menu ─────────────────────────────────────────────────────────────
interface CtxMenuState {
  pageId: string;
  x: number;
  y: number;
}

// ── Name/emoji picker ─────────────────────────────────────────────────────────
interface PickerState {
  pageId: string | null;   // null = creating a new page
  initialName: string;
  initialEmoji: string;
  anchorX: number;
  anchorY: number;
}

function NamePicker({
  state,
  onConfirm,
  onCancel,
}: {
  state: PickerState;
  onConfirm: (name: string, emoji: string) => void;
  onCancel: () => void;
}) {
  const [name,  setName]  = useState(state.initialName);
  const [emoji, setEmoji] = useState(state.initialEmoji);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onCancel();
      }
    }
    // Delay so the triggering click doesn't immediately close the picker
    const t = setTimeout(() => document.addEventListener('mousedown', handle), 100);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handle); };
  }, [onCancel]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); onConfirm(name.trim() || 'Page', emoji); }
    if (e.key === 'Escape') onCancel();
  }

  // Position picker below the nav bar (anchored near clicked tab)
  const vpW = window.innerWidth;
  const PICKER_W = 280;
  const left = Math.max(8, Math.min(state.anchorX - PICKER_W / 2, vpW - PICKER_W - 8));

  return (
    <div
      ref={pickerRef}
      style={{
        position:   'fixed',
        top:        60,
        left,
        width:      PICKER_W,
        zIndex:     1000,
        background: 'var(--surface2)',
        border:     '1px solid var(--border)',
        borderRadius: 16,
        boxShadow:  '0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)',
        padding:    '14px 14px 12px',
        animation:  'pagePickerIn 0.18s cubic-bezier(0.34,1.56,0.64,1) both',
      }}
    >
      {/* Selected emoji preview + name input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 24, userSelect: 'none' }}>{emoji}</span>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 20))}
          onKeyDown={handleKeyDown}
          placeholder="Page name..."
          maxLength={20}
          style={{
            flex: 1, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '6px 10px', color: 'var(--text)',
            fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none',
          }}
        />
      </div>

      {/* Emoji grid */}
      {EMOJI_CATEGORIES.map((cat) => (
        <div key={cat.label}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 4, letterSpacing: '0.08em' }}>
            {cat.label.toUpperCase()}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginBottom: 8 }}>
            {cat.emojis.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                style={{
                  width: 32, height: 32, fontSize: 18,
                  background: emoji === e ? 'rgba(var(--accent-rgb),0.18)' : 'transparent',
                  border: emoji === e ? '1px solid rgba(var(--accent-rgb),0.4)' : '1px solid transparent',
                  borderRadius: 6, cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.1s, border-color 0.1s',
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1, padding: '7px 0',
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, color: 'var(--text-muted)', cursor: 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: 12,
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(name.trim() || 'Page', emoji)}
          style={{
            flex: 2, padding: '7px 0',
            background: 'var(--accent)', border: 'none',
            borderRadius: 8, color: '#fff', cursor: 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
          }}
        >
          {state.pageId ? 'Save' : 'Create'}
        </button>
      </div>
    </div>
  );
}

// ── Context menu ─────────────────────────────────────────────────────────────
function ContextMenu({
  state,
  pages,
  onRename,
  onMoveLeft,
  onMoveRight,
  onDelete,
  onClose,
}: {
  state: CtxMenuState;
  pages: Page[];
  onRename: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const idx = pages.findIndex((p) => p.id === state.pageId);
  const isFirst = idx === 0;
  const isLast  = idx === pages.length - 1;
  const isOnly  = pages.length === 1;

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    const t = setTimeout(() => document.addEventListener('mousedown', handle), 50);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handle); };
  }, [onClose]);

  const menuW = 170;
  const vpW   = window.innerWidth;
  const vpH   = window.innerHeight;
  const left  = Math.min(state.x, vpW - menuW - 8);
  const top   = Math.min(state.y, vpH - 200);

  const items = [
    { label: '✏️  Rename',     action: onRename,    disabled: false   },
    { label: '⬅️  Move left',  action: onMoveLeft,  disabled: isFirst },
    { label: '➡️  Move right', action: onMoveRight, disabled: isLast  },
    { label: '🗑️  Delete',     action: onDelete,    disabled: isOnly, danger: true },
  ];

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed', left, top, zIndex: 2000,
        background: 'var(--surface2)', border: '1px solid var(--border)',
        borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        padding: '4px 0', minWidth: menuW,
        animation: 'pageCtxIn 0.12s ease both',
      }}
    >
      {items.map(({ label, action, disabled, danger }) => (
        <button
          key={label}
          disabled={disabled}
          onClick={() => { action(); onClose(); }}
          style={{
            width: '100%', padding: '8px 14px', textAlign: 'left',
            background: 'transparent', border: 'none',
            color: disabled ? 'var(--text-muted)' : (danger ? '#f87171' : 'var(--text)'),
            cursor: disabled ? 'default' : 'pointer',
            fontFamily: 'var(--font-mono)', fontSize: 12,
            opacity: disabled ? 0.4 : 1,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Delete confirmation ───────────────────────────────────────────────────────
function DeleteConfirm({ page, onConfirm, onCancel }: { page: Page; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onCancel]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)',
    }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface2)', border: '1px solid var(--border)',
          borderRadius: 14, padding: '20px 24px', maxWidth: 320, width: '90vw',
          animation: 'pagePickerIn 0.18s ease both',
        }}
      >
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
          Delete page?
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          Delete {page.emoji} <strong style={{ color: 'var(--text)' }}>{page.name}</strong>? All widgets on this page will be removed and cannot be recovered.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: '8px 0',
              background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 8, color: 'var(--text-muted)', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 12,
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1, padding: '8px 0',
              background: '#ef4444', border: 'none',
              borderRadius: 8, color: '#fff', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main PageNavBar ───────────────────────────────────────────────────────────
export function PageNavBar() {
  const {
    pages, activePage,
    setActivePage, addPage, deletePage, renamePage, reorderPages,
  } = useStore();

  const [ctxMenu,        setCtxMenu]        = useState<CtxMenuState | null>(null);
  const [picker,         setPicker]         = useState<PickerState | null>(null);
  const [deleteTarget,   setDeleteTarget]   = useState<Page | null>(null);

  const tabsRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view
  useEffect(() => {
    const container = tabsRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>('[data-active="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activePage]);

  const openPicker = useCallback((
    pageId: string | null,
    name: string,
    emoji: string,
    anchorX: number,
  ) => {
    setPicker({ pageId, initialName: name, initialEmoji: emoji, anchorX, anchorY: 0 });
    setCtxMenu(null);
  }, []);

  function handlePickerConfirm(name: string, emoji: string) {
    if (!picker) return;
    if (picker.pageId) {
      renamePage(picker.pageId, name, emoji);
    } else {
      addPage(name, emoji);
    }
    setPicker(null);
  }

  function handleContextMenu(e: React.MouseEvent, pageId: string) {
    e.preventDefault();
    setCtxMenu({ pageId, x: e.clientX, y: e.clientY - 10 });
  }

  function handleMoveLeft(pageId: string) {
    const idx = pages.findIndex((p) => p.id === pageId);
    if (idx > 0) reorderPages(idx, idx - 1);
  }

  function handleMoveRight(pageId: string) {
    const idx = pages.findIndex((p) => p.id === pageId);
    if (idx < pages.length - 1) reorderPages(idx, idx + 1);
  }

  // Don't render during initial load (no pages yet)
  if (pages.length === 0) return null;

  const ctxPage = ctxMenu ? pages.find((p) => p.id === ctxMenu.pageId) : null;

  return (
    <>
      {/* Floating pill */}
      <div
        style={{
          position:  'fixed',
          top:       8,
          left:      '50%',
          transform: 'translateX(-50%)',
          zIndex:    200,
          display:   'flex',
          alignItems:'center',
          gap:       2,
          maxWidth:  '70vw',
          background:'rgba(var(--surface-rgb, 18,16,36), 0.88)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border:    '1px solid var(--border)',
          borderRadius: 32,
          boxShadow: '0 4px 24px rgba(0,0,0,0.45), 0 1px 4px rgba(0,0,0,0.3)',
          padding:   '4px 6px',
          userSelect:'none',
        }}
      >
        {/* Tab list (scrollable) */}
        <div
          ref={tabsRef}
          style={{
            display: 'flex', alignItems: 'center', gap: 2,
            overflowX: 'auto', scrollbarWidth: 'none',
          }}
          className="nexus-nav-tabs"
        >
          {pages.map((page) => {
            const isActive = page.id === activePage;
            return (
              <button
                key={page.id}
                data-active={isActive}
                onClick={() => setActivePage(page.id)}
                onContextMenu={(e) => handleContextMenu(e, page.id)}
                style={{
                  display:    'flex',
                  alignItems: 'center',
                  gap:        5,
                  padding:    '5px 11px',
                  borderRadius: 24,
                  border:     'none',
                  cursor:     'pointer',
                  transition: 'background 0.15s, opacity 0.15s',
                  background: isActive ? 'var(--surface2)' : 'transparent',
                  opacity:    isActive ? 1 : 0.55,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                <span style={{ fontSize: isActive ? 17 : 15, transition: 'font-size 0.15s', lineHeight: 1 }}>
                  {page.emoji}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize:   11,
                    fontWeight: isActive ? 700 : 400,
                    color:      isActive ? 'var(--text)' : 'var(--text-muted)',
                    maxWidth:   96,
                    overflow:   'hidden',
                    textOverflow: 'ellipsis',
                    transition: 'color 0.15s, font-weight 0.15s',
                  }}
                >
                  {page.name.slice(0, 12)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Divider + add button */}
        <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0, margin: '0 2px' }} />
        <button
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openPicker(null, 'New Page', '📄', rect.left + rect.width / 2);
          }}
          title="Add page"
          style={{
            width: 30, height: 30, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none',
            borderRadius: 20, cursor: 'pointer',
            color: 'var(--accent)',
            fontSize: 18, fontWeight: 300,
            transition: 'background 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.15)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          ＋
        </button>
      </div>

      {/* Name/emoji picker popover */}
      {picker && (
        <NamePicker
          state={picker}
          onConfirm={handlePickerConfirm}
          onCancel={() => setPicker(null)}
        />
      )}

      {/* Context menu */}
      {ctxMenu && ctxPage && (
        <ContextMenu
          state={ctxMenu}
          pages={pages}
          onRename={() => {
            const p = pages.find((pg) => pg.id === ctxMenu.pageId)!;
            openPicker(p.id, p.name, p.emoji, ctxMenu.x);
          }}
          onMoveLeft={() => handleMoveLeft(ctxMenu.pageId)}
          onMoveRight={() => handleMoveRight(ctxMenu.pageId)}
          onDelete={() => {
            setDeleteTarget(ctxPage);
            setCtxMenu(null);
          }}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <DeleteConfirm
          page={deleteTarget}
          onConfirm={() => { deletePage(deleteTarget.id); setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
