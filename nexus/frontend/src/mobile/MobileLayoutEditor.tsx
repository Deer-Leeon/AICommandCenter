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

// ── Must match HOME_SEQUENCE in MobileCardStack exactly ───────────────────────
// order[i] → slot HOME_SEQUENCE[i] in the card stack.
// Slot indices: 0-4 = left column (0=top/furthest, 4=bottom/closest)
//               6-10 = right column (6=top/closest, 10=bottom/furthest)
const HOME_SEQUENCE = [4, 6, 3, 7, 2, 8, 1, 9, 0, 10] as const;
const MAX_WIDGETS   = HOME_SEQUENCE.length; // 10

// Slot index → human label
function slotLabel(pos: number): string {
  if (pos < 5) return `Left ${5 - pos}`;   // slot 4 = Left 1, slot 0 = Left 5
  return `Right ${pos - 5}`;               // slot 6 = Right 1, slot 10 = Right 5
}

// Convert flat order[] → 11-element slots array (index 5 is never set)
function orderToSlots(order: WidgetType[]): (WidgetType | null)[] {
  const slots: (WidgetType | null)[] = Array(11).fill(null);
  order.slice(0, MAX_WIDGETS).forEach((w, i) => {
    const slot = HOME_SEQUENCE[i];
    if (slot !== undefined) slots[slot] = w;
  });
  return slots;
}

// Convert slots array back → flat order[] via HOME_SEQUENCE
function slotsToOrder(slots: (WidgetType | null)[]): WidgetType[] {
  return HOME_SEQUENCE.map(pos => slots[pos]).filter(Boolean) as WidgetType[];
}

// ── Individual slot card ───────────────────────────────────────────────────────
function SlotCard({
  widgetType, pos, onRemove, onTapEmpty,
}: {
  widgetType: WidgetType | null;
  pos: number;
  onRemove: () => void;
  onTapEmpty: () => void;
}) {
  const isLeft = pos < 5;
  const cfg    = widgetType ? WIDGET_CONFIGS.find(c => c.id === widgetType) : null;
  const accent = widgetType ? (WIDGET_ACCENT[widgetType] ?? 'var(--accent)') : 'var(--accent)';

  const W = 76, H = 72;

  if (widgetType) {
    return (
      <div style={{
        width: W, height: H, borderRadius: 12,
        background: 'var(--surface2)',
        border: '1px solid var(--card-border)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 4, position: 'relative', flexShrink: 0,
      }}>
        {/* Accent inner edge */}
        <div style={{
          position: 'absolute',
          [isLeft ? 'right' : 'left']: 0,
          top: 6, bottom: 6, width: 2,
          background: accent, borderRadius: 2, opacity: 0.8,
        }} />
        <span style={{ fontSize: 20 }}>{cfg?.icon ?? '🔧'}</span>
        <span style={{
          fontSize: 9, color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)', letterSpacing: '0.02em',
          textAlign: 'center', lineHeight: 1.2, padding: '0 6px',
        }}>
          {cfg?.label ?? widgetType}
        </span>
        {/* Remove ✕ */}
        <button
          onPointerDown={e => { e.stopPropagation(); onRemove(); }}
          style={{
            position: 'absolute', top: 3, right: 3,
            width: 18, height: 18, borderRadius: '50%',
            background: 'rgba(239,68,68,0.85)', border: 'none',
            color: '#fff', fontSize: 10, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            touchAction: 'manipulation',
          }}
        >✕</button>
        {/* Slot label below card */}
        <div style={{
          position: 'absolute', bottom: -18,
          fontSize: 9, color: 'var(--text-faint)',
          fontFamily: 'var(--font-mono)', textAlign: 'center', whiteSpace: 'nowrap',
        }}>
          {slotLabel(pos)}
        </div>
      </div>
    );
  }

  // Empty — tappable ＋ button
  return (
    <button
      onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onTapEmpty(); }}
      style={{
        width: W, height: H, borderRadius: 12,
        background: 'var(--surface3)',
        border: '2px dashed var(--border)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 4, position: 'relative', flexShrink: 0,
        cursor: 'pointer', touchAction: 'manipulation',
        WebkitTapHighlightColor: 'transparent', padding: 0,
      }}
    >
      <span style={{ fontSize: 22, color: 'var(--accent)', opacity: 0.7 }}>＋</span>
      <span style={{ fontSize: 9, color: 'var(--accent)', fontFamily: 'var(--font-mono)', opacity: 0.6 }}>Add</span>
      <div style={{
        position: 'absolute', bottom: -18,
        fontSize: 9, color: 'var(--text-faint)',
        fontFamily: 'var(--font-mono)', textAlign: 'center', whiteSpace: 'nowrap',
      }}>
        {slotLabel(pos)}
      </div>
    </button>
  );
}

// ── Widget picker (slides up inside the editor) ───────────────────────────────
function WidgetPickerPanel({
  slotPos, usedWidgets, onPick, onClose,
}: {
  slotPos: number;
  usedWidgets: Set<WidgetType>;
  onPick: (w: WidgetType) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [ready, setReady] = useState(false);

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
      <div onPointerDown={onClose} style={{
        position: 'absolute', inset: 0, zIndex: 10,
        background: 'rgba(0,0,0,0.45)',
        opacity: ready ? 1 : 0, transition: 'opacity 0.22s ease',
      }} />
      <div onPointerDown={e => e.stopPropagation()} style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 11,
        background: 'var(--surface)', borderRadius: '20px 20px 0 0',
        border: '1px solid var(--border)', borderBottom: 'none',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
        height: '72dvh', display: 'flex', flexDirection: 'column',
        transform: ready ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.3s cubic-bezier(0.25,0.46,0.45,0.94)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border-hover)' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 16px 12px', gap: 10, flexShrink: 0 }}>
          <button onPointerDown={onClose} style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--surface2)', border: '1px solid var(--border)',
            color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            touchAction: 'manipulation', flexShrink: 0,
          }}>‹</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Add Widget</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>→ {slotLabel(slotPos)}</div>
          </div>
        </div>
        <div style={{ padding: '0 16px 12px', flexShrink: 0 }}>
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search widgets…"
            style={{
              width: '100%', padding: '10px 14px',
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 10, color: 'var(--text)', fontSize: 14, outline: 'none',
              fontFamily: 'inherit', boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-faint)', fontSize: 13 }}>
              No widgets found
            </div>
          )}
          {CATEGORY_ORDER.map(cat => {
            const items = grouped.get(cat) ?? [];
            if (items.length === 0) return null;
            return (
              <div key={cat} style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: 10, color: 'var(--text-faint)',
                  fontFamily: 'var(--font-mono)', letterSpacing: '0.1em',
                  textTransform: 'uppercase', marginBottom: 8,
                }}>
                  {cat}
                </div>
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
                          background: 'var(--surface2)', border: `1px solid ${accent}30`,
                          borderRadius: 12, cursor: 'pointer',
                          touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent',
                          textAlign: 'left', minHeight: 52,
                        }}
                      >
                        <span style={{ fontSize: 22, lineHeight: 1, flexShrink: 0 }}>{cfg.icon}</span>
                        <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, lineHeight: 1.3 }}>
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

// ── Launch widget preference ──────────────────────────────────────────────────
const LAUNCH_WIDGET_KEY = 'nexus_mobile_launch_widget';

function loadLaunchWidgetPref(): WidgetType | null {
  try { return localStorage.getItem(LAUNCH_WIDGET_KEY) as WidgetType | null; } catch { return null; }
}
function saveLaunchWidgetPref(w: WidgetType) {
  try { localStorage.setItem(LAUNCH_WIDGET_KEY, w); } catch { /* quota */ }
}

// ── Main editor ────────────────────────────────────────────────────────────────
export function MobileLayoutEditor({ order, onConfirm, onClose }: Props) {
  const [slots, setSlots] = useState<(WidgetType | null)[]>(() => orderToSlots(order));
  const [visible, setVisible]       = useState(false);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);

  // Which widget should open first on launch
  const [launchWidget, setLaunchWidget] = useState<WidgetType | null>(loadLaunchWidgetPref);

  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);

  const dismiss = () => { setVisible(false); setTimeout(onClose, 300); };

  const usedWidgets = new Set(slots.filter(Boolean) as WidgetType[]);

  // Filled widgets in layout order (used for the launch picker)
  const currentWidgets = slotsToOrder(slots);

  function handleRemove(slotIdx: number) {
    setSlots(prev => { const next = [...prev]; next[slotIdx] = null; return next; });
  }

  function handlePickWidget(widget: WidgetType) {
    if (pickerSlot === null) return;
    setSlots(prev => { const next = [...prev]; next[pickerSlot] = widget; return next; });
    setPickerSlot(null);
  }

  function handleConfirm() {
    const newOrder = slotsToOrder(slots);
    if (newOrder.length === 0) return;
    // Persist the chosen launch widget; fall back to first if it was removed
    const effectiveLaunch = launchWidget && newOrder.includes(launchWidget)
      ? launchWidget
      : newOrder[0];
    saveLaunchWidgetPref(effectiveLaunch);
    onConfirm(newOrder, 0);
    dismiss();
  }

  // Slots to display per column — left: 0-4 (top=furthest, bottom=closest)
  // right: 6-10 (top=closest, bottom=furthest)
  const leftSlots  = [0, 1, 2, 3, 4];
  const rightSlots = [6, 7, 8, 9, 10];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      opacity: visible ? 1 : 0,
      transform: visible ? 'none' : 'translateY(20px)',
      transition: 'opacity 0.28s ease, transform 0.28s ease',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: '12px 16px', gap: 10,
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <button onPointerDown={dismiss} style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'var(--surface2)', border: '1px solid var(--border)',
          color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          touchAction: 'manipulation',
        }}>✕</button>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>Edit Layout</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
            Tap ✕ to remove · Tap ＋ to add a widget
          </div>
        </div>

        <button onPointerDown={handleConfirm} style={{
          background: 'var(--accent)', border: 'none', borderRadius: 10,
          padding: '10px 18px', color: '#fff', fontWeight: 700, fontSize: 14,
          cursor: 'pointer', minHeight: 44, touchAction: 'manipulation',
        }}>
          Save ✓
        </button>
      </div>

      {/* ── Layout grid (left + right, no center) ───────────────────────────── */}
      <div style={{
        flex: 1, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        padding: '16px 20px 32px',
        overflow: 'hidden', position: 'relative',
      }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'stretch' }}>

          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{
              fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)',
              letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4,
            }}>
              Left Side
            </div>
            {leftSlots.map(slotIdx => (
              <SlotCard
                key={slotIdx}
                pos={slotIdx}
                widgetType={slots[slotIdx]}
                onRemove={() => handleRemove(slotIdx)}
                onTapEmpty={() => setPickerSlot(slotIdx)}
              />
            ))}
          </div>

          {/* Divider */}
          <div style={{
            width: 1, alignSelf: 'stretch', marginTop: 28,
            background: 'linear-gradient(to bottom, transparent, var(--border) 20%, var(--border) 80%, transparent)',
          }} />

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{
              fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)',
              letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4,
            }}>
              Right Side
            </div>
            {rightSlots.map(slotIdx => (
              <SlotCard
                key={slotIdx}
                pos={slotIdx}
                widgetType={slots[slotIdx]}
                onRemove={() => handleRemove(slotIdx)}
                onTapEmpty={() => setPickerSlot(slotIdx)}
              />
            ))}
          </div>
        </div>

        {/* Widget picker */}
        {pickerSlot !== null && (
          <WidgetPickerPanel
            slotPos={pickerSlot}
            usedWidgets={usedWidgets}
            onPick={handlePickWidget}
            onClose={() => setPickerSlot(null)}
          />
        )}
      </div>

      {/* ── Launch widget section ─────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        borderTop: '1px solid var(--border)',
        padding: '12px 16px 14px',
        background: 'var(--surface)',
      }}>
        <div style={{
          fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
          letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10,
        }}>
          Opens on launch
        </div>
        <div style={{
          display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2,
          scrollbarWidth: 'none',
        }}>
          {currentWidgets.map(w => {
            const cfg    = WIDGET_CONFIGS.find(c => c.id === w);
            const accent = WIDGET_ACCENT[w] ?? 'var(--accent)';
            const sel    = (launchWidget ?? currentWidgets[0]) === w;
            return (
              <button
                key={w}
                onPointerDown={() => setLaunchWidget(w)}
                style={{
                  flexShrink: 0,
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '7px 13px',
                  borderRadius: 99,
                  background: sel ? `${accent}22` : 'var(--surface2)',
                  border: `1.5px solid ${sel ? accent : 'var(--border)'}`,
                  color: sel ? accent : 'var(--text-muted)',
                  fontSize: 12, fontWeight: sel ? 700 : 400,
                  cursor: 'pointer', touchAction: 'manipulation',
                  transition: 'background 0.15s, border 0.15s, color 0.15s',
                  boxShadow: sel ? `0 2px 10px ${accent}40` : 'none',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <span style={{ fontSize: 15 }}>{cfg?.icon}</span>
                <span>{cfg?.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
