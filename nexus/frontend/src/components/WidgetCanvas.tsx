import { useEffect, useLayoutEffect, useState, useCallback, lazy, Suspense, useRef, useMemo, Component } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../store/useStore';
import { useRevealStore } from '../store/useRevealStore';
import { WIDGET_CONFIGS, type WidgetType, type GridSpan, type SearchBarConfig } from '../types';
import { AIInputBar } from './AIInputBar';
import { AIResponseCard } from './AIResponseCard';
import { getCoveredCells } from './Grid';

// Lazy-loaded widget bundles
const CalendarWidget    = lazy(() => import('./widgets/CalendarWidget').then(m => ({ default: m.CalendarWidget })));
const SlackWidget       = lazy(() => import('./widgets/SlackWidget').then(m => ({ default: m.SlackWidget })));
const ObsidianWidget    = lazy(() => import('./widgets/ObsidianWidget').then(m => ({ default: m.ObsidianWidget })));
const GoogleDocsWidget  = lazy(() => import('./widgets/GoogleDocsWidget').then(m => ({ default: m.GoogleDocsWidget })));
const TodoWidget        = lazy(() => import('./widgets/TodoWidget').then(m => ({ default: m.TodoWidget })));
const SharedTodoWidget  = lazy(() => import('./widgets/SharedTodoWidget').then(m => ({ default: m.SharedTodoWidget })));
const SharedChessWidget = lazy(() => import('./widgets/SharedChessWidget').then(m => ({ default: m.SharedChessWidget })));
const WeatherWidget     = lazy(() => import('./widgets/WeatherWidget').then(m => ({ default: m.WeatherWidget })));
const TasksWidget       = lazy(() => import('./widgets/TasksWidget').then(m => ({ default: m.TasksWidget })));
const PlaidWidget       = lazy(() => import('./widgets/PlaidWidget').then(m => ({ default: m.PlaidWidget })));
const StocksWidget      = lazy(() => import('./widgets/StocksWidget').then(m => ({ default: m.StocksWidget })));
const QuickLinksWidget  = lazy(() => import('./widgets/QuickLinksWidget').then(m => ({ default: m.QuickLinksWidget })));
const NotesWidget       = lazy(() => import('./widgets/NotesWidget').then(m => ({ default: m.NotesWidget })));
const WordleWidget      = lazy(() => import('./widgets/WordleWidget').then(m => ({ default: m.WordleWidget })));
const NewsWidget        = lazy(() => import('./widgets/NewsWidget').then(m => ({ default: m.NewsWidget })));
const TypingWidget      = lazy(() => import('./widgets/TypingWidget').then(m => ({ default: m.TypingWidget })));
const PomodoroWidget    = lazy(() => import('./widgets/PomodoroWidget').then(m => ({ default: m.PomodoroWidget })));
const LofiWidget        = lazy(() => import('./widgets/LofiWidget').then(m => ({ default: m.LofiWidget })));
const SpotifyWidget     = lazy(() => import('./widgets/SpotifyWidget').then(m => ({ default: m.SpotifyWidget })));
const F1Widget          = lazy(() => import('./widgets/F1Widget').then(m => ({ default: m.F1Widget })));
const FootballWidget    = lazy(() => import('./widgets/FootballWidget').then(m => ({ default: m.FootballWidget })));
const TimezoneWidget    = lazy(() => import('./widgets/TimezoneWidget').then(m => ({ default: m.TimezoneWidget })));
const CurrencyWidget      = lazy(() => import('./widgets/CurrencyWidget').then(m => ({ default: m.CurrencyWidget })));
const SharedPhotoWidget   = lazy(() => import('./widgets/SharedPhotoWidget').then(m => ({ default: m.SharedPhotoWidget })));
const SharedCanvasWidget  = lazy(() => import('./widgets/SharedCanvasWidget').then(m => ({ default: m.SharedCanvasWidget })));
const BibleWidget         = lazy(() => import('./widgets/BibleWidget').then(m => ({ default: m.BibleWidget })));
const GmailWidget         = lazy(() => import('./widgets/GmailWidget').then(m => ({ default: m.GmailWidget })));

// ── Types ─────────────────────────────────────────────────────────────────────
interface WidgetRect { top: number; left: number; width: number; height: number; }

interface PendingSwap {
  fromKey: string;
  toKey:   string;
  fromDx:  number;
  fromDy:  number;
}

interface DragState {
  key: string;
  span: GridSpan;
  sourceRect: WidgetRect;
  startPtrX: number;
  startPtrY: number;
  dx: number;
  dy: number;
  // Canvas-relative offset of the viewport at drag-start, used to convert
  // pointer viewport coords → canvas coords for instant hover detection.
  canvasLeft: number;
  canvasTop: number;
}

interface SnapAnim {
  key: string;
  fromDx: number;
  fromDy: number;
  playing: boolean;   // false = at fromDx/fromDy (no transition), true = transition to 0
  isReturn: boolean;  // true = snapping back (ease-out), false = landing (spring)
  soft?: boolean;     // true = gentler spring (half overshoot) — used for the displaced widget in a swap
}

// ── Grid constants ─────────────────────────────────────────────────────────────
const ROWS = 2;
const COLS = 6;
const GRID_PADDING = 16;
const GRID_GAP = 10;
const BAR_H      = 54;
const BAR_MARGIN = 8;   // gap between bar edge and the nearest widget row (top/bottom modes)
const NOTCH      = 30;  // per-side notch when bar is in 'middle' mode

// ── Geometry helpers ──────────────────────────────────────────────────────────
interface GridGeometry {
  cellWidth:  number;
  cellHeight: number;
  topPad:     number;
  bottomPad:  number;
}

function getGridGeometry(gridEl: HTMLElement, _cfg: SearchBarConfig): GridGeometry {
  const gridRect   = gridEl.getBoundingClientRect();
  const availWidth = gridRect.width - GRID_PADDING * 2;

  // Bar-column cells in top/bottom modes are adjusted individually in computeRects,
  // so global geometry always uses uniform GRID_PADDING on all sides.
  const topPad      = GRID_PADDING;
  const bottomPad   = GRID_PADDING;
  const availHeight = gridRect.height - topPad - bottomPad;

  return {
    cellWidth:  (availWidth  - GRID_GAP * (COLS - 1)) / COLS,
    cellHeight: (availHeight - GRID_GAP * (ROWS - 1)) / ROWS,
    topPad,
    bottomPad,
  };
}

// ── Geometry ──────────────────────────────────────────────────────────────────
function computeRects(
  gridEl: HTMLElement,
  gridSpans: Record<string, GridSpan>,
  cfg: SearchBarConfig,
): Record<string, WidgetRect> {
  const { cellWidth, cellHeight, topPad } = getGridGeometry(gridEl, cfg);

  // Notch: middle mode only — columns under the bar are shortened so the bar
  // can sit between the two rows without overlapping widget content.
  const notchCols = cfg.position === 'middle'
    ? new Set(Array.from({ length: cfg.colSpan }, (_, i) => cfg.colStart + i))
    : new Set<number>();

  // Top/bottom modes: bar columns are shifted/shortened away from the bar edge.
  // Non-bar columns stretch all the way to the opposite edge (full height).
  const barCols  = (cfg.position === 'top' || cfg.position === 'bottom')
    ? new Set(Array.from({ length: cfg.colSpan }, (_, i) => cfg.colStart + i))
    : new Set<number>();
  const barExtra = BAR_H + BAR_MARGIN; // space reserved in bar columns

  const rects: Record<string, WidgetRect> = {};
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const key  = `${row},${col}`;
      const span = gridSpans[key] ?? { colSpan: 1, rowSpan: 1 };

      let top    = topPad + row * (cellHeight + GRID_GAP);
      let height = span.rowSpan * cellHeight + (span.rowSpan - 1) * GRID_GAP;

      // Middle-mode notch: shorten cells in bar columns so the bar fits between rows.
      const inNotchCol = span.colSpan === 1
        ? notchCols.has(col)
        : Array.from({ length: span.colSpan }, (_, i) => col + i).some(c => notchCols.has(c));
      if (inNotchCol && span.rowSpan === 1) {
        if (row === 0) { height -= NOTCH; }
        else           { top += NOTCH; height -= NOTCH; }
      }

      // Top/bottom mode per-column adjustment:
      // Bar columns are pushed away from the bar; non-bar columns fill the freed space.
      const spansBarCol = barCols.size > 0 && (
        span.colSpan === 1
          ? barCols.has(col)
          : Array.from({ length: span.colSpan }, (_, i) => col + i).some(c => barCols.has(c))
      );
      if (spansBarCol) {
        if (cfg.position === 'top' && row === 0) {
          top    += barExtra;
          height -= barExtra;
        } else if (cfg.position === 'bottom' && row + span.rowSpan - 1 === ROWS - 1) {
          height -= barExtra;
        }
      }

      rects[key] = {
        top,
        left:   GRID_PADDING + col * (cellWidth + GRID_GAP),
        width:  span.colSpan * cellWidth + (span.colSpan - 1) * GRID_GAP,
        height,
      };
    }
  }
  return rects;
}

function computeSearchBarRect(
  gridEl: HTMLElement,
  cfg: SearchBarConfig,
): WidgetRect {
  const gridRect = gridEl.getBoundingClientRect();
  const { cellWidth, cellHeight, topPad } = getGridGeometry(gridEl, cfg);

  const left  = GRID_PADDING + cfg.colStart * (cellWidth + GRID_GAP);
  const width = cfg.colSpan * cellWidth + (cfg.colSpan - 1) * GRID_GAP;

  let top: number;
  if (cfg.position === 'top') {
    top = GRID_PADDING;
  } else if (cfg.position === 'bottom') {
    top = gridRect.height - GRID_PADDING - BAR_H;
  } else {
    // middle: bar floats at the boundary between row 0 and row 1
    const centerY = topPad + cellHeight + GRID_GAP / 2;
    top = centerY - BAR_H / 2;
  }

  return { top, left, width, height: BAR_H };
}

// ── Search-bar slot ────────────────────────────────────────────────────────────
// Purely a positioning wrapper — no drag/resize handles here.
// All search-bar layout editing (resize + reposition) lives exclusively in
// GridLayoutMode so it can only be changed when the user enters layout edit mode.
function SearchBarSlot({ rect }: { rect: WidgetRect | null }) {
  if (!rect) return null;

  return (
    <div style={{
      position: 'absolute', top: rect.top, left: rect.left,
      width: rect.width, height: rect.height,
      display: 'flex', flexDirection: 'column',
      alignItems: 'stretch', justifyContent: 'center',
      pointerEvents: 'auto',
    }}>
      <AIResponseCard />
      <AIInputBar />
    </div>
  );
}

// ── Widget component map ───────────────────────────────────────────────────────
// shared_chess is intentionally absent — always rendered via SharedChessWidget (always shared)
const WIDGET_COMPONENTS: Partial<Record<WidgetType, React.ComponentType<{ onClose: () => void }>>> = {
  calendar: CalendarWidget,
  slack:    SlackWidget,
  obsidian: ObsidianWidget,
  docs:     GoogleDocsWidget,
  todo:     TodoWidget,
  weather:  WeatherWidget,
  tasks:    TasksWidget,
  plaid:    PlaidWidget,
  stocks:   StocksWidget,
  links:    QuickLinksWidget,
  notes:    NotesWidget,
  wordle:   WordleWidget,
  news:     NewsWidget,
  typing:   TypingWidget,
  pomodoro: PomodoroWidget,
  lofi:     LofiWidget,
  spotify:  SpotifyWidget,
  f1:       F1Widget,
  football: FootballWidget,
  timezone: TimezoneWidget,
  currency: CurrencyWidget,
  bible:    BibleWidget,
  gmail:    GmailWidget,
};

// Delays matched to 0.6s ease-out smooth reveal (no keyframe staging):
// ease-out moves fast early — bottom (~35% progress) at ~15% time = 90ms,
// top (~55% progress) at ~40% time = 240ms.
const ROW_REVEAL_DELAY: Record<number, number> = { 0: 240, 1: 90 };

// ── WidgetErrorBoundary ────────────────────────────────────────────────────────
// Catches render errors inside any widget so one crashing widget never takes
// the whole app to a white screen.
class WidgetErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[WidgetErrorBoundary] Widget render error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 8,
          color: 'var(--text-faint)', fontSize: 12, padding: 16,
          textAlign: 'center',
        }}>
          <span style={{ fontSize: 22 }}>⚠️</span>
          <p style={{ margin: 0 }}>Widget crashed</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text)', fontSize: 11,
              padding: '4px 12px', cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── PlacedWidget ───────────────────────────────────────────────────────────────
interface PlacedWidgetProps {
  widgetType:    WidgetType;
  rect:          WidgetRect;
  cellKey:       string;
  connectionId?: string;  // set for shared widgets (todo type only for now)
  onClose:       () => void;
  onTitlePointerDown: (e: React.PointerEvent) => void;
  isDragging:    boolean;
  dragDx:        number;
  dragDy:        number;
  snapAnim:      SnapAnim | null;
}

function PlacedWidget({
  widgetType, rect, cellKey, connectionId, onClose,
  onTitlePointerDown, isDragging, dragDx, dragDy, snapAnim,
}: PlacedWidgetProps) {
  const { flashingWidget } = useStore();
  const { revealing, revealed } = useRevealStore();
  const config = WIDGET_CONFIGS.find((w) => w.id === widgetType);
  const WidgetComponent = WIDGET_COMPONENTS[widgetType];
  const isFlashing = flashingWidget === widgetType;

  // Guard: if the widget type doesn't exist in config (e.g. a stale DB entry
  // referencing a widget that was renamed or removed) skip rendering instead
  // of crashing the entire app with "Cannot read properties of undefined".
  // shared_chess and shared_photo are intentionally absent from WIDGET_COMPONENTS —
  // they use their own special render paths in the JSX below.
  if (!config) return null;
  if (!WidgetComponent && widgetType !== 'shared_chess' && widgetType !== 'shared_photo' && widgetType !== 'shared_canvas') return null;
  const row = parseInt(cellKey.split(',')[0], 10);
  const revealDelay = ROW_REVEAL_DELAY[row] ?? 900;

  let visibilityStyle: React.CSSProperties;
  if (revealed)        visibilityStyle = { opacity: 1 };
  else if (revealing)  visibilityStyle = { animation: `nexusWidgetIn 0.3s ${revealDelay}ms cubic-bezier(0, 0, 0.2, 1) both` };
  else                 visibilityStyle = { opacity: 0 };

  // ── Transform / transition for drag and snap ────────────────────────────────
  let transform  = 'none';
  let transition = '';
  let zIndex: number | undefined;
  let boxShadow  = 'var(--shadow-widget)';
  let opacity    = 1;

  if (isDragging) {
    transform  = `translate(${dragDx}px, ${dragDy}px) scale(1.03)`;
    zIndex     = 200;
    boxShadow  = '0 24px 60px rgba(0,0,0,0.5), 0 0 0 2px rgba(255,255,255,0.1)';
    opacity    = 0.95;
    transition = 'box-shadow 0.1s ease, opacity 0.1s ease';
  } else if (snapAnim) {
    transform  = snapAnim.playing ? 'none' : `translate(${snapAnim.fromDx}px, ${snapAnim.fromDy}px)`;
    // Landing curves: full spring (1.56 overshoot), soft spring (1.28 = half overshoot), ease-out (no bounce)
    const landingCurve = snapAnim.soft
      ? '360ms cubic-bezier(0.34,1.28,0.64,1)'
      : '360ms cubic-bezier(0.34,1.56,0.64,1)';
    transition = snapAnim.playing
      ? `transform ${snapAnim.isReturn ? '280ms cubic-bezier(0.25,0.46,0.45,0.94)' : landingCurve}, box-shadow 0.15s ease`
      : 'none';
    zIndex = snapAnim.playing ? undefined : 200;
  } else {
    // Normal state — smooth position changes when grid resizes
    transition = 'box-shadow 0.15s ease, border-color 0.15s ease';
  }

  return (
    <div
      className={`absolute rounded-[10px] overflow-hidden flex flex-col ${isFlashing ? 'widget-flash' : ''}`}
      style={{
        top: rect.top, left: rect.left, width: rect.width, height: rect.height,
        background: 'var(--surface)',
        border: `1px solid ${config.accentColor}40`,
        boxShadow, transform, transition, zIndex, opacity,
        willChange: isDragging ? 'transform' : undefined,
        ...visibilityStyle,
      }}
      onMouseEnter={(e) => {
        if (isDragging) return;
        (e.currentTarget as HTMLElement).style.borderColor = config.accentColor + '70';
        (e.currentTarget as HTMLElement).style.boxShadow = `var(--shadow-widget-hover), 0 0 12px ${config.accentColor}20`;
      }}
      onMouseLeave={(e) => {
        if (isDragging) return;
        (e.currentTarget as HTMLElement).style.borderColor = config.accentColor + '40';
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-widget)';
      }}
      data-cell={cellKey}
      data-widget-type={widgetType}
    >
      {/* Title bar — grab handle */}
      <div
        className="flex items-center justify-between px-3 py-2 flex-shrink-0"
        style={{
          background: 'var(--surface2)',
          borderBottom: '1px solid var(--border)',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none',
        }}
        onPointerDown={onTitlePointerDown}
      >
        <div className="flex items-center gap-2">
          <span style={{ fontSize: '13px' }}>{config.icon}</span>
          <span
            className="widget-title font-mono text-xs uppercase tracking-wider"
            style={{ color: config.accentColor, letterSpacing: '0.1em' }}
          >
            {config.label}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-xs w-5 h-5 rounded flex items-center justify-center transition-colors"
          style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
          onPointerDown={(e) => e.stopPropagation()} // prevent drag start on close btn
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = 'var(--color-danger)';
            (e.currentTarget as HTMLElement).style.background = 'var(--color-danger-bg)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          }}
        >
          ×
        </button>
      </div>

      {/* Widget content */}
      <div className="flex-1 overflow-hidden" style={{ pointerEvents: isDragging ? 'none' : 'auto' }}>
        <WidgetErrorBoundary>
          <Suspense fallback={null}>
            {widgetType === 'todo' && connectionId
              ? <SharedTodoWidget connectionId={connectionId} slotKey={cellKey} onClose={onClose} />
              : widgetType === 'shared_chess'
              ? <SharedChessWidget connectionId={connectionId ?? ''} slotKey={cellKey} onClose={onClose} />
              : widgetType === 'shared_photo'
              ? <SharedPhotoWidget connectionId={connectionId ?? ''} slotKey={cellKey} onClose={onClose} />
              : widgetType === 'shared_canvas'
              ? <SharedCanvasWidget connectionId={connectionId ?? ''} slotKey={cellKey} onClose={onClose} />
              : WidgetComponent
              ? <WidgetComponent onClose={onClose} />
              : null
            }
          </Suspense>
        </WidgetErrorBoundary>
      </div>

      {/* Transparent overlay during drag — blocks content interactions and keeps cursor correct */}
      {isDragging && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, cursor: 'grabbing' }} />
      )}
    </div>
  );
}

// ── WidgetCanvas ───────────────────────────────────────────────────────────────
interface WidgetCanvasProps { gridEl: HTMLElement | null; }

export function WidgetCanvas({ gridEl }: WidgetCanvasProps) {
  const { grid, gridSpans, gridConnections, removeWidget, moveWidget, swapWidgets, swapNotifyEnabled, searchBarConfig } = useStore();
  const { revealing, revealed } = useRevealStore();

  // Columns that fall under the search bar in middle mode — used by the drag
  // target / glow-cell logic below to skip multi-row zones that would bridge
  // across the search bar slot.
  const notchCols = searchBarConfig.position === 'middle'
    ? new Set(Array.from({ length: searchBarConfig.colSpan }, (_, i) => searchBarConfig.colStart + i))
    : new Set<number>();
  const [rects, setRects]               = useState<Record<string, WidgetRect>>({});
  const [searchBarRect, setSearchBarRect] = useState<WidgetRect | null>(null);
  const [drag, setDrag]                 = useState<DragState | null>(null);
  const [snapAnims, setSnapAnims]       = useState<SnapAnim[]>([]);
  const [pendingSwap, setPendingSwap]   = useState<PendingSwap | null>(null);

  // Refs for stable access inside event listeners
  const dragRef        = useRef<DragState | null>(null);
  const rectsRef       = useRef<Record<string, WidgetRect>>({});
  const gridRef        = useRef(grid);
  const gridSpansRef   = useRef(gridSpans);
  const moveWidgetRef  = useRef(moveWidget);
  const swapWidgetsRef = useRef(swapWidgets);
  const swapNotifyRef  = useRef(swapNotifyEnabled);

  useEffect(() => { rectsRef.current      = rects;             }, [rects]);
  useEffect(() => { gridRef.current       = grid;              }, [grid]);
  useEffect(() => { gridSpansRef.current  = gridSpans;         }, [gridSpans]);
  useEffect(() => { moveWidgetRef.current = moveWidget;        }, [moveWidget]);
  useEffect(() => { swapWidgetsRef.current = swapWidgets;      }, [swapWidgets]);
  useEffect(() => { swapNotifyRef.current  = swapNotifyEnabled; }, [swapNotifyEnabled]);

  // ── Rect computation ─────────────────────────────────────────────────────────
  const recomputeRects = useCallback(() => {
    if (!gridEl) return;
    setRects(computeRects(gridEl, gridSpans, searchBarConfig));
    setSearchBarRect(computeSearchBarRect(gridEl, searchBarConfig));
  }, [gridEl, gridSpans, searchBarConfig]);

  // useLayoutEffect fires synchronously before the browser paints — this means
  // the search bar rect is computed and applied in the same frame that gridEl
  // first becomes available, eliminating the one-frame delay where the bar
  // was invisible (searchBarRect = null) before useEffect would have fired.
  useLayoutEffect(() => { recomputeRects(); }, [recomputeRects]);

  useEffect(() => {
    if (!gridEl) return;
    const observer = new ResizeObserver(recomputeRects);
    observer.observe(gridEl);
    return () => observer.disconnect();
  }, [gridEl, recomputeRects]);

  // ── Valid drop targets ────────────────────────────────────────────────────────
  // A zone is valid if the widget's entire span fits there and every cell in that
  // area is empty (not occupied, not covered by another span, and any pre-merged
  // empty zone within the area doesn't extend outside it).
  // Multi-row zones are blocked from spanning notch columns (would cover the bar).
  const dragKey   = drag?.key;
  const dragSpanR = drag?.span.rowSpan;
  const dragSpanC = drag?.span.colSpan;

  const validTargets = useMemo(() => {
    if (!dragKey || !gridEl) return [];
    const rowSpan = dragSpanR ?? 1;
    const colSpan = dragSpanC ?? 1;
    const [srcRow, srcCol] = dragKey.split(',').map(Number);

    // Cells the source widget currently occupies — don't treat as blockers
    const sourceCells = new Set<string>();
    for (let r = srcRow; r < srcRow + rowSpan; r++)
      for (let c = srcCol; c < srcCol + colSpan; c++)
        sourceCells.add(`${r},${c}`);

    // Non-top-left cells covered by any multi-cell span
    const allCovered = getCoveredCells(gridSpansRef.current);

    // Precompute cell dimensions from the live grid element size
    const gridRect = gridEl.getBoundingClientRect();
    const availW = gridRect.width  - GRID_PADDING * 2;
    const availH = gridRect.height - GRID_PADDING * 2;
    const cw = (availW - GRID_GAP * (COLS - 1)) / COLS;
    const ch = (availH - GRID_GAP * (ROWS - 1)) / ROWS;

    const out: { key: string; rect: WidgetRect }[] = [];

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        // Bounds check
        if (row + rowSpan > ROWS || col + colSpan > COLS) continue;
        // Same top-left as source — skip
        if (row === srcRow && col === srcCol) continue;

        // Multi-row zones must not span notch columns (would bridge the search bar)
        const colsInZone = Array.from({ length: colSpan }, (_, i) => col + i);
        const inNotchCol = colsInZone.some(c => notchCols.has(c));
        if (rowSpan > 1 && inNotchCol) continue;

        // Every cell in the zone must be empty and unobstructed.
        // Source cells are allowed (enables "shift one cell" moves) — they count
        // as free because the widget is leaving them.
        let valid = true;
        for (let r = row; r < row + rowSpan && valid; r++) {
          for (let c = col; c < col + colSpan && valid; c++) {
            const k = `${r},${c}`;
            if (sourceCells.has(k)) continue;                    // leaving this cell — OK
            if (gridRef.current[k]) { valid = false; break; }   // occupied by another widget
            if (allCovered.has(k))  { valid = false; break; }   // covered by another span
            // Pre-merged empty zone must fit entirely within this target area
            const cs = gridSpansRef.current[k];
            if (cs && (cs.rowSpan > 1 || cs.colSpan > 1)) {
              if (r + cs.rowSpan > row + rowSpan || c + cs.colSpan > col + colSpan) {
                valid = false;
              }
            }
          }
        }
        if (!valid) continue;

        // Compute the combined rect for this drop zone
        let top    = GRID_PADDING + row * (ch + GRID_GAP);
        let height = rowSpan * ch + (rowSpan - 1) * GRID_GAP;
        const left  = GRID_PADDING + col * (cw + GRID_GAP);
        const width = colSpan * cw + (colSpan - 1) * GRID_GAP;
        if (inNotchCol && rowSpan === 1) {
          if (row === 0) height -= NOTCH;
          else           { top += NOTCH; height -= NOTCH; }
        }
        out.push({ key: `${row},${col}`, rect: { top, left, width, height } });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragKey, dragSpanR, dragSpanC, grid, gridSpans, rects, gridEl]);

  // Keep a stable ref so commitDrop (a window listener) can read current targets
  const validTargetsRef = useRef<{ key: string; rect: WidgetRect }[]>([]);
  useEffect(() => { validTargetsRef.current = validTargets; }, [validTargets]);

  // ── Swap targets — occupied widgets that can be swapped with ─────────────────
  const swapTargets = useMemo(() => {
    if (!dragKey) return [];
    const covered = getCoveredCells(gridSpansRef.current);
    return Object.entries(gridRef.current)
      .filter(([key, w]) => w != null && key !== dragKey && !covered.has(key))
      .map(([key]) => ({ key, rect: rectsRef.current[key] }))
      .filter(t => t.rect != null) as { key: string; rect: WidgetRect }[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragKey, grid, rects]);

  const swapTargetsRef = useRef<{ key: string; rect: WidgetRect }[]>([]);
  useEffect(() => { swapTargetsRef.current = swapTargets; }, [swapTargets]);

  // ── Individual cell rects for the soft glow layer ───────────────────────────
  // Computed per-cell (not per-zone) so every cell is rendered exactly once —
  // no stacking when two valid zones share a cell.
  const validCellRects = useMemo(() => {
    if (!drag || !gridEl || validTargets.length === 0) return new Map<string, WidgetRect>();
    const rowSpan = drag.span.rowSpan;
    const colSpan = drag.span.colSpan;

    // Build the set of cells the dragged widget currently occupies — these must
    // never receive a glow even if they fall inside a valid target zone.
    const [srcRow, srcCol] = drag.key.split(',').map(Number);
    const sourceCells = new Set<string>();
    for (let r = srcRow; r < srcRow + rowSpan; r++)
      for (let c = srcCol; c < srcCol + colSpan; c++)
        sourceCells.add(`${r},${c}`);

    const gridRect = gridEl.getBoundingClientRect();
    const cw = (gridRect.width  - GRID_PADDING * 2 - GRID_GAP * (COLS - 1)) / COLS;
    const ch = (gridRect.height - GRID_PADDING * 2 - GRID_GAP * (ROWS - 1)) / ROWS;
    const result = new Map<string, WidgetRect>();
    for (const { key } of validTargets) {
      const [row, col] = key.split(',').map(Number);
      for (let r = row; r < row + rowSpan; r++) {
        for (let c = col; c < col + colSpan; c++) {
          const k = `${r},${c}`;
          if (result.has(k) || sourceCells.has(k)) continue; // skip already-added & source cells
          const inNotch = notchCols.has(c);
          let top    = GRID_PADDING + r * (ch + GRID_GAP);
          let height = ch;
          if (inNotch) { if (r === 0) height -= NOTCH; else { top += NOTCH; height -= NOTCH; } }
          result.set(k, { top, left: GRID_PADDING + c * (cw + GRID_GAP), width: cw, height });
        }
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, validTargets, gridEl]);

  // ── Ghost-overlap target detection ───────────────────────────────────────────
  // Returns the valid zone with the most overlap against the widget's visual
  // bounding box (the "ghost").  This accounts for grab offset so a 2×1 widget
  // grabbed from its left edge still snaps correctly when its body overlaps a
  // zone even though the pointer never enters that zone.
  function bestOverlapTarget(
    ds: DragState,
    targets: { key: string; rect: WidgetRect }[],
  ): { key: string; rect: WidgetRect } | null {
    if (targets.length === 0) return null;

    // Widget ghost rect in canvas-relative coords
    const ghost = {
      left:   ds.sourceRect.left + ds.dx,
      top:    ds.sourceRect.top  + ds.dy,
      width:  ds.sourceRect.width,
      height: ds.sourceRect.height,
    };

    let bestKey: string | null = null;
    let bestZoneRect: WidgetRect | null = null;
    let bestOv = 0;

    for (const { key, rect } of targets) {
      const ox = Math.max(0, Math.min(ghost.left + ghost.width,  rect.left + rect.width)  - Math.max(ghost.left, rect.left));
      const oy = Math.max(0, Math.min(ghost.top  + ghost.height, rect.top  + rect.height) - Math.max(ghost.top,  rect.top));
      const ov = ox * oy;
      if (ov > bestOv) { bestOv = ov; bestKey = key; bestZoneRect = rect; }
    }

    // Require the ghost to cover at least 55% of the zone area before activating.
    // This is high enough that a zone adjacent to the source (which gets ~48%
    // coverage when the ghost is still at its origin) won't false-trigger, yet
    // low enough that a deliberate move over that zone (>55% covered) locks in.
    if (bestKey && bestZoneRect) {
      if (bestOv < bestZoneRect.width * bestZoneRect.height * 0.55) return null;
    }

    return bestKey ? { key: bestKey, rect: bestZoneRect! } : null;
  }

  // ── Which target zone is the widget ghost currently overlapping the most? ────
  // Checks empty drop targets first; falls back to occupied swap targets.
  const { hoverTargetKey, hoverIsSwap } = useMemo(() => {
    if (!drag) return { hoverTargetKey: null, hoverIsSwap: false };
    const dropBest = validTargets.length > 0 ? bestOverlapTarget(drag, validTargets) : null;
    if (dropBest) return { hoverTargetKey: dropBest.key, hoverIsSwap: false };
    const swapBest = swapTargets.length > 0 ? bestOverlapTarget(drag, swapTargets) : null;
    if (swapBest) return { hoverTargetKey: swapBest.key, hoverIsSwap: true };
    return { hoverTargetKey: null, hoverIsSwap: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, validTargets, swapTargets]);

  // Stable refs so commitDrop can read the current hover state
  const hoverTargetKeyRef = useRef<string | null>(null);
  const hoverIsSwapRef    = useRef(false);
  useEffect(() => { hoverTargetKeyRef.current = hoverTargetKey; }, [hoverTargetKey]);
  useEffect(() => { hoverIsSwapRef.current    = hoverIsSwap;    }, [hoverIsSwap]);

  // ── Commit drop ──────────────────────────────────────────────────────────────
  const commitDrop = useCallback(() => {
    const ds = dragRef.current;
    if (!ds) return;
    dragRef.current = null;

    const targetKey = hoverTargetKeyRef.current;
    const isSwap    = hoverIsSwapRef.current;

    const allTargets = isSwap ? swapTargetsRef.current : validTargetsRef.current;
    const dropTarget = targetKey ? allTargets.find(t => t.key === targetKey) ?? null : null;

    setDrag(null);

    if (dropTarget && isSwap) {
      // ── Swap path ────────────────────────────────────────────────────────────
      const spanA = gridSpansRef.current[ds.key]    ?? { rowSpan: 1, colSpan: 1 };
      const spanB = gridSpansRef.current[dropTarget.key] ?? { rowSpan: 1, colSpan: 1 };
      const sameSize = spanA.rowSpan === spanB.rowSpan && spanA.colSpan === spanB.colSpan;
      const fromDx = ds.sourceRect.left + ds.dx - dropTarget.rect.left;
      const fromDy = ds.sourceRect.top  + ds.dy - dropTarget.rect.top;

      // FLIP offsets for the displaced widget (travels from dropTarget → source)
      const dispDx = dropTarget.rect.left - ds.sourceRect.left;
      const dispDy = dropTarget.rect.top  - ds.sourceRect.top;

      if (sameSize || !swapNotifyRef.current) {
        // Swap immediately — animate BOTH widgets simultaneously
        swapWidgetsRef.current(ds.key, dropTarget.key);
        setSnapAnims([
          { key: dropTarget.key, fromDx, fromDy, playing: false, isReturn: false },
          { key: ds.key,         fromDx: dispDx, fromDy: dispDy, playing: false, isReturn: false, soft: true },
        ]);
        requestAnimationFrame(() => requestAnimationFrame(() =>
          setSnapAnims(prev => prev.map(a => ({ ...a, playing: true })))));
        setTimeout(() => setSnapAnims([]), 450);
      } else {
        // Different size — hold the pending swap and show confirmation modal
        setPendingSwap({ fromKey: ds.key, toKey: dropTarget.key, fromDx, fromDy });
      }
    } else if (dropTarget) {
      // ── Normal drop path ─────────────────────────────────────────────────────
      const fromDx = ds.sourceRect.left + ds.dx - dropTarget.rect.left;
      const fromDy = ds.sourceRect.top  + ds.dy - dropTarget.rect.top;
      moveWidgetRef.current(ds.key, dropTarget.key);
      setSnapAnims([{ key: dropTarget.key, fromDx, fromDy, playing: false, isReturn: false }]);
      requestAnimationFrame(() => requestAnimationFrame(() =>
        setSnapAnims(prev => prev.map(a => ({ ...a, playing: true })))));
      setTimeout(() => setSnapAnims([]), 450);
    } else {
      // Snap back
      setSnapAnims([{ key: ds.key, fromDx: ds.dx, fromDy: ds.dy, playing: false, isReturn: true }]);
      requestAnimationFrame(() => requestAnimationFrame(() =>
        setSnapAnims(prev => prev.map(a => ({ ...a, playing: true })))));
      setTimeout(() => setSnapAnims([]), 350);
    }
  }, []);

  // ── Window-level pointer listeners — only active while dragging ───────────────
  const isDraggingBool = drag !== null;
  useEffect(() => {
    if (!isDraggingBool) return;

    const onMove = (e: PointerEvent) => {
      const ds = dragRef.current;
      if (!ds) return;
      const updated: DragState = { ...ds, dx: e.clientX - ds.startPtrX, dy: e.clientY - ds.startPtrY };
      dragRef.current = updated;
      setDrag(updated);
    };
    const onUp = () => commitDrop();

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup',   onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
    };
  }, [isDraggingBool, commitDrop]);

  // ── Drag start (called from PlacedWidget title bar) ───────────────────────────
  const startDrag = useCallback((key: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const sourceRect = rectsRef.current[key];
    if (!sourceRect || !gridEl) return;
    const canvasRect = gridEl.getBoundingClientRect();
    const span = gridSpansRef.current[key] ?? { rowSpan: 1, colSpan: 1 };
    const ds: DragState = {
      key, span, sourceRect,
      startPtrX: e.clientX, startPtrY: e.clientY,
      dx: 0, dy: 0,
      canvasLeft: canvasRect.left,
      canvasTop:  canvasRect.top,
    };
    dragRef.current = ds;
    setSnapAnims([]);
    setDrag(ds);
  }, [gridEl]);

  const placedWidgets = Object.entries(grid).filter(([, v]) => v !== null);

  return (
    <>
      {/* z=10 layer — widgets + drop-target highlights.
          Lives BELOW RevealOverlay (z=50) so the wave covers them during load. */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>

        {/* Layer 1 — soft green glow on empty available cells */}
        {drag && !hoverIsSwap && Array.from(validCellRects.entries()).map(([cellKey, rect]) => (
          <div key={`cell-${cellKey}`} style={{
            position: 'absolute',
            top: rect.top, left: rect.left, width: rect.width, height: rect.height,
            borderRadius: 10,
            background: 'rgba(61,232,176,0.07)',
            pointerEvents: 'none',
            zIndex: 5,
          }} />
        ))}

        {/* Layer 2a — bright dashed green border on hovered drop zone */}
        {drag && hoverTargetKey && !hoverIsSwap && (() => {
          const target = validTargets.find(t => t.key === hoverTargetKey);
          if (!target) return null;
          return (
            <div style={{
              position: 'absolute',
              top: target.rect.top, left: target.rect.left,
              width: target.rect.width, height: target.rect.height,
              borderRadius: 10,
              border: '2px dashed rgba(61,232,176,0.9)',
              background: 'rgba(61,232,176,0.11)',
              boxShadow: '0 0 18px rgba(61,232,176,0.25)',
              pointerEvents: 'none',
              zIndex: 6,
              transition: 'opacity 0.1s',
            }} />
          );
        })()}

        {/* Layer 2b — amber swap indicator on hovered occupied widget */}
        {drag && hoverTargetKey && hoverIsSwap && (() => {
          const target = swapTargets.find(t => t.key === hoverTargetKey);
          if (!target) return null;
          const spanA = gridSpansRef.current[drag.key]    ?? { rowSpan: 1, colSpan: 1 };
          const spanB = gridSpansRef.current[hoverTargetKey] ?? { rowSpan: 1, colSpan: 1 };
          const sameSize = spanA.rowSpan === spanB.rowSpan && spanA.colSpan === spanB.colSpan;
          const col = sameSize ? 'rgba(251,191,36' : 'rgba(251,146,60'; // amber vs orange
          return (
            <div style={{
              position: 'absolute',
              top: target.rect.top, left: target.rect.left,
              width: target.rect.width, height: target.rect.height,
              borderRadius: 10,
              border: `2px dashed ${col},0.9)`,
              background: `${col},0.08)`,
              boxShadow: `0 0 18px ${col},0.2)`,
              pointerEvents: 'none',
              zIndex: 6,
              transition: 'opacity 0.1s',
            }}>
              {/* Swap icon overlay */}
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: 22, opacity: 0.7,
              }}>⇄</div>
            </div>
          );
        })()}

        {/* Widgets */}
        {placedWidgets.map(([key, widgetType]) => {
          const rect = rects[key];
          if (!rect || !widgetType) return null;
          const isDragging   = drag?.key === key;
          const mySnap       = snapAnims.find(a => a.key === key) ?? null;
          const connectionId = gridConnections[key];
          // Use connectionId as the React key for shared widgets so the component
          // instance survives slot moves — prevents state reset and blank flashes.
          const reactKey = connectionId ?? key;
          return (
            <div key={reactKey} style={{ pointerEvents: 'auto' }}>
              <PlacedWidget
                widgetType={widgetType}
                rect={rect}
                cellKey={key}
                connectionId={connectionId}
                onClose={() => removeWidget(key)}
                onTitlePointerDown={(e) => startDrag(key, e)}
                isDragging={!!isDragging}
                dragDx={isDragging ? drag.dx : 0}
                dragDy={isDragging ? drag.dy : 0}
                snapAnim={mySnap}
              />
            </div>
          );
        })}
      </div>

      {/* z=55 layer — search bar reveals in sync with the wave animation.
          GridLayoutMode is raised to z=56 so it still covers this slot in layout mode.
          SettingsModal is at z=60 so it covers both.
          Delay 160ms sits between row 1 (90ms) and row 0 (240ms) on the ease-out curve. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          zIndex: 55,
          ...(revealed
            ? { opacity: 1 }
            : revealing
            ? { animation: 'nexusWidgetIn 0.3s 160ms cubic-bezier(0, 0, 0.2, 1) both', pointerEvents: 'none' }
            : { opacity: 0, pointerEvents: 'none' }),
        }}
      >
        <SearchBarSlot rect={searchBarRect} />
      </div>

      {/* z=58 — swap confirmation modal */}
      {pendingSwap && (
        <SwapConfirmModal
          fromWidget={grid[pendingSwap.fromKey] ?? 'todo'}
          toWidget={grid[pendingSwap.toKey]   ?? 'todo'}
          fromSpan={gridSpans[pendingSwap.fromKey] ?? { rowSpan: 1, colSpan: 1 }}
          toSpan={gridSpans[pendingSwap.toKey]   ?? { rowSpan: 1, colSpan: 1 }}
          onConfirm={(dontShowAgain) => {
            if (dontShowAgain) useStore.getState().setSwapNotifyEnabled(false);
            // Compute displaced widget FLIP offset
            const toRect   = rectsRef.current[pendingSwap.toKey];
            const fromRect = rectsRef.current[pendingSwap.fromKey];
            const dispDx = toRect && fromRect ? toRect.left - fromRect.left : 0;
            const dispDy = toRect && fromRect ? toRect.top  - fromRect.top  : 0;
            swapWidgets(pendingSwap.fromKey, pendingSwap.toKey);
            setSnapAnims([
              { key: pendingSwap.toKey,   fromDx: pendingSwap.fromDx, fromDy: pendingSwap.fromDy, playing: false, isReturn: false },
              { key: pendingSwap.fromKey, fromDx: dispDx,             fromDy: dispDy,             playing: false, isReturn: false, soft: true },
            ]);
            requestAnimationFrame(() => requestAnimationFrame(() =>
              setSnapAnims(prev => prev.map(a => ({ ...a, playing: true })))));
            setTimeout(() => setSnapAnims([]), 450);
            setPendingSwap(null);
          }}
          onCancel={() => {
            setSnapAnims([{ key: pendingSwap.fromKey, fromDx: pendingSwap.fromDx, fromDy: pendingSwap.fromDy, playing: false, isReturn: true }]);
            requestAnimationFrame(() => requestAnimationFrame(() =>
              setSnapAnims(prev => prev.map(a => ({ ...a, playing: true })))));
            setTimeout(() => setSnapAnims([]), 350);
            setPendingSwap(null);
          }}
        />
      )}
    </>
  );
}

// ── SwapConfirmModal ───────────────────────────────────────────────────────────
interface SwapConfirmModalProps {
  fromWidget: WidgetType;
  toWidget:   WidgetType;
  fromSpan:   GridSpan;
  toSpan:     GridSpan;
  onConfirm:  (dontShowAgain: boolean) => void;
  onCancel:   () => void;
}

function SwapConfirmModal({ fromWidget, toWidget, fromSpan, toSpan, onConfirm, onCancel }: SwapConfirmModalProps) {
  const [dontShow, setDontShow] = useState(false);
  const fromConfig = WIDGET_CONFIGS.find(w => w.id === fromWidget);
  const toConfig   = WIDGET_CONFIGS.find(w => w.id === toWidget);
  const spanLabel  = (s: GridSpan) => `${s.colSpan}×${s.rowSpan}`;

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex: 58, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', pointerEvents: 'auto' }}
    >
      <div
        className="flex flex-col rounded-2xl overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-modal)', width: 380, maxWidth: '90vw' }}
      >
        {/* Header */}
        <div className="px-5 py-3 flex items-center gap-3" style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 18 }}>⇄</span>
          <span className="font-mono text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)', letterSpacing: '0.13em' }}>
            Swap Widgets
          </span>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          <p className="text-sm" style={{ color: 'var(--text)', lineHeight: 1.6 }}>
            These widgets have different sizes. After swapping, each widget will occupy the other's zone and resize to fit.
          </p>

          {/* Widget preview rows */}
          <div className="flex flex-col gap-2">
            {[{ cfg: fromConfig, span: fromSpan, arrow: '→', targetSpan: toSpan },
              { cfg: toConfig,   span: toSpan,   arrow: '→', targetSpan: fromSpan }].map(({ cfg, span, arrow, targetSpan }, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: 'var(--row-bg)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 16 }}>{cfg?.icon}</span>
                <span className="text-sm font-medium flex-1" style={{ color: 'var(--text)' }}>{cfg?.label}</span>
                <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{spanLabel(span)}</span>
                <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>{arrow}</span>
                <span className="font-mono text-xs" style={{ color: 'rgba(251,191,36,0.9)' }}>{spanLabel(targetSpan)}</span>
              </div>
            ))}
          </div>

          {/* Don't show again */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none" style={{ color: 'var(--text-muted)' }}>
            <div
              onClick={() => setDontShow(v => !v)}
              style={{
                width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                border: `1.5px solid ${dontShow ? 'var(--teal)' : 'var(--border)'}`,
                background: dontShow ? 'var(--teal)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.15s, border-color 0.15s',
              }}
            >
              {dontShow && <span style={{ fontSize: 10, color: '#000', fontWeight: 700, lineHeight: 1 }}>✓</span>}
            </div>
            <span className="text-xs">Don't notify me for size-change swaps</span>
          </label>
        </div>

        {/* Buttons */}
        <div className="px-5 pb-5 flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="font-mono text-xs px-4 py-2 rounded-lg"
            style={{ background: 'var(--row-bg)', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'pointer' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)'; }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(dontShow)}
            className="font-mono text-xs px-4 py-2 rounded-lg"
            style={{ background: 'rgba(251,191,36,0.12)', color: 'rgba(251,191,36,0.95)', border: '1px solid rgba(251,191,36,0.25)', cursor: 'pointer' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(251,191,36,0.2)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(251,191,36,0.12)'; }}
          >
            Swap Anyway
          </button>
        </div>
      </div>
    </div>
  );
}
