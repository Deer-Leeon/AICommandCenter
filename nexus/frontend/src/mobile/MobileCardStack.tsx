import { Fragment, useState, useRef, useCallback, useEffect, CSSProperties } from 'react';
import type { WidgetType } from '../types';
import { WIDGET_CONFIGS } from '../types';
import { MobileCardContent } from './cards/MobileCardRegistry';
import { hapticImpact, hapticSelection } from '../lib/capacitorBridge';

// ── Layout constants ──────────────────────────────────────────────────────────
const SIDE_W         = 30;
const SIDE_PAD_X     = 0;
const CENTER_GAP     = 4;
const SIDE_GAP       = 0;
const SLOTS_PER_SIDE = 5;
const ACTIVE_SLOT    = 5;   // slot index for the center card

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

// ── Fixed home slots ──────────────────────────────────────────────────────────
// 10 side positions — each widget has a permanent home here.
// Interleaved left/right so both columns fill evenly.
// The widget in home[0] starts as the active (center) card.
const HOME_SEQUENCE = [4, 6, 3, 7, 2, 8, 1, 9, 0, 10] as const;
const MAX_WIDGETS   = HOME_SEQUENCE.length; // 10

type HomeMap = Partial<Record<WidgetType, number>>;

function buildHomeMap(order: WidgetType[]): HomeMap {
  const map: HomeMap = {};
  order.slice(0, MAX_WIDGETS).forEach((w, i) => {
    const slot = HOME_SEQUENCE[i];
    if (slot !== undefined) map[w] = slot;
  });
  return map;
}

// ── Slot geometry ─────────────────────────────────────────────────────────────
function getSlotStyle(slotIdx: number, w: number, h: number): CSSProperties {
  const slotW   = SIDE_W - SIDE_PAD_X * 2;
  const slotH   = (h - SIDE_GAP * (SLOTS_PER_SIDE - 1)) / SLOTS_PER_SIDE;
  const centerW = w - (SIDE_W + CENTER_GAP) * 2;
  const centerL = SIDE_W + CENTER_GAP;

  if (slotIdx === ACTIVE_SLOT) {
    return {
      left: centerL, top: 0,
      width: centerW, height: h,
      borderRadius: 22,
      opacity: 1, zIndex: 50,
      boxShadow: '0 20px 60px var(--card-shadow), 0 4px 16px var(--side-shadow)',
    };
  }

  const isLeft      = slotIdx < ACTIVE_SLOT;
  const rowIdx      = isLeft ? slotIdx : slotIdx - (ACTIVE_SLOT + 1);
  const distFromActive = isLeft ? (ACTIVE_SLOT - 1 - slotIdx) : (slotIdx - (ACTIVE_SLOT + 1));

  const x      = isLeft ? SIDE_PAD_X : w - SIDE_W + SIDE_PAD_X;
  const y      = rowIdx * (slotH + SIDE_GAP);
  const radius = isLeft ? '0 10px 10px 0' : '10px 0 0 10px';

  return {
    left: x, top: y,
    width: slotW, height: slotH,
    borderRadius: radius,
    opacity: 0.92,
    zIndex: 30 - distFromActive,
    boxShadow: '0 2px 10px var(--side-shadow)',
  };
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  order: WidgetType[];
  onActiveWidgetChange?: (widget: WidgetType) => void;
}

export function MobileCardStack({ order, onActiveWidgetChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sz, setSz] = useState({ w: 0, h: 0 });

  // homeMap: each widget's permanent side slot (never changes at runtime)
  const [homeMap, setHomeMap] = useState<HomeMap>(() => buildHomeMap(order));

  // activeWidget: which widget is currently shown in the center slot
  const [activeWidget, setActiveWidget] = useState<WidgetType | null>(() => order[0] ?? null);

  const prevOrderKeyRef = useRef(order.slice(0, MAX_WIDGETS).join(','));

  // Sync home positions when layout editor saves a new order
  useEffect(() => {
    const key = order.slice(0, MAX_WIDGETS).join(',');
    if (key === prevOrderKeyRef.current) return;
    prevOrderKeyRef.current = key;

    const newMap = buildHomeMap(order);
    setHomeMap(newMap);

    // Keep the current active if it's still in the new layout; otherwise reset
    setActiveWidget(prev =>
      prev && newMap[prev] !== undefined ? prev : (order[0] ?? null)
    );
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

  // Notify parent when active widget changes
  useEffect(() => {
    if (activeWidget) onActiveWidgetChange?.(activeWidget);
  }, [activeWidget, onActiveWidgetChange]);

  // ── Focus a widget ────────────────────────────────────────────────────────
  // Each widget has a fixed home — tapping it moves it to center.
  // The previously active widget returns to ITS own home, not to the tapped widget's slot.
  const focusWidget = useCallback((widget: WidgetType) => {
    if (widget === activeWidget) return;
    setActiveWidget(widget);
    try { navigator.vibrate?.(7); } catch { /* iOS */ }
    hapticImpact('light');
  }, [activeWidget]);

  const ready = sz.w > 0 && sz.h > 0;

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', flex: 1, overflow: 'hidden', touchAction: 'pan-y', overscrollBehavior: 'none' }}
    >
      {/* Ambient glow */}
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

      {/* ── Cards ── */}
      {ready && (Object.entries(homeMap) as [WidgetType, number][]).map(([widgetType, homeSlot]) => {
        const isActive = widgetType === activeWidget;

        // The card element itself transitions between its homeSlot and the center
        const displaySlot = isActive ? ACTIVE_SLOT : homeSlot;
        const posStyle    = getSlotStyle(displaySlot, sz.w, sz.h);

        const isLeft  = homeSlot < ACTIVE_SLOT;
        const isRight = homeSlot > ACTIVE_SLOT;
        const cfg     = WIDGET_CONFIGS.find(c => c.id === widgetType);
        const accent  = WIDGET_ACCENT[widgetType] ?? 'var(--accent)';
        const slotH   = (sz.h - SIDE_GAP * (SLOTS_PER_SIDE - 1)) / SLOTS_PER_SIDE;
        const isSmall = slotH < 64;

        return (
          <Fragment key={widgetType}>
            {/* ── Main card (transitions between home ↔ center) ─────────── */}
            <div style={{
              position: 'absolute',
              transition: CARD_TRANSITION,
              background: isActive ? 'var(--surface)' : 'var(--surface2)',
              border: '1px solid var(--card-border)',
              overflow: 'hidden',
              willChange: 'left, top, width, height',
              cursor: isActive ? 'default' : 'pointer',
              backdropFilter: isActive ? 'blur(20px)' : 'blur(6px)',
              WebkitBackdropFilter: isActive ? 'blur(20px)' : 'blur(6px)',
              transform: 'none',
              ...posStyle,
            }}>
              {/* Active card content */}
              {isActive && (
                <>
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                    background: `linear-gradient(90deg, transparent 0%, ${accent} 35%, ${accent} 65%, transparent 100%)`,
                    opacity: 0.65, zIndex: 5, pointerEvents: 'none',
                  }} />
                  <div style={{
                    position: 'absolute', bottom: 0, right: 0, width: 22, height: 22,
                    background: 'radial-gradient(circle at 100% 100%, transparent 52%, rgba(0,0,0,0.18) 100%)',
                    borderRadius: '0 0 22px 0', pointerEvents: 'none', zIndex: 5,
                  }} />
                  <div data-scroll-inner="" style={{ position: 'absolute', inset: 0, zIndex: 3 }}>
                    <MobileCardContent widgetType={widgetType} />
                  </div>
                </>
              )}

              {/* Side thumbnail */}
              {!isActive && (
                <>
                  {/* Accent stripe on inner edge */}
                  <div style={{
                    position: 'absolute',
                    [isRight ? 'left' : 'right']: 0,
                    top: 3, bottom: 3, width: 2,
                    background: accent, borderRadius: 2, opacity: 0.65,
                  }} />

                  {/* Tap target */}
                  <div
                    onPointerDown={e => {
                      e.stopPropagation();
                      hapticSelection();
                      focusWidget(widgetType);
                    }}
                    style={{ position: 'absolute', inset: 0, zIndex: 10 }}
                  />

                  {/* Icon + label */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: isSmall ? 1 : 4, padding: '3px 2px', pointerEvents: 'none',
                  }}>
                    <span style={{
                      fontSize: isSmall ? 14 : 18, lineHeight: 1,
                      filter: `drop-shadow(0 0 5px ${accent}55)`,
                    }}>
                      {cfg?.icon ?? '🔧'}
                    </span>
                    {!isSmall && (
                      <span style={{
                        fontSize: 8, fontFamily: 'var(--font-mono)',
                        color: 'var(--text-muted)', textAlign: 'center',
                        letterSpacing: '0.03em', lineHeight: 1.2,
                        overflow: 'hidden', maxWidth: '100%', padding: '0 3px',
                        display: '-webkit-box',
                        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      } as CSSProperties}>
                        {cfg?.label ?? widgetType}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* ── Dotted ghost at home position while widget is active ───── */}
            {isActive && (
              <div style={{
                position: 'absolute',
                transition: CARD_TRANSITION,
                // Spread getSlotStyle to get correct position/size/borderRadius
                ...getSlotStyle(homeSlot, sz.w, sz.h),
                // Override visual to look like an empty dashed slot
                background: 'transparent',
                border: `1.5px dashed rgba(${isLeft ? '255,255,255' : '255,255,255'},0.13)`,
                boxShadow: 'none',
                opacity: 0.7,
                zIndex: 20,
                pointerEvents: 'none',
              }} />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
