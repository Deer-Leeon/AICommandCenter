import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuickLinks } from '../../hooks/useQuickLinks';
import { useWidgetReady } from '../../hooks/useWidgetReady';
import type { QuickLink } from '../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getFaviconUrl(url: string): string {
  try {
    const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  } catch { return ''; }
}

function getDomain(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch { return url; }
}

function getShortName(url: string): string {
  return getDomain(url).split('.')[0] ?? getDomain(url);
}

// ─── Popular presets ──────────────────────────────────────────────────────────

// 15 presets = 3 rows × 5 cols — the most universally used sites
const POPULAR_PRESETS = [
  { name: 'Google',    url: 'https://google.com'       },
  { name: 'YouTube',   url: 'https://youtube.com'      },
  { name: 'Gmail',     url: 'https://mail.google.com'  },
  { name: 'GitHub',    url: 'https://github.com'       },
  { name: 'Reddit',    url: 'https://reddit.com'       },
  { name: 'Netflix',   url: 'https://netflix.com'      },
  { name: 'ChatGPT',   url: 'https://chat.openai.com'  },
  { name: 'Claude',    url: 'https://claude.ai'        },
  { name: 'X',         url: 'https://x.com'            },
  { name: 'Amazon',    url: 'https://amazon.com'       },
  { name: 'Instagram', url: 'https://instagram.com'    },
  { name: 'LinkedIn',  url: 'https://linkedin.com'     },
  { name: 'Spotify',   url: 'https://open.spotify.com' },
  { name: 'Figma',     url: 'https://figma.com'        },
  { name: 'Notion',    url: 'https://notion.so'        },
].map(p => ({ ...p, faviconUrl: getFaviconUrl(p.url) }));

const TOTAL_SLOTS = 40;

// ─── FaviconImage ─────────────────────────────────────────────────────────────

function FaviconImage({ src, name, size = 28, style: extraStyle }: { src: string; name: string; size?: number; style?: React.CSSProperties }) {
  const [failed, setFailed] = useState(false);
  if (failed || !src) {
    return (
      <div style={{
        width: size, height: size, borderRadius: 6, flexShrink: 0,
        background: 'linear-gradient(135deg, rgba(124,106,255,0.25), rgba(61,232,176,0.18))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.48, fontWeight: 700, color: 'var(--accent)',
        fontFamily: 'var(--font-mono)', border: '1px solid rgba(124,106,255,0.2)',
        ...extraStyle,
      }}>
        {name?.[0]?.toUpperCase() || '?'}
      </div>
    );
  }
  return (
    <img src={src} alt={name} width={size} height={size}
      draggable={false}
      style={{ borderRadius: 4, display: 'block', flexShrink: 0, ...extraStyle }}
      onError={() => setFailed(true)} />
  );
}

// ─── Context menu ─────────────────────────────────────────────────────────────

function ContextMenu({ x, y, link, onOpen, onEdit, onRemove, onClose }: {
  x: number; y: number; link: QuickLink;
  onOpen(): void; onEdit(): void; onRemove(): void; onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); };
  }, [onClose]);

  return (
    <div ref={ref} style={{
      position: 'absolute', top: y, left: x, zIndex: 30,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 8, boxShadow: 'var(--shadow-modal)', overflow: 'hidden', minWidth: 130,
    }}>
      <div style={{
        padding: '5px 10px 4px', borderBottom: '1px solid var(--border)',
        color: 'var(--text-faint)', fontSize: 10, fontFamily: 'var(--font-mono)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200,
      }}>
        {link.displayName}
      </div>
      {([
        { label: 'Open',   action: onOpen,   danger: false },
        { label: 'Edit',   action: onEdit,   danger: false },
        { label: 'Remove', action: onRemove, danger: true  },
      ] as const).map(item => (
        <button key={item.label}
          onClick={(e) => { e.stopPropagation(); item.action(); onClose(); }}
          style={{
            display: 'block', width: '100%', textAlign: 'left',
            padding: '7px 12px', background: 'transparent', border: 'none',
            cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)',
            color: item.danger ? 'var(--color-danger)' : 'var(--text)',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background =
              item.danger ? 'rgba(239,68,68,0.08)' : 'var(--row-bg)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ─── Add / Edit modal ─────────────────────────────────────────────────────────

function AddEditModal({ slotIndex, existingLink, onSave, onClose }: {
  slotIndex: number; existingLink: QuickLink | undefined;
  onSave(link: QuickLink): void; onClose(): void;
}) {
  const [url, setUrl] = useState(existingLink?.url ?? '');
  const [displayName, setDisplayName] = useState(existingLink?.displayName ?? '');
  const [faviconPreview, setFaviconPreview] = useState(existingLink?.faviconUrl ?? '');
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => { urlInputRef.current?.focus(); }, []);

  useEffect(() => {
    const trimmed = url.trim();
    setFaviconPreview(trimmed ? getFaviconUrl(trimmed) : '');
    if (!trimmed) return;
    setDisplayName(prev => (!prev || prev === getShortName(url)) ? getShortName(trimmed) : prev);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  function handlePresetClick(preset: (typeof POPULAR_PRESETS)[0]) {
    onSave({ slotIndex, url: preset.url, displayName: preset.name, faviconUrl: preset.faviconUrl });
  }

  function handleSaveCustom() {
    const trimmed = url.trim();
    if (!trimmed) return;
    const finalUrl = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
    onSave({ slotIndex, url: finalUrl,
      displayName: displayName.trim() || getShortName(finalUrl),
      faviconUrl: getFaviconUrl(finalUrl) });
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '6px 8px', boxSizing: 'border-box',
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: 6, outline: 'none', color: 'var(--text)',
    fontSize: 11, fontFamily: 'var(--font-mono)',
  };

  return (
    <div
      style={{
        position: 'absolute', inset: 0, zIndex: 20,
        background: 'var(--overlay-bg)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 10, // breathing room from widget edges
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 14, boxShadow: 'var(--shadow-modal)',
        width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '7px 10px 6px', flexShrink: 0,
          borderBottom: '1px solid var(--border)', background: 'var(--surface2)',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-muted)',
          }}>
            {existingLink ? 'Edit Link' : 'Add Link'}
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-faint)', fontSize: 15, lineHeight: 1, padding: '0 2px',
          }}>×</button>
        </div>

        {/* Presets — only when adding */}
        {!existingLink && (
          <div style={{ padding: '7px 8px 0', flexShrink: 0 }}>
            <p style={{
              fontSize: 8, color: 'var(--text-faint)', marginBottom: 5,
              fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em',
            }}>Popular</p>
            {/* gridAutoRows locks every cell to identical height regardless of label length */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gridAutoRows: '48px',
              gap: 4,
            }}>
              {POPULAR_PRESETS.map(preset => (
                <button key={preset.url} onClick={() => handlePresetClick(preset)} title={preset.name}
                  style={{
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: 3, padding: '0 2px',
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 8, cursor: 'pointer', transition: 'all 0.1s', outline: 'none',
                    height: '100%',
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.background = 'var(--surface3)';
                    el.style.borderColor = 'var(--border-hover)';
                    el.style.transform = 'scale(1.05)';
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLElement;
                    el.style.background = 'var(--surface2)';
                    el.style.borderColor = 'var(--border)';
                    el.style.transform = 'scale(1)';
                  }}
                >
                  <FaviconImage src={preset.faviconUrl} name={preset.name} size={18} />
                  <span style={{
                    fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                    overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap', maxWidth: '100%', lineHeight: 1,
                  }}>{preset.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Divider */}
        {!existingLink && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px 4px' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 8, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>or</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>
        )}

        {/* Custom URL form */}
        <div style={{ padding: '0 8px 8px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {url.trim() && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 7px',
              borderRadius: 6, background: 'var(--surface2)', border: '1px solid var(--border)',
            }}>
              <FaviconImage src={faviconPreview} name={displayName || '?'} size={14} />
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {displayName || getDomain(url)}
              </span>
            </div>
          )}
          <input ref={urlInputRef} type="url" value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveCustom(); }}
            placeholder="https://example.com" style={inputStyle}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(124,106,255,0.4)'; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
          />
          <input type="text" value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveCustom(); }}
            placeholder="Display name" style={inputStyle}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(124,106,255,0.4)'; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
          />
          <button onClick={handleSaveCustom} disabled={!url.trim()}
            className="nexus-teal-btn"
            style={{
              width: '100%', padding: '6px', borderRadius: 6,
              cursor: url.trim() ? 'pointer' : 'not-allowed',
              opacity: url.trim() ? 1 : 0.4,
              fontSize: 10, fontFamily: 'var(--font-mono)',
              border: '1px solid rgba(61,232,176,0.25)',
            }}
          >
            {existingLink ? 'Save changes' : 'Add link'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── QuickLinksWidget ─────────────────────────────────────────────────────────

export function QuickLinksWidget({ onClose: _onClose }: { onClose: () => void }) {
  const { links, saveLink, removeLink, swapLinks, hasLoaded } = useQuickLinks();
  useWidgetReady('links', hasLoaded);

  const [editMode, setEditMode] = useState(false);
  const [modalSlot, setModalSlot] = useState<number | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ idx: number; x: number; y: number } | null>(null);

  // ── Drag state — React state for re-renders, refs for synchronous checks ──
  const [dragSrc,    setDragSrc]    = useState<number | null>(null);
  const [dragDst,    setDragDst]    = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false); // true once past threshold
  const [dragPos,    setDragPos]    = useState<{ x: number; y: number } | null>(null);

  interface FlyingIcon { link: QuickLink; fromX: number; fromY: number; toX: number; toY: number; size: number; hiddenSlotIdx: number; }
  const [flyingIcon,    setFlyingIcon]   = useState<FlyingIcon | null>(null);
  const [landingSlot,   setLandingSlot]  = useState<number | null>(null); // slot fading in during cross-dissolve

  // Refs mirror state so pointer-move handlers see synchronous values immediately
  const dragSrcRef    = useRef<number | null>(null);
  const dragDstRef    = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartPos  = useRef<{ x: number; y: number } | null>(null);
  const linksRef      = useRef(links); // always-current snapshot for use in callbacks
  const gridRef       = useRef<HTMLDivElement>(null);
  const DRAG_THRESHOLD = 8;

  // Keep linksRef current on every render
  linksRef.current = links;

  // Exit edit mode cleanly when toggled off
  function toggleEditMode() {
    setEditMode(prev => {
      if (prev) { // turning off
        setCtxMenu(null);
        setModalSlot(null);
        setDragSrc(null);
        setDragDst(null);
        setIsDragging(false);
        setDragPos(null);
        setFlyingIcon(null);
        setLandingSlot(null);
        dragStartPos.current  = null;
        dragSrcRef.current    = null;
        dragDstRef.current    = null;
        isDraggingRef.current = false;
      }
      return !prev;
    });
  }

  const handleGridPointerDown = useCallback((e: React.PointerEvent) => {
    if (!editMode) return;
    e.stopPropagation();
    const slotEl = (e.target as Element).closest('[data-slot-idx]');
    if (!slotEl) return;
    const idx = parseInt(slotEl.getAttribute('data-slot-idx') ?? '', 10);
    if (isNaN(idx) || !links[idx]) return; // only filled slots can be dragged
    dragStartPos.current  = { x: e.clientX, y: e.clientY };
    dragSrcRef.current    = idx;
    dragDstRef.current    = idx;
    isDraggingRef.current = false;
    setDragSrc(idx);
    setDragDst(idx);
    setIsDragging(false);
  }, [editMode, links]);

  const handleGridPointerMove = useCallback((e: React.PointerEvent) => {
    // Use refs for synchronous reads — state updates are async and miss early moves
    if (dragSrcRef.current === null || !dragStartPos.current) return;
    const dx = e.clientX - dragStartPos.current.x;
    const dy = e.clientY - dragStartPos.current.y;
    if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;

    if (!isDraggingRef.current) {
      isDraggingRef.current = true;
      setIsDragging(true);
      gridRef.current?.setPointerCapture(e.pointerId);
    }
    setDragPos({ x: e.clientX, y: e.clientY });
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const slotEl = el?.closest('[data-slot-idx]');
    if (slotEl) {
      const dstIdx = parseInt(slotEl.getAttribute('data-slot-idx') ?? '', 10);
      if (!isNaN(dstIdx)) {
        dragDstRef.current = dstIdx;
        setDragDst(dstIdx);
      }
    }
  }, []);

  const finishDrag = useCallback((e: React.PointerEvent) => {
    if (dragSrcRef.current === null) return;
    if (isDraggingRef.current && gridRef.current?.hasPointerCapture(e.pointerId)) {
      gridRef.current.releasePointerCapture(e.pointerId);
    }

    const src = dragSrcRef.current;
    const dst = dragDstRef.current;

    if (isDraggingRef.current && dst !== null && dst !== src) {
      const currentLinks = linksRef.current;
      if (currentLinks[dst]) {
        // Destination is occupied — animate displaced icon flying back to src position
        const srcEl = gridRef.current?.querySelector(`[data-slot-idx="${src}"]`);
        const dstEl = gridRef.current?.querySelector(`[data-slot-idx="${dst}"]`);
        if (srcEl && dstEl) {
          const srcRect = srcEl.getBoundingClientRect();
          const dstRect = dstEl.getBoundingClientRect();
          setFlyingIcon({
            link: currentLinks[dst]!,
            fromX: dstRect.left, fromY: dstRect.top,
            toX:   srcRect.left, toY:   srcRect.top,
            size:  dstRect.width,
            hiddenSlotIdx: src,
          });
        }
      } else {
        // Destination is empty — no animation needed, but hide src for one tick
        // to prevent a one-frame flash of the old icon before links state updates
        setFlyingIcon({
          link: currentLinks[src]!,
          fromX: 0, fromY: 0, toX: 0, toY: 0, size: 0, // invisible — no overlay rendered
          hiddenSlotIdx: src,
        });
        setTimeout(() => { setFlyingIcon(null); setLandingSlot(null); }, 60);
      }
      swapLinks(src, dst);
    }

    // Reset all drag state synchronously via refs first, then schedule React updates
    dragStartPos.current  = null;
    dragSrcRef.current    = null;
    dragDstRef.current    = null;
    isDraggingRef.current = false;
    setDragSrc(null);
    setDragDst(null);
    setIsDragging(false);
    setDragPos(null);
  }, [swapLinks]);

  function handleSlotClick(idx: number) {
    if (isDragging) return; // swallow click that ends a drag
    if (editMode) {
      if (!links[idx]) setModalSlot(idx);
      // filled slots: open URL (right-click for context menu)
      else window.open(links[idx].url, '_blank', 'noopener,noreferrer');
    } else {
      if (links[idx]) window.open(links[idx].url, '_blank', 'noopener,noreferrer');
    }
  }

  function handleSlotContextMenu(e: React.MouseEvent, idx: number) {
    if (!editMode || !links[idx]) return;
    e.preventDefault();
    const gridRect = gridRef.current?.getBoundingClientRect();
    setCtxMenu({
      idx,
      x: gridRect ? e.clientX - gridRect.left : e.nativeEvent.offsetX,
      y: gridRect ? e.clientY - gridRect.top  : e.nativeEvent.offsetY,
    });
  }

  return (
    <div
      data-widget-grid
      className="h-full flex flex-col overflow-hidden relative"
      style={{ background: 'var(--surface)' }}
    >
      {/* 5 × 8 grid */}
      <div
        ref={gridRef}
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gridTemplateRows: 'repeat(8, 1fr)',
          gap: 4, padding: 6,
          touchAction: 'none',
        }}
        onPointerDown={handleGridPointerDown}
        onPointerMove={handleGridPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        {Array.from({ length: TOTAL_SLOTS }).map((_, idx) => {
          const link = links[idx];
          const isDragSrc = dragSrc === idx;
          const isDragDst = dragDst === idx && dragSrc !== null && dragSrc !== idx;

          // ── Edit / Done button lives in the bottom-right grid cell ──
          if (idx === 39) {
            return (
              <div
                key="edit-btn"
                onClick={toggleEditMode}
                title={editMode ? 'Done editing' : 'Edit links'}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 7, cursor: 'pointer', transition: 'all 0.15s',
                  border: editMode
                    ? '1px solid rgba(61,232,176,0.5)'
                    : '1px solid var(--border-hover)',
                  background: editMode
                    ? 'rgba(61,232,176,0.12)'
                    : 'var(--surface2)',
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = editMode ? 'rgba(61,232,176,0.2)' : 'var(--surface3)';
                  el.style.borderColor = editMode ? 'rgba(61,232,176,0.7)' : 'var(--accent)';
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = editMode ? 'rgba(61,232,176,0.12)' : 'var(--surface2)';
                  el.style.borderColor = editMode ? 'rgba(61,232,176,0.5)' : 'var(--border-hover)';
                }}
              >
                <span style={{
                  fontSize: 8, fontFamily: 'var(--font-mono)',
                  textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700,
                  color: editMode ? 'var(--teal)' : 'var(--text-muted)',
                  userSelect: 'none',
                }}>
                  {editMode ? 'Done' : '✎'}
                </span>
              </div>
            );
          }

          if (link) {
            // ── Filled slot ──
            const beingDragged = isDragSrc && isDragging;
            return (
              <Slot
                key={idx}
                slotIdx={idx}
                onClick={() => handleSlotClick(idx)}
                onContextMenu={(e) => handleSlotContextMenu(e, idx)}
                style={{
                  cursor: editMode
                    ? (isDragging && isDragSrc ? 'grabbing' : 'grab')
                    : 'pointer',
                  // Hidden while flying overlay is in-flight; fades in once landingSlot is set
                  opacity: beingDragged
                    ? 0
                    : (flyingIcon?.hiddenSlotIdx === idx && landingSlot !== idx)
                      ? 0
                      : 1,
                  border: editMode
                    ? isDragDst
                      ? '1.5px solid var(--accent)'
                      : '1px solid var(--border)'
                    : '1px solid transparent',
                  background: editMode
                    ? isDragDst
                      ? 'var(--accent-dim)'
                      : beingDragged ? 'var(--surface3)' : 'var(--surface2)'
                    : 'transparent',
                  borderRadius: 7,
                  // Use a longer fade-in during landing so it cross-dissolves with the overlay
                  transition: beingDragged
                    ? 'none'
                    : landingSlot === idx
                      ? 'opacity 0.1s ease-in, border-color 0.12s, background 0.12s'
                      : 'border-color 0.12s, background 0.12s',
                }}
                hoverStyle={editMode ? {
                  background: 'var(--surface3)',
                } : {
                  background: 'rgba(255,255,255,0.04)',
                }}
              >
                <FaviconImage src={link.faviconUrl} name={link.displayName} size={28} />
              </Slot>
            );
          }

          // ── Empty slot ──
          if (!editMode) {
            return <div key={idx} data-slot-idx={idx} />;
          }

          return (
            <Slot
              key={idx}
              slotIdx={idx}
              onClick={() => handleSlotClick(idx)}
              style={{
                cursor: 'pointer',
                // Suppress this slot while a dragged icon just vacated it
                opacity: flyingIcon?.hiddenSlotIdx === idx ? 0 : 1,
                border: isDragDst
                  ? '1.5px dashed var(--accent)'
                  : '1px dashed rgba(var(--accent-rgb), 0.22)',
                background: isDragDst ? 'var(--accent-dim)' : 'transparent',
                borderRadius: 7,
                transition: 'background 0.12s, border-color 0.12s',
              }}
              hoverStyle={{
                background: 'rgba(var(--accent-rgb), 0.06)',
                // no borderColor change — dotted line stays static on hover
              }}
            >
              <span style={{
                fontSize: 13, lineHeight: 1, userSelect: 'none',
                color: isDragDst ? 'var(--accent)' : 'rgba(var(--accent-rgb), 0.4)',
              }}>+</span>
            </Slot>
          );
        })}
      </div>

      {/* Flying icon — displaced icon animates from dst → src on drop */}
      {flyingIcon && flyingIcon.size > 0 && createPortal(
        <FlyingIconOverlay
          link={flyingIcon.link}
          fromX={flyingIcon.fromX} fromY={flyingIcon.fromY}
          toX={flyingIcon.toX}     toY={flyingIcon.toY}
          size={flyingIcon.size}
          onStartLand={() => setLandingSlot(flyingIcon.hiddenSlotIdx)}
          onDone={() => { setFlyingIcon(null); setLandingSlot(null); }}
        />,
        document.body
      )}

      {/* Drag ghost — follows cursor via portal so it escapes overflow:hidden */}
      {isDragging && dragSrc !== null && links[dragSrc] && dragPos && createPortal(
        <div style={{
          position: 'fixed',
          left: dragPos.x - 22,
          top: dragPos.y - 22,
          width: 44, height: 44,
          borderRadius: 10,
          background: 'var(--surface3)',
          border: '1px solid var(--border-hover)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
          zIndex: 99999,
          opacity: 0.92,
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          transform: 'scale(1.12)',
          transition: 'none',
        }}>
          <FaviconImage
            src={links[dragSrc].faviconUrl}
            name={links[dragSrc].displayName}
            size={28}
          />
        </div>,
        document.body
      )}

      {/* Context menu */}
      {ctxMenu && links[ctxMenu.idx] && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          link={links[ctxMenu.idx]!}
          onOpen={() => { window.open(links[ctxMenu.idx]!.url, '_blank', 'noopener,noreferrer'); setCtxMenu(null); }}
          onEdit={() => { setModalSlot(ctxMenu.idx); setCtxMenu(null); }}
          onRemove={() => { removeLink(ctxMenu.idx); setCtxMenu(null); }}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Add / Edit modal */}
      {modalSlot !== null && (
        <AddEditModal
          slotIndex={modalSlot}
          existingLink={links[modalSlot]}
          onSave={(link) => { saveLink(link); setModalSlot(null); }}
          onClose={() => setModalSlot(null)}
        />
      )}
    </div>
  );
}

// ─── Generic slot wrapper ─────────────────────────────────────────────────────
// Handles hover state and renders data-slot-idx on the DOM element.

function Slot({ slotIdx, onClick, onContextMenu, style, hoverStyle, children }: {
  slotIdx: number;
  onClick?(): void;
  onContextMenu?(e: React.MouseEvent): void;
  style?: React.CSSProperties;
  hoverStyle?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const baseStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    outline: 'none', userSelect: 'none', overflow: 'hidden',
    ...(hovered ? { ...style, ...hoverStyle } : style),
  };

  return (
    <div
      data-slot-idx={slotIdx}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onContextMenu={onContextMenu}
      // Use pointer events so hover resets correctly even during drag capture
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      // Block browser native drag — we use our own pointer-event drag
      onDragStart={(e) => e.preventDefault()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.(); }}
      style={baseStyle}
    >
      {children}
    </div>
  );
}

// ─── FlyingIconOverlay ────────────────────────────────────────────────────────
// Renders a displaced icon that travels from its old position to the new one.

// Timing constants for the fly animation
const FLY_MOVE_MS  = 300; // how long the movement takes
const FLY_XDISS_MS = 100; // cross-dissolve duration (overlay fades out, slot fades in)
// onStartLand fires at FLY_MOVE_MS - FLY_XDISS_MS, giving a clean overlap

function FlyingIconOverlay({ link, fromX, fromY, toX, toY, size, onStartLand, onDone }: {
  link: QuickLink;
  fromX: number; fromY: number;
  toX: number;   toY: number;
  size: number;
  onStartLand(): void;
  onDone(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dx = toX - fromX;
    const dy = toY - fromY;

    // Frame 1: paint at start position, then trigger movement transition
    const raf = requestAnimationFrame(() => {
      if (!ref.current) return;
      ref.current.style.transition = `transform ${FLY_MOVE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      ref.current.style.transform  = `translate(${dx}px, ${dy}px)`;
    });

    // When overlay reaches destination: begin cross-dissolve
    // Slot fades IN (via landingSlot state), overlay fades OUT simultaneously
    const dissolveTimer = setTimeout(() => {
      onStartLand(); // triggers slot opacity 0→1 over FLY_XDISS_MS
      if (ref.current) {
        ref.current.style.transition += `, opacity ${FLY_XDISS_MS}ms ease-in`;
        ref.current.style.opacity = '0';
      }
    }, FLY_MOVE_MS - FLY_XDISS_MS);

    // Once both fades complete, remove the overlay
    const doneTimer = setTimeout(onDone, FLY_MOVE_MS + 16);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(dissolveTimer);
      clearTimeout(doneTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={ref} style={{
      position: 'fixed',
      left: fromX, top: fromY,
      width: size, height: size,
      borderRadius: 7,
      background: 'var(--surface2)',
      border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
      zIndex: 99998,
      opacity: 0.92,
      boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
      transform: 'translate(0, 0)',
      transition: 'none', // applied after mount via RAF
    }}>
      <FaviconImage src={link.faviconUrl} name={link.displayName} size={28} />
    </div>
  );
}
