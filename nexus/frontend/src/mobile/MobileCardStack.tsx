import { useState, useRef, useCallback, useEffect, CSSProperties } from 'react';
import type { WidgetType } from '../types';
import { WIDGET_CONFIGS } from '../types';
import { MobileCardContent } from './cards/MobileCardRegistry';
import { hapticImpact, hapticSelection } from '../lib/capacitorBridge';

// ── Layout constants ──────────────────────────────────────────────────────────
const SIDE_W         = 30;   // px width of each side panel (half of original)
const SIDE_PAD_X     = 0;    // px inner padding — 0 so cards touch the screen edge
const CENTER_GAP     = 4;    // px gap between side panel and center card
const SIDE_GAP       = 0;    // px gap between side slot cards
const SLOTS_PER_SIDE = 5;    // number of cards per side column
const ACTIVE_SLOT    = 5;    // index of the center/active slot (0-indexed)
const TOTAL_SLOTS    = 11;   // 5 left + 1 center + 5 right


const CARD_TRANSITION =
  'left 0.42s cubic-bezier(0.25,0.46,0.45,0.94),' +
  'top 0.42s cubic-bezier(0.25,0.46,0.45,0.94),' +
  'width 0.42s cubic-bezier(0.25,0.46,0.45,0.94),' +
  'height 0.42s cubic-bezier(0.25,0.46,0.45,0.94),' +
  'border-radius 0.42s cubic-bezier(0.25,0.46,0.45,0.94),' +
  'opacity 0.38s ease,' +
  'box-shadow 0.38s ease';

const WIDGET_ACCENT: Partial<Record<WidgetType, string>> = {
  calendar: '#4285f4', tasks: '#1a73e8', todo: '#3de8b0', pomodoro: '#7c6aff',
  docs: '#34a853', slack: '#e8693f', spotify: '#1db954', lofi: '#a78bfa',
  plaid: '#00b140', stocks: '#3de8b0', wordle: '#538d4e', shared_chess: '#c0a060',
  typing: '#7c6aff', weather: '#f59e0b', news: '#e8693f', notes: '#a78bfa',
  links: '#7c6aff', obsidian: '#8b5cf6',
};

// ── Slot assignment ───────────────────────────────────────────────────────────
// Interleave order[] into both sides from the start so both sides are filled.
// Pattern: center, left-1, right-1, left-2, right-2, left-3, right-3, ...
const SLOT_SEQUENCE = [5, 4, 6, 3, 7, 2, 8, 1, 9, 0, 10] as const;

type SlotMap = Partial<Record<WidgetType, number>>;

function buildSlotMap(order: WidgetType[]): SlotMap {
  const map: SlotMap = {};
  order.slice(0, TOTAL_SLOTS).forEach((w, i) => {
    const slot = SLOT_SEQUENCE[i];
    if (slot !== undefined) map[w] = slot;
  });
  return map;
}

// ── Fixed geometry per slot ───────────────────────────────────────────────────
function getSlotStyle(slotIdx: number, w: number, h: number): CSSProperties {
  const slotW  = SIDE_W - SIDE_PAD_X * 2;
  const slotH  = (h - SIDE_GAP * (SLOTS_PER_SIDE - 1)) / SLOTS_PER_SIDE;
  const centerW = w - (SIDE_W + CENTER_GAP) * 2;
  const centerL = SIDE_W + CENTER_GAP;

  if (slotIdx === ACTIVE_SLOT) {
    return {
      left: centerL, top: 0,
      width: centerW, height: h,
      borderRadius: 22,
      opacity: 1,
      zIndex: 50,
      boxShadow: '0 20px 60px var(--card-shadow), 0 4px 16px var(--side-shadow)',
    };
  }

  const isLeft = slotIdx < ACTIVE_SLOT;
  // Row index within the column (0 = top, SLOTS_PER_SIDE-1 = bottom)
  const rowIdx = isLeft ? slotIdx : slotIdx - (ACTIVE_SLOT + 1);
  // Visual distance from the active card (slot 4 and 6 are closest, slots 0 and 10 are furthest)
  const distFromActive = isLeft ? (ACTIVE_SLOT - 1 - slotIdx) : (slotIdx - (ACTIVE_SLOT + 1));

  const x = isLeft ? SIDE_PAD_X : w - SIDE_W + SIDE_PAD_X;
  const y = rowIdx * (slotH + SIDE_GAP);

  // Outer corners (touching the screen wall) are square; inner corners are rounded.
  // CSS borderRadius order: top-left, top-right, bottom-right, bottom-left
  const radius = isLeft ? '0 10px 10px 0' : '10px 0 0 10px';

  return {
    left: x,
    top: y,
    width: slotW,
    height: slotH,
    borderRadius: radius,
    opacity: 0.92,
    zIndex: 30 - distFromActive,
    boxShadow: '0 2px 10px var(--side-shadow)',
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  order: WidgetType[];
}

export function MobileCardStack({ order }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sz, setSz] = useState({ w: 0, h: 0 });

  // slotMap: widget → slot index (0-10). This is the source of truth.
  const [slotMap, setSlotMap] = useState<SlotMap>(() => buildSlotMap(order));
  const prevOrderKeyRef = useRef(order.slice(0, 11).join(','));

  // Re-initialise slots when order changes from layout editor
  useEffect(() => {
    const key = order.slice(0, 11).join(',');
    if (key !== prevOrderKeyRef.current) {
      prevOrderKeyRef.current = key;
      setSlotMap(buildSlotMap(order));
    }
  }, [order]);

  // Measure container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setSz({ w: el.offsetWidth, h: el.offsetHeight }));
    obs.observe(el);
    setSz({ w: el.offsetWidth, h: el.offsetHeight });
    return () => obs.disconnect();
  }, []);

  // ── Swap logic ────────────────────────────────────────────────────────────
  const getActiveWidget = useCallback(
    () => (Object.entries(slotMap).find(([, pos]) => pos === ACTIVE_SLOT)?.[0] as WidgetType | undefined),
    [slotMap],
  );

  const swapWithActive = useCallback((targetWidget: WidgetType) => {
    const activeWidget = getActiveWidget();
    if (!activeWidget || activeWidget === targetWidget) return;

    // Only update the two swapped cards — every other card stays exactly where it is.
    setSlotMap(prev => {
      const targetPos = prev[targetWidget];
      if (targetPos == null) return prev;
      return {
        ...prev,
        [activeWidget]: targetPos,
        [targetWidget]: ACTIVE_SLOT,
      };
    });

    try { navigator.vibrate?.(7); } catch { /* not supported on iOS */ }
    hapticImpact('light'); // native iOS haptic on card snap
    // Note: we intentionally do NOT call onOrderChange here.
    // Syncing back to the parent would trigger a full slotMap rebuild,
    // moving every card back to the interleaved positions.
  }, [getActiveWidget]);


  const ready = sz.w > 0 && sz.h > 0;

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', flex: 1, overflow: 'hidden', touchAction: 'pan-y', overscrollBehavior: 'none' }}
    >
      {/* Ambient glow behind active card */}
      {ready && (
        <div style={{
          position: 'absolute',
          left: SIDE_W + CENTER_GAP, right: SIDE_W + CENTER_GAP,
          top: 0, bottom: 0,
          background: 'radial-gradient(ellipse 90% 55% at 50% 35%, rgba(var(--accent-rgb),0.07) 0%, transparent 70%)',
          pointerEvents: 'none', zIndex: 1,
        }} />
      )}

      {/* Side divider lines */}
      {ready && (
        <>
          <div style={{
            position: 'absolute', left: SIDE_W + 1, top: 0, bottom: 0, width: 1,
            background: 'linear-gradient(to bottom, transparent, var(--divider) 20%, var(--divider) 80%, transparent)',
            pointerEvents: 'none', zIndex: 60,
          }} />
          <div style={{
            position: 'absolute', right: SIDE_W + 1, top: 0, bottom: 0, width: 1,
            background: 'linear-gradient(to bottom, transparent, var(--divider) 20%, var(--divider) 80%, transparent)',
            pointerEvents: 'none', zIndex: 60,
          }} />
        </>
      )}

      {/* ── Cards — keyed by widget ID so elements persist during swaps ── */}
      {ready && (Object.entries(slotMap) as [WidgetType, number][]).map(([widgetType, slotIdx]) => {
        const isActive = slotIdx === ACTIVE_SLOT;
        const isLeft   = !isActive && slotIdx < ACTIVE_SLOT;
        const isRight  = !isActive && slotIdx > ACTIVE_SLOT;
        const isSide   = isLeft || isRight;
        const cfg      = WIDGET_CONFIGS.find(c => c.id === widgetType);
        const accent   = WIDGET_ACCENT[widgetType] ?? 'var(--accent)';
        const slotH    = (sz.h - SIDE_GAP * (SLOTS_PER_SIDE - 1)) / SLOTS_PER_SIDE;
        const isSmall  = slotH < 64;

        const posStyle = getSlotStyle(slotIdx, sz.w, sz.h);

        return (
          <div
            key={widgetType}
            style={{
              position: 'absolute',
              transition: CARD_TRANSITION,
              background: isActive ? 'var(--surface)' : 'var(--surface2)',
              border: '1px solid var(--card-border)',
              overflow: 'hidden',
              willChange: 'left, top, width, height',
              cursor: isSide ? 'pointer' : 'default',
              backdropFilter: isActive ? 'blur(20px)' : 'blur(6px)',
              WebkitBackdropFilter: isActive ? 'blur(20px)' : 'blur(6px)',
              transform: 'none',
              ...posStyle,
            }}
          >
            {/* ── Active card ─────────────────────────────────────────────── */}
            {isActive && (
              <>
                {/* Accent top stripe */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                  background: `linear-gradient(90deg, transparent 0%, ${accent} 35%, ${accent} 65%, transparent 100%)`,
                  opacity: 0.65, zIndex: 5, pointerEvents: 'none',
                }} />

                {/* Corner curl */}
                <div style={{
                  position: 'absolute', bottom: 0, right: 0, width: 22, height: 22,
                  background: 'radial-gradient(circle at 100% 100%, transparent 52%, rgba(0,0,0,0.18) 100%)',
                  borderRadius: '0 0 22px 0', pointerEvents: 'none', zIndex: 5,
                }} />

                {/* Scrollable content layer */}
                <div
                  data-scroll-inner=""
                  style={{ position: 'absolute', inset: 0, zIndex: 3 }}
                >
                  <MobileCardContent widgetType={widgetType} />
                </div>
              </>
            )}

            {/* ── Side thumbnail ──────────────────────────────────────────── */}
            {isSide && (
              <>
                {/* Accent stripe on the inner edge (facing active card) */}
                <div style={{
                  position: 'absolute',
                  [isRight ? 'left' : 'right']: 0,
                  top: 3, bottom: 3, width: 2,
                  background: accent,
                  borderRadius: 2,
                  opacity: 0.65,
                }} />

                {/* Tap to swap — hapticSelection fires the iOS "tick" on touch */}
                <div
                  onPointerDown={e => {
                    e.stopPropagation();
                    hapticSelection();
                    swapWithActive(widgetType);
                  }}
                  style={{ position: 'absolute', inset: 0, zIndex: 10 }}
                />

                {/* Icon + label */}
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: isSmall ? 1 : 4,
                  padding: '3px 2px',
                  pointerEvents: 'none',
                }}>
                  <span style={{
                    fontSize: isSmall ? 14 : 18,
                    lineHeight: 1,
                    filter: `drop-shadow(0 0 5px ${accent}55)`,
                  }}>
                    {cfg?.icon ?? '🔧'}
                  </span>
                  {!isSmall && (
                    <span style={{
                      fontSize: 8,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)',
                      textAlign: 'center',
                      letterSpacing: '0.03em',
                      lineHeight: 1.2,
                      overflow: 'hidden',
                      maxWidth: '100%',
                      padding: '0 3px',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    } as CSSProperties}>
                      {cfg?.label ?? widgetType}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
