import { useState, useEffect, useMemo } from 'react';
import type { WidgetType } from '../types';
import { WIDGET_CONFIGS, type WidgetConfig } from '../types';

const WIDGET_ACCENT: Partial<Record<WidgetType, string>> = {
  calendar: '#4285f4', tasks: '#1a73e8', todo: '#3de8b0', pomodoro: '#7c6aff',
  docs: '#34a853', slack: '#e8693f', spotify: '#1db954', lofi: '#a78bfa',
  plaid: '#00b140', stocks: '#3de8b0', wordle: '#538d4e', shared_chess: '#c0a060',
  typing: '#7c6aff', weather: '#f59e0b', news: '#e8693f', notes: '#a78bfa',
  links: '#7c6aff', obsidian: '#8b5cf6',
};

const CATEGORY_ORDER: WidgetConfig['category'][] = ['Work', 'Music', 'Finance', 'Games', 'Info', 'Tools'];

interface Props {
  order: WidgetType[];
  activeIdx: number;
  onConfirm: (newOrder: WidgetType[], newActiveIdx: number) => void;
  onClose: () => void;
}

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

const SLOT_SEQUENCE = [5, 4, 6, 3, 7, 2, 8, 1, 9, 0, 10] as const;

function orderToSlots(order: WidgetType[], _activeIdx: number): (WidgetType | null)[] {
  const slots: (WidgetType | null)[] = Array(SLOT_COUNT).fill(null);
  order.slice(0, SLOT_COUNT).forEach((w, i) => {
    const slot = SLOT_SEQUENCE[i];
    if (slot !== undefined) slots[slot] = w;
  });
  return slots;
}

function slotsToOrder(slots: (WidgetType | null)[]): { order: WidgetType[]; activeIdx: number } {
  const order = SLOT_SEQUENCE.map(pos => slots[pos]).filter(Boolean) as WidgetType[];
  return { order, activeIdx: 0 };
}

// ── Individual slot card ───────────────────────────────────────────────────────
function SlotCard({
  widgetType, pos,
  onRemove, onTapEmpty,
}: {
  widgetType: WidgetType | null;
  pos: number;
  onRemove: () => void;
  onTapEmpty: () => void;
}) {
  const side    = slotSide(pos);
  const isCenter = side === 'center';
  const cfg    = widgetType ? WIDGET_CONFIGS.find(c => c.id === widgetType) : null;
  const accent = widgetType ? (WIDGET_ACCENT[widgetType] ?? 'var(--accent)') : 'var(--accent)';

  // Sizes — larger now that we have full screen
  const W = isCenter ? 96 : 64;
  const H = isCenter ? 128 : 68;

  if (widgetType) {
    return (
      <div style={{
        width: W, height: H,
        borderRadius: isCenter ? 16 : 12,
        background: 'var(--surface2)',
        border: '1px solid var(--card-border)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 4, position: 'relative',
        flexShrink: 0,
      }}>
        {/* Accent edge */}
        <div style={{
          position: 'absolute',
          [side === 'right' ? 'left' : 'right']: 0,
          top: 6, bottom: 6, width: 2,
          background: accent, borderRadius: 2, opacity: 0.8,
        }} />
        <span style={{ fontSize: isCenter ? 24 : 18 }}>{cfg?.icon ?? '🔧'}</span>
        <span style={{
          fontSize: isCenter ? 10 : 9,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.02em',
          textAlign: 'center',
          lineHeight: 1.2,
          padding: '0 6px',
        }}>
          {cfg?.label ?? widgetType}
        </span>
        {/* Remove button */}
        <button
          onPointerDown={e => { e.stopPropagation(); onRemove(); }}
          style={{
            position: 'absolute', top: 3, right: 3,
            width: 18, height: 18, borderRadius: '50%',
            background: 'rgba(239,68,68,0.8)', border: 'none',
            color: '#fff', fontSize: 10, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            touchAction: 'manipulation',
          }}
        >✕</button>
        {/* Slot label */}
        <div style={{
          position: 'absolute', bottom: -18,
          fontSize: 9, color: 'var(--text-faint)',
          fontFamily: 'var(--font-mono)', textAlign: 'center',
          whiteSpace: 'nowrap',
        }}>
          {isCenter ? '★ Active' : slotLabel(pos)}
        </div>
      </div>
    );
  }

  // Empty slot — tappable + button
  return (
    <button
      onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onTapEmpty(); }}
      style={{
        width: W, height: H,
        borderRadius: isCenter ? 16 : 12,
        background: 'var(--surface3)',
        border: '2px dashed var(--border)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 4, position: 'relative',
        flexShrink: 0,
        cursor: 'pointer',
        touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent',
        padding: 0,
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <span style={{ fontSize: isCenter ? 28 : 22, color: 'var(--accent)', opacity: 0.7 }}>＋</span>
      <span style={{
        fontSize: 9, color: 'var(--accent)',
        fontFamily: 'var(--font-mono)', opacity: 0.6,
      }}>
        Add
      </span>
      {/* Slot label */}
      <div style={{
        position: 'absolute', bottom: -18,
        fontSize: 9, color: 'var(--text-faint)',
        fontFamily: 'var(--font-mono)', textAlign: 'center',
        whiteSpace: 'nowrap',
      }}>
        {isCenter ? '★ Active' : slotLabel(pos)}
      </div>
    </button>
  );
}

// ── Widget picker panel (slides up from bottom) ────────────────────────────────
function WidgetPickerPanel({
  slotPos,
  usedWidgets,
  onPick,
  onClose,
}: {
  slotPos: number;
  usedWidgets: Set<WidgetType>;
  onPick: (w: WidgetType) => void;
  onClose: () => void;
}) {
  const [query, setQuery]   = useState('');
  const [ready, setReady]   = useState(false);

  useEffect(() => { requestAnimationFrame(() => setReady(true)); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return WIDGET_CONFIGS.filter(cfg => {
      if (usedWidgets.has(cfg.id)) return false;
      if (!q) return true;
      return cfg.label.toLowerCase().includes(q) || cfg.category.toLowerCase().includes(q);
    });
  }, [query, usedWidgets]);

  const grouped = useMemo(() => {
    const map = new Map<WidgetConfig['category'], WidgetConfig[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const c of filtered) map.get(c.category)?.push(c);
    return map;
  }, [filtered]);

  return (
    <>
      {/* Inner backdrop (dims the layout behind) */}
      <div
        onPointerDown={onClose}
        style={{
          position: 'absolute', inset: 0, zIndex: 10,
          background: 'rgba(0,0,0,0.45)',
          opacity: ready ? 1 : 0,
          transition: 'opacity 0.22s ease',
        }}
      />

      {/* Picker sheet */}
      <div
        onPointerDown={e => e.stopPropagation()}
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 11,
          background: 'var(--surface)',
          borderRadius: '20px 20px 0 0',
          border: '1px solid var(--border)',
          borderBottom: 'none',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
          height: '72dvh',
          display: 'flex', flexDirection: 'column',
          transform: ready ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-hover)' }} />
        </div>

        {/* Picker header */}
        <div style={{
          display: 'flex', alignItems: 'center',
          padding: '4px 16px 12px', gap: 10, flexShrink: 0,
        }}>
          <button
            onPointerDown={onClose}
            style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              touchAction: 'manipulation', flexShrink: 0,
            }}
          >‹</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Add Widget</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              → {slotLabel(slotPos)}
            </div>
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: '0 16px 12px', flexShrink: 0 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search widgets…"
            style={{
              width: '100%', padding: '10px 14px',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 10, color: 'var(--text)',
              fontSize: 14, outline: 'none',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Widget list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
          {filtered.length === 0 && (
            <div style={{
              textAlign: 'center', padding: '40px 0',
              color: 'var(--text-faint)', fontSize: 13,
            }}>
              No widgets found
            </div>
          )}

          {CATEGORY_ORDER.map(cat => {
            const items = grouped.get(cat) ?? [];
            if (items.length === 0) return null;
            return (
              <div key={cat} style={{ marginBottom: 20 }}>
                {/* Category label */}
                <div style={{
                  fontSize: 10, color: 'var(--text-faint)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  marginBottom: 8,
                }}>
                  {cat}
                </div>
                {/* 2-column grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {items.map(cfg => {
                    const accent = WIDGET_ACCENT[cfg.id] ?? 'var(--accent)';
                    return (
                      <button
                        key={cfg.id}
                        onPointerDown={e => { e.preventDefault(); onPick(cfg.id); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '12px 14px',
                          background: 'var(--surface2)',
                          border: `1px solid ${accent}30`,
                          borderRadius: 12,
                          cursor: 'pointer',
                          touchAction: 'manipulation',
                          WebkitTapHighlightColor: 'transparent',
                          textAlign: 'left',
                          transition: 'background 0.15s',
                          minHeight: 52,
                        }}
                      >
                        <span style={{
                          fontSize: 22, lineHeight: 1,
                          flexShrink: 0,
                        }}>{cfg.icon}</span>
                        <span style={{
                          fontSize: 13, color: 'var(--text)',
                          fontWeight: 500, lineHeight: 1.3,
                        }}>
                          {cfg.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ── Main editor ────────────────────────────────────────────────────────────────
export function MobileLayoutEditor({ order, activeIdx, onConfirm, onClose }: Props) {
  const [slots, setSlots] = useState<(WidgetType | null)[]>(
    () => orderToSlots(order, activeIdx),
  );
  const [visible, setVisible]       = useState(false);
  // pickerSlot: which slot index was tapped (shows widget picker)
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const dismiss = () => { setVisible(false); setTimeout(onClose, 300); };

  const usedWidgets = new Set(slots.filter(Boolean) as WidgetType[]);

  function handleRemove(slotIdx: number) {
    setSlots(prev => {
      const next = [...prev];
      next[slotIdx] = null;
      return next;
    });
  }

  function handlePickWidget(widget: WidgetType) {
    if (pickerSlot === null) return;
    setSlots(prev => {
      const next = [...prev];
      next[pickerSlot] = widget;
      return next;
    });
    setPickerSlot(null);
  }

  function handleConfirm() {
    const { order: newOrder, activeIdx: newActiveIdx } = slotsToOrder(slots);
    if (newOrder.length === 0) return;
    onConfirm(newOrder, newActiveIdx);
    dismiss();
  }

  const leftSlots  = [0, 1, 2, 3, 4];
  const rightSlots = [6, 7, 8, 9, 10];

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 600,
        background: 'var(--bg)',
        display: 'flex', flexDirection: 'column',
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(20px)',
        transition: 'opacity 0.28s ease, transform 0.28s ease',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '12px 16px', gap: 10,
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <button
          onPointerDown={dismiss}
          style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'var(--surface2)', border: '1px solid var(--border)',
            color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            touchAction: 'manipulation',
          }}
        >✕</button>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Edit Layout</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
            Tap ✕ to remove · Tap ＋ to add a widget
          </div>
        </div>

        <button
          onPointerDown={handleConfirm}
          style={{
            background: 'var(--accent)', border: 'none', borderRadius: 10,
            padding: '10px 18px', color: '#fff', fontWeight: 700, fontSize: 14,
            cursor: 'pointer', minHeight: 44, touchAction: 'manipulation',
          }}
        >
          Save ✓
        </button>
      </div>

      {/* ── Layout grid ─────────────────────────────────────────────────────── */}
      <div style={{
        flex: 1, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        padding: '16px 12px 24px',
        overflow: 'hidden',
        position: 'relative',
      }}>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            {leftSlots.map(slotIdx => (
              <SlotCard
                key={slotIdx}
                pos={slotIdx}
                widgetType={slots[slotIdx]}
                onRemove={() => handleRemove(slotIdx)}
                onTapEmpty={() => setPickerSlot(slotIdx)}
              />
            ))}
            <div style={{
              fontSize: 9, color: 'var(--text-faint)',
              fontFamily: 'var(--font-mono)', textAlign: 'center', marginTop: 6,
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              Left
            </div>
          </div>

          {/* Separator */}
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 2,
            opacity: 0.2, color: 'var(--text-muted)', fontSize: 12,
          }}>
            <span>←</span>
            <span>→</span>
          </div>

          {/* Center / Active */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <SlotCard
              pos={5}
              widgetType={slots[5]}
              onRemove={() => handleRemove(5)}
              onTapEmpty={() => setPickerSlot(5)}
            />
            <div style={{
              fontSize: 9, color: 'var(--text-faint)',
              fontFamily: 'var(--font-mono)', textAlign: 'center', marginTop: 6,
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              Active
            </div>
          </div>

          {/* Separator */}
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 2,
            opacity: 0.2, color: 'var(--text-muted)', fontSize: 12,
          }}>
            <span>←</span>
            <span>→</span>
          </div>

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            {rightSlots.map(slotIdx => (
              <SlotCard
                key={slotIdx}
                pos={slotIdx}
                widgetType={slots[slotIdx]}
                onRemove={() => handleRemove(slotIdx)}
                onTapEmpty={() => setPickerSlot(slotIdx)}
              />
            ))}
            <div style={{
              fontSize: 9, color: 'var(--text-faint)',
              fontFamily: 'var(--font-mono)', textAlign: 'center', marginTop: 6,
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              Right
            </div>
          </div>
        </div>

        {/* Widget picker panel — renders within the layout area */}
        {pickerSlot !== null && (
          <WidgetPickerPanel
            slotPos={pickerSlot}
            usedWidgets={usedWidgets}
            onPick={handlePickWidget}
            onClose={() => setPickerSlot(null)}
          />
        )}
      </div>
    </div>
  );
}
