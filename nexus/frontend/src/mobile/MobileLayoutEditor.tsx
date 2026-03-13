import { useState, useEffect } from 'react';
import type { WidgetType } from '../types';
import { WIDGET_CONFIGS } from '../types';

const WIDGET_ACCENT: Partial<Record<WidgetType, string>> = {
  calendar: '#4285f4', tasks: '#1a73e8', todo: '#3de8b0', pomodoro: '#7c6aff',
  docs: '#34a853', slack: '#e8693f', spotify: '#1db954', lofi: '#a78bfa',
  plaid: '#00b140', stocks: '#3de8b0', wordle: '#538d4e', shared_chess: '#c0a060',
  typing: '#7c6aff', weather: '#f59e0b', news: '#e8693f', notes: '#a78bfa',
  links: '#7c6aff', obsidian: '#8b5cf6',
};

interface Props {
  order: WidgetType[];
  activeIdx: number;
  onConfirm: (newOrder: WidgetType[], newActiveIdx: number) => void;
  onClose: () => void;
}

// ── Slot descriptor ────────────────────────────────────────────────────────────
// slot 0 = left-5 (furthest), ..., slot 4 = left-1 (closest)
// slot 5 = ACTIVE
// slot 6 = right-1 (closest), ..., slot 10 = right-5 (furthest)
const SLOT_COUNT = 11;

function slotLabel(pos: number): string {
  if (pos === 5) return 'Active';
  if (pos < 5)  return `Left ${5 - pos}`;
  return `Right ${pos - 5}`;
}

function slotSide(pos: number): 'left' | 'center' | 'right' {
  if (pos === 5) return 'center';
  return pos < 5 ? 'left' : 'right';
}

// Same interleaved sequence used by MobileCardStack:
// order[0] → slot 5 (active), order[1] → slot 4, order[2] → slot 6, order[3] → slot 3, ...
const SLOT_SEQUENCE = [5, 4, 6, 3, 7, 2, 8, 1, 9, 0, 10] as const;

function orderToSlots(order: WidgetType[], _activeIdx: number): (WidgetType | null)[] {
  const slots: (WidgetType | null)[] = Array(SLOT_COUNT).fill(null);
  order.slice(0, SLOT_COUNT).forEach((w, i) => {
    const slot = SLOT_SEQUENCE[i];
    if (slot !== undefined) slots[slot] = w;
  });
  return slots;
}

// Convert 11-slot array back to flat order[] using the same SLOT_SEQUENCE.
function slotsToOrder(slots: (WidgetType | null)[]): { order: WidgetType[]; activeIdx: number } {
  const order = SLOT_SEQUENCE.map(pos => slots[pos]).filter(Boolean) as WidgetType[];
  return { order, activeIdx: 0 };
}

// ── Slot card (small visual) ───────────────────────────────────────────────────
function SlotCard({
  widgetType,
  pos,
  isDropTarget,
  isDragging,
  onDragStart,
  onDrop,
  onDragOver,
  onRemove,
}: {
  widgetType: WidgetType | null;
  pos: number;
  isDropTarget: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDrop: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onRemove: () => void;
}) {
  const side = slotSide(pos);
  const isCenter = side === 'center';
  const cfg = widgetType ? WIDGET_CONFIGS.find(c => c.id === widgetType) : null;
  const accent = widgetType ? (WIDGET_ACCENT[widgetType] ?? 'var(--accent)') : 'transparent';

  return (
    <div
      draggable={!!widgetType}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        width: isCenter ? 80 : 52,
        height: isCenter ? 104 : 56,
        borderRadius: isCenter ? 14 : 10,
        background: isDropTarget
          ? 'rgba(var(--accent-rgb),0.2)'
          : widgetType
          ? 'var(--surface2)'
          : 'var(--surface3)',
        border: isDropTarget
          ? '2px dashed rgba(var(--accent-rgb),0.7)'
          : widgetType
          ? '1px solid var(--card-border)'
          : '1px dashed var(--border)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 3, position: 'relative',
        transition: 'all 0.18s ease',
        opacity: isDragging ? 0.4 : 1,
        cursor: widgetType ? 'grab' : 'default',
        flexShrink: 0,
      }}
    >
      {/* Accent left/right border */}
      {widgetType && (
        <div style={{
          position: 'absolute',
          [side === 'right' ? 'left' : 'right']: 0,
          top: 4, bottom: 4, width: 2,
          background: accent, borderRadius: 2,
          opacity: 0.7,
        }} />
      )}

      {widgetType ? (
        <>
          <span style={{ fontSize: isCenter ? 22 : 16 }}>{cfg?.icon ?? '🔧'}</span>
          <span style={{
            fontSize: isCenter ? 9 : 8,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.03em',
            textAlign: 'center',
            lineHeight: 1.2,
            padding: '0 4px',
          }}>
            {cfg?.label ?? widgetType}
          </span>
          {/* Remove button */}
          <button
            onClick={e => { e.stopPropagation(); onRemove(); }}
            style={{
              position: 'absolute', top: 2, right: 2,
              width: 14, height: 14, borderRadius: '50%',
              background: 'rgba(239,68,68,0.7)', border: 'none',
              color: '#fff', fontSize: 8, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1,
            }}
          >✕</button>
        </>
      ) : (
        <span style={{ fontSize: 16, opacity: 0.2 }}>＋</span>
      )}

      {/* Slot label */}
      <div style={{
        position: 'absolute', bottom: -16,
        fontSize: 8, color: 'var(--text-faint)',
        fontFamily: 'var(--font-mono)', textAlign: 'center',
        whiteSpace: 'nowrap', letterSpacing: '0.03em',
      }}>
        {isCenter ? '★ Active' : slotLabel(pos)}
      </div>
    </div>
  );
}

// ── Main editor component ─────────────────────────────────────────────────────
export function MobileLayoutEditor({ order, activeIdx, onConfirm, onClose }: Props) {
  const [slots, setSlots] = useState<(WidgetType | null)[]>(
    () => orderToSlots(order, activeIdx),
  );
  const [dragFrom, setDragFrom] = useState<{ source: 'slot' | 'pool'; slotIdx?: number; widget: WidgetType } | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);

  // Animate in
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const dismiss = () => { setVisible(false); setTimeout(onClose, 280); };

  // Widgets currently not in any slot
  const usedWidgets = new Set(slots.filter(Boolean) as WidgetType[]);

  // ── Drag from slot ────────────────────────────────────────────────────────
  function handleSlotDragStart(slotIdx: number) {
    const w = slots[slotIdx];
    if (!w) return;
    setDragFrom({ source: 'slot', slotIdx, widget: w });
  }

  function handlePoolDragStart(widget: WidgetType) {
    setDragFrom({ source: 'pool', widget });
  }

  function handleDragOver(e: React.DragEvent, target: number) {
    e.preventDefault();
    setDropTarget(target);
  }

  function handleDrop(targetSlot: number) {
    if (!dragFrom) { setDropTarget(null); return; }

    const next = [...slots];

    if (dragFrom.source === 'slot' && dragFrom.slotIdx !== undefined) {
      // Swap two slots
      const fromWidget = next[dragFrom.slotIdx];
      const toWidget   = next[targetSlot];
      next[dragFrom.slotIdx] = toWidget;
      next[targetSlot]       = fromWidget;
    } else if (dragFrom.source === 'pool') {
      // Place pool widget into slot (clear old occupant)
      next[targetSlot] = dragFrom.widget;
    }

    setSlots(next);
    setDragFrom(null);
    setDropTarget(null);
  }

  function handleRemove(slotIdx: number) {
    const next = [...slots];
    next[slotIdx] = null;
    setSlots(next);
  }

  function handleConfirm() {
    // Ensure center slot is always filled
    const { order: newOrder, activeIdx: newActiveIdx } = slotsToOrder(slots);
    if (newOrder.length === 0) return;
    onConfirm(newOrder, newActiveIdx);
    dismiss();
  }

  // ── Layout preview: left column (5) + center (1) + right column (5) ──────
  const leftSlots  = [0, 1, 2, 3, 4];   // slot indices, top to bottom
  const rightSlots = [6, 7, 8, 9, 10];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={dismiss}
        style={{
          position: 'fixed', inset: 0, zIndex: 600,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)',
          opacity: visible ? 1 : 0, transition: 'opacity 0.28s ease',
        }}
      />

      {/* Sheet */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 601,
          background: 'linear-gradient(180deg, var(--surface) 0%, var(--bg) 100%)',
          borderRadius: '24px 24px 0 0',
          border: '1px solid var(--border)',
          boxShadow: '0 -8px 40px var(--card-shadow)',
          maxHeight: '92dvh',
          display: 'flex', flexDirection: 'column',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.32s cubic-bezier(0.25,0.46,0.45,0.94)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 6px', flexShrink: 0 }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--border-hover)' }} />
        </div>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 20px 12px', flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>Edit Layout</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Drag widgets between slots · Tap ✕ to remove
            </div>
          </div>
          <button
            onClick={handleConfirm}
            style={{
              background: 'var(--accent)', border: 'none', borderRadius: 10,
              padding: '10px 18px', color: '#fff', fontWeight: 700, fontSize: 14,
              cursor: 'pointer', minHeight: 44,
            }}
          >
            Save ✓
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 24px' }}>
          {/* ── Visual layout preview ─────────────────────────────────────── */}
          <div style={{
            background: 'var(--surface3)', borderRadius: 16,
            border: '1px solid var(--border)',
            padding: '24px 16px 32px',
            marginBottom: 24,
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textAlign: 'center', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 20 }}>
              Card Layout
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
              {/* Left column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                {leftSlots.map(slotIdx => (
                  <SlotCard
                    key={slotIdx}
                    pos={slotIdx}
                    widgetType={slots[slotIdx]}
                    isDropTarget={dropTarget === slotIdx}
                    isDragging={dragFrom?.source === 'slot' && dragFrom.slotIdx === slotIdx}
                    onDragStart={() => handleSlotDragStart(slotIdx)}
                    onDrop={() => handleDrop(slotIdx)}
                    onDragOver={e => handleDragOver(e, slotIdx)}
                    onRemove={() => handleRemove(slotIdx)}
                  />
                ))}
                <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textAlign: 'center', marginTop: 4 }}>LEFT SIDE</div>
              </div>

              {/* Separator arrows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, opacity: 0.25, color: 'var(--text-muted)', fontSize: 10, alignItems: 'center' }}>
                {'← →'.split('').map((c, i) => <span key={i}>{c}</span>)}
              </div>

              {/* Center (active) */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <SlotCard
                  pos={5}
                  widgetType={slots[5]}
                  isDropTarget={dropTarget === 5}
                  isDragging={dragFrom?.source === 'slot' && dragFrom.slotIdx === 5}
                  onDragStart={() => handleSlotDragStart(5)}
                  onDrop={() => handleDrop(5)}
                  onDragOver={e => handleDragOver(e, 5)}
                  onRemove={() => handleRemove(5)}
                />
              </div>

              {/* Separator arrows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, opacity: 0.25, color: 'var(--text-muted)', fontSize: 10, alignItems: 'center' }}>
                {'← →'.split('').map((c, i) => <span key={i}>{c}</span>)}
              </div>

              {/* Right column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                {rightSlots.map(slotIdx => (
                  <SlotCard
                    key={slotIdx}
                    pos={slotIdx}
                    widgetType={slots[slotIdx]}
                    isDropTarget={dropTarget === slotIdx}
                    isDragging={dragFrom?.source === 'slot' && dragFrom.slotIdx === slotIdx}
                    onDragStart={() => handleSlotDragStart(slotIdx)}
                    onDrop={() => handleDrop(slotIdx)}
                    onDragOver={e => handleDragOver(e, slotIdx)}
                    onRemove={() => handleRemove(slotIdx)}
                  />
                ))}
                <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textAlign: 'center', marginTop: 4 }}>RIGHT SIDE</div>
              </div>
            </div>
          </div>

          {/* ── Widget pool ───────────────────────────────────────────────── */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>
              Available Widgets
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {WIDGET_CONFIGS.map(cfg => {
                const inLayout = usedWidgets.has(cfg.id);
                const accent = WIDGET_ACCENT[cfg.id] ?? 'var(--accent)';
                return (
                  <div
                    key={cfg.id}
                    draggable={!inLayout}
                    onDragStart={() => !inLayout && handlePoolDragStart(cfg.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px', borderRadius: 10,
                      background: inLayout ? 'var(--surface3)' : 'var(--surface2)',
                      border: inLayout
                        ? '1px solid var(--border)'
                        : `1px solid ${accent}33`,
                      opacity: inLayout ? 0.35 : 1,
                      cursor: inLayout ? 'default' : 'grab',
                      transition: 'all 0.15s ease',
                      userSelect: 'none',
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{cfg.icon}</span>
                    <span style={{ fontSize: 12, color: inLayout ? 'var(--text-faint)' : 'var(--text)', fontWeight: 500 }}>
                      {cfg.label}
                    </span>
                    {inLayout && (
                      <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>✓</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 10, lineHeight: 1.5 }}>
              Drag widgets from here into a slot above, or drag between slots to reorder.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
