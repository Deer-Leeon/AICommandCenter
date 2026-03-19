import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { ROWS, COLS, getCoveredCells } from './Grid';
import type { GridSpan, WidgetType, SearchBarConfig } from '../types';
import { DEFAULT_SEARCH_BAR_CONFIG } from '../types';

// ── Constants (must match Grid.tsx / WidgetCanvas.tsx) ────────────────────────
const PAD = 16;
const GAP = 10;
const HIT = 16;
const COMMIT = 0.25;
const DRAG_THRESHOLD = 10; // px movement to initiate zone drag (from anywhere in zone)
const BAR_H  = 54;
const BAR_MG = 8;

/** Returns which edge can be dragged based on where the pointer is within the zone.
 *  Vertical line at 20%–80% height splits left/right; diagonals from its endpoints to corners create top/bottom triangles. */
function getDragDirectionFromPoint(zone: ZoneInfo, clientX: number, clientY: number, containerRect: DOMRect): Dir {
  const relX = clientX - containerRect.left - zone.x;
  const relY = clientY - containerRect.top - zone.y;
  const w = zone.w;
  const h = zone.h;
  const cx = w / 2;
  const topY = h * 0.2;
  const bottomY = h * 0.8;
  const slope = (0.4 * h) / (w / 2); // (topY-0)/(cx-0) = 0.4h/(w/2)

  // Top triangle: vertices (0,0), (w,0), (cx, topY) — point must be above both diagonals (smaller y)
  if (relY < topY && relY <= slope * relX && relY <= slope * (w - relX)) return 'top';
  // Bottom triangle: vertices (0,h), (w,h), (cx, bottomY) — point must be below both diagonals (larger y)
  if (relY > bottomY && relY >= h - slope * relX && relY >= h - slope * (w - relX)) return 'bottom';
  // Middle strip: left or right
  return relX < cx ? 'left' : 'right';
}
const SNAP_EASING = 'cubic-bezier(0.34, 1.28, 0.64, 1)';
const SNAP_MS = 350;

// Static fallback (used only when no config is provided)
const NOTCH = 30;

function spansNotchCol(col: number, colSpan: number, notchCols: Set<number>): boolean {
  for (let c = col; c < col + colSpan; c++) if (notchCols.has(c)) return true;
  return false;
}

function applyNotch(
  row: number, col: number, colSpan: number, rowSpan: number,
  y: number, h: number,
  notchCols: Set<number>, notch: number,
) {
  if (spansNotchCol(col, colSpan, notchCols) && rowSpan === 1) {
    if (row === 0) return { y, h: h - notch };
    return { y: y + notch, h: h - notch };
  }
  return { y, h };
}

function cfgNotchCols(cfg: SearchBarConfig): Set<number> {
  return cfg.position === 'middle'
    ? new Set(Array.from({ length: cfg.colSpan }, (_, i) => cfg.colStart + i))
    : new Set<number>();
}

function cfgNotch(cfg: SearchBarConfig): number {
  return cfg.position === 'middle' ? NOTCH : 0;
}

function cfgTopPad(cfg: SearchBarConfig): number {
  return PAD + (cfg.position === 'top' ? BAR_H + BAR_MG : 0);
}

function cfgBottomPad(cfg: SearchBarConfig): number {
  return PAD + (cfg.position === 'bottom' ? BAR_H + BAR_MG : 0);
}

// ── Types ─────────────────────────────────────────────────────────────────────
// originX/Y = transform-origin pointing toward merged-zone center so cell springs outward
interface SplitCellInfo { idx: number; originX: string; originY: string; }
interface MergeFlashInfo { key: string; dir: Dir; scaleStart: number; triggered: boolean; }

interface ZoneInfo {
  key: string;
  row: number; col: number;
  rowSpan: number; colSpan: number;
  x: number; y: number; w: number; h: number;
  hasWidget: boolean;
}

type Dir = 'top' | 'right' | 'bottom' | 'left';

type MergeResult = { rowStart: number; colStart: number; rowSpan: number; colSpan: number };

interface DragState {
  zoneKey: string;
  dir: Dir;
  axis: 'x' | 'y';
  cellSize: number;       // cellW or cellH — used to compute current step from offset
  threshold: number;      // COMMIT * cellSize — minimum to commit any merge
  maxOffset: number;      // maxN * (cellSize + GAP)
  blocked: boolean;       // true if even step 1 is blocked
  maxN: number;           // max cells that can be merged (expand)
  mergeResults: MergeResult[]; // [0]=1-cell result, [1]=2-cell result, …
  contractResults: MergeResult[]; // [0]=shrink-by-1, [1]=shrink-by-2, …
  maxContractN: number;
  maxContractOffset: number;
  startPtr: number;
}

// ── Geometry ──────────────────────────────────────────────────────────────────
function cellMetrics(cw: number, ch: number, cfg: SearchBarConfig) {
  const topPad    = cfgTopPad(cfg);
  const bottomPad = cfgBottomPad(cfg);
  return {
    cellW:    (cw - 2 * PAD - GAP * (COLS - 1)) / COLS,
    cellH:    (ch - topPad - bottomPad - GAP * (ROWS - 1)) / ROWS,
    topPad,
    bottomPad,
  };
}
function cellX(col: number, cellW: number) { return PAD + col * (cellW + GAP); }
function cellY(row: number, cellH: number, topPad: number) { return topPad + row * (cellH + GAP); }

function computeZones(
  cw: number, ch: number,
  spans: Record<string, GridSpan>,
  grid: Record<string, WidgetType | null>,
  cfg: SearchBarConfig,
): ZoneInfo[] {
  const { cellW, cellH, topPad } = cellMetrics(cw, ch, cfg);
  const notchCols = cfgNotchCols(cfg);
  const notch     = cfgNotch(cfg);
  const covered = getCoveredCells(spans);
  const out: ZoneInfo[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const key = `${r},${c}`;
      if (covered.has(key)) continue;
      const sp = spans[key] ?? { rowSpan: 1, colSpan: 1 };
      const rawY = cellY(r, cellH, topPad);
      const rawH = sp.rowSpan * cellH + (sp.rowSpan - 1) * GAP;
      const { y, h } = applyNotch(r, c, sp.colSpan, sp.rowSpan, rawY, rawH, notchCols, notch);
      out.push({
        key, row: r, col: c,
        rowSpan: sp.rowSpan, colSpan: sp.colSpan,
        x: cellX(c, cellW), y,
        w: sp.colSpan * cellW + (sp.colSpan - 1) * GAP,
        h,
        hasWidget: !!grid[key],
      });
    }
  }
  return out;
}

function zoneRect(
  r: number, c: number, rs: number, cs: number,
  cellW: number, cellH: number,
  topPad: number, notchCols: Set<number>, notch: number,
) {
  const rawY = cellY(r, cellH, topPad);
  const rawH = rs * cellH + (rs - 1) * GAP;
  const { y, h } = applyNotch(r, c, cs, rs, rawY, rawH, notchCols, notch);
  return { x: cellX(c, cellW), y, w: cs * cellW + (cs - 1) * GAP, h };
}

// Find the top-left key of whatever span owns a covered cell
function findZoneOwner(k: string, spans: Record<string, GridSpan>): string | null {
  const [r, c] = k.split(',').map(Number);
  for (let row = 0; row <= r; row++) {
    for (let col = 0; col <= c; col++) {
      const ck = `${row},${col}`;
      const sp = spans[ck];
      if (sp && row + sp.rowSpan > r && col + sp.colSpan > c) return ck;
    }
  }
  return null;
}

// (spansNotchCol is already defined above — used here for the merge direction guard)

// ── Main component ────────────────────────────────────────────────────────────
// ── Multi-cell merge extent ────────────────────────────────────────────────
// Returns one MergeResult per step (step 0 = extend by 1 col/row, etc.).
// Stops at grid boundary or first cell containing a widget.
function getMaxMerge(
  zone: ZoneInfo,
  dir: Dir,
  spans: Record<string, GridSpan>,
  grid: Record<string, WidgetType | null>,
  notchCols: Set<number>,
): { results: MergeResult[]; blocked: boolean } {
  // Block vertical expansion that would bridge the search-bar notch gap.
  // Notch columns must never span from row 0 to row 1.
  if (spansNotchCol(zone.col, zone.colSpan, notchCols)) {
    if (dir === 'bottom' && zone.row === 0) return { results: [], blocked: true };
    if (dir === 'top'    && zone.row >= 1)  return { results: [], blocked: true };
  }

  const covered = getCoveredCells(spans);
  const results: MergeResult[] = [];

  function getSlice(n: number): { cells: string[]; result: MergeResult } | null {
    if (dir === 'right') {
      const tc = zone.col + zone.colSpan + n - 1;
      if (tc >= COLS) return null;
      return {
        cells: Array.from({ length: zone.rowSpan }, (_, i) => `${zone.row + i},${tc}`),
        result: { rowStart: zone.row, colStart: zone.col, rowSpan: zone.rowSpan, colSpan: zone.colSpan + n },
      };
    }
    if (dir === 'left') {
      const tc = zone.col - n;
      if (tc < 0) return null;
      return {
        cells: Array.from({ length: zone.rowSpan }, (_, i) => `${zone.row + i},${tc}`),
        result: { rowStart: zone.row, colStart: zone.col - n, rowSpan: zone.rowSpan, colSpan: zone.colSpan + n },
      };
    }
    if (dir === 'bottom') {
      const tr = zone.row + zone.rowSpan + n - 1;
      if (tr >= ROWS) return null;
      return {
        cells: Array.from({ length: zone.colSpan }, (_, i) => `${tr},${zone.col + i}`),
        result: { rowStart: zone.row, colStart: zone.col, rowSpan: zone.rowSpan + n, colSpan: zone.colSpan },
      };
    }
    // top
    const tr = zone.row - n;
    if (tr < 0) return null;
    return {
      cells: Array.from({ length: zone.colSpan }, (_, i) => `${tr},${zone.col + i}`),
      result: { rowStart: zone.row - n, colStart: zone.col, rowSpan: zone.rowSpan + n, colSpan: zone.colSpan },
    };
  }

  let firstBlocked = false;
  for (let n = 1; n <= Math.max(ROWS, COLS); n++) {
    const slice = getSlice(n);
    if (!slice) break;
    const hasWidget = slice.cells.some(k => {
      if (grid[k] != null) return true;
      if (covered.has(k)) {
        const owner = findZoneOwner(k, spans);
        return owner != null && grid[owner] != null;
      }
      return false;
    });
    if (hasWidget) { if (n === 1) firstBlocked = true; break; }
    results.push(slice.result);
  }

  return { results, blocked: firstBlocked };
}

// Returns contracted MergeResults by peeling cells from the given edge inward.
function getContractResults(zone: ZoneInfo, dir: Dir): MergeResult[] {
  const results: MergeResult[] = [];
  if (dir === 'right') {
    for (let n = 1; n < zone.colSpan; n++)
      results.push({ rowStart: zone.row, colStart: zone.col, rowSpan: zone.rowSpan, colSpan: zone.colSpan - n });
  } else if (dir === 'left') {
    for (let n = 1; n < zone.colSpan; n++)
      results.push({ rowStart: zone.row, colStart: zone.col + n, rowSpan: zone.rowSpan, colSpan: zone.colSpan - n });
  } else if (dir === 'bottom') {
    for (let n = 1; n < zone.rowSpan; n++)
      results.push({ rowStart: zone.row, colStart: zone.col, rowSpan: zone.rowSpan - n, colSpan: zone.colSpan });
  } else {
    for (let n = 1; n < zone.rowSpan; n++)
      results.push({ rowStart: zone.row + n, colStart: zone.col, rowSpan: zone.rowSpan - n, colSpan: zone.colSpan });
  }
  return results;
}

export function GridLayoutMode({ onClose }: { onClose: () => void }) {
  const { gridSpans, grid, splitZone, resizeZone, searchBarConfig } = useStore();
  const cfg = searchBarConfig ?? DEFAULT_SEARCH_BAR_CONFIG;
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const [hoveredDir, setHoveredDir] = useState<Dir | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [snapping, setSnapping] = useState(false);
  const [shaking, setShaking] = useState<string | null>(null);
  const [mergeFlash, setMergeFlash] = useState<MergeFlashInfo | null>(null);
  const [splitCells, setSplitCells] = useState<Map<string, SplitCellInfo>>(new Map());
  const [exitZoneKey, setExitZoneKey] = useState<string | null>(null);
  const [pendingDrag, setPendingDrag] = useState<{ zoneKey: string; startX: number; startY: number } | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const offsetRef = useRef(0);
  const gridSpansRef = useRef(gridSpans);
  useEffect(() => { gridSpansRef.current = gridSpans; }, [gridSpans]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setContainerSize({ w: el.offsetWidth, h: el.offsetHeight }));
    obs.observe(el);
    setContainerSize({ w: el.offsetWidth, h: el.offsetHeight });
    return () => obs.disconnect();
  }, []);

  const { w: cw, h: ch } = containerSize;
  const zones = cw > 0 ? computeZones(cw, ch, gridSpans, grid, cfg) : [];
  const { cellW, cellH, topPad } = cw > 0 ? cellMetrics(cw, ch, cfg) : { cellW: 0, cellH: 0, topPad: PAD };
  const notchCols = cfgNotchCols(cfg);
  const notch     = cfgNotch(cfg);

  // ── Double-click to split ──────────────────────────────────────────────────
  const handleZoneDblClick = useCallback((zone: ZoneInfo) => {
    if (zone.hasWidget) return;
    if (zone.rowSpan === 1 && zone.colSpan === 1) return;

    // Compute each new cell's distance from merged-zone center (for slide-from-center)
    const cellMap = new Map<string, SplitCellInfo>();
    let idx = 0;
    const hR = zone.rowSpan / 2;
    const hC = zone.colSpan / 2;
    for (let r = 0; r < zone.rowSpan; r++) {
      for (let c = 0; c < zone.colSpan; c++) {
        // transform-origin points inward toward merged center → cell springs outward
        const originX = zone.colSpan === 1 ? '50%' : (c < hC ? '100%' : '0%');
        const originY = zone.rowSpan === 1 ? '50%' : (r < hR ? '100%' : '0%');
        cellMap.set(`${zone.row + r},${zone.col + c}`, { idx: idx++, originX, originY });
      }
    }

    // Pre-populate so cells have animation data on their very first render
    setSplitCells(cellMap);

    // Clear any lingering hover state so handle bars don't stay lit after the split
    setHoveredHandle(null);
    setHoveredZone(null);

    // Phase 1: exit-shrink the merged zone (110ms)
    setExitZoneKey(zone.key);

    // Phase 2: split — cells appear with CSS animation already running from frame 0
    setTimeout(() => {
      setExitZoneKey(null);
      splitZone(zone.key);
      setTimeout(() => setSplitCells(new Map()), 650);
    }, 110);
  }, [splitZone]);

  // Build DragState for a zone + direction (used by both handle and zone-level drag)
  const buildDragState = useCallback((zone: ZoneInfo, dir: Dir, startPtr: number): DragState => {
    const { results, blocked } = getMaxMerge(zone, dir, gridSpans, grid, notchCols);
    const contractResults = getContractResults(zone, dir);
    const isH = dir === 'left' || dir === 'right';
    const cs = isH ? cellW : cellH;
    const maxN = results.length;
    const maxContractN = contractResults.length;
    return {
      zoneKey: zone.key, dir,
      axis: isH ? 'x' : 'y',
      cellSize: cs,
      threshold: COMMIT * cs,
      maxOffset: maxN > 0 ? maxN * (cs + GAP) : cs + GAP,
      blocked,
      maxN,
      mergeResults: results,
      contractResults,
      maxContractN,
      maxContractOffset: maxContractN > 0 ? maxContractN * (cs + GAP) : 0,
      startPtr,
    };
  }, [gridSpans, grid, cellW, cellH, notchCols]);

  // ── Zone-level pointer down: grab anywhere in zone, drag initiates on movement ─
  const handleZonePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, zone: ZoneInfo) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPendingDrag({ zoneKey: zone.key, startX: e.clientX, startY: e.clientY });
  }, []);

  // ── Merge drag (from handle or from zone after threshold) ────────────────────
  const onHandlePointerDown = useCallback((
    e: React.PointerEvent<HTMLDivElement>,
    handleId: string,
    ds: DragState
  ) => {
    e.stopPropagation();
    if (ds.blocked && ds.maxContractN === 0) {
      setShaking(handleId);
      setTimeout(() => setShaking(null), 420);
      return;
    }
    setPendingDrag(null);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = ds;
    offsetRef.current = 0;
    setDragState(ds);
    setDragOffset(0);
    setSnapping(false);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Pending zone drag: check if we've moved enough, then use start position to pick region
    if (pendingDrag && !dragRef.current) {
      const dx = e.clientX - pendingDrag.startX;
      const dy = e.clientY - pendingDrag.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= DRAG_THRESHOLD) {
        const zone = zones.find(z => z.key === pendingDrag.zoneKey);
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (zone && containerRect) {
          const dir = getDragDirectionFromPoint(zone, pendingDrag.startX, pendingDrag.startY, containerRect);
          const isH = dir === 'left' || dir === 'right';
          const ds = buildDragState(zone, dir, isH ? e.clientX : e.clientY);
          if (ds.blocked && ds.maxContractN === 0) {
            setShaking(`merge-${dir}-${zone.key}`);
            setTimeout(() => setShaking(null), 420);
          } else {
            dragRef.current = ds;
            offsetRef.current = 0;
            setDragState(ds);
            setDragOffset(0);
            setSnapping(false);
          }
        }
        setPendingDrag(null);
      }
      return;
    }

    const ds = dragRef.current;
    if (!ds) return;
    const raw = ds.axis === 'x' ? e.clientX - ds.startPtr : e.clientY - ds.startPtr;
    // 'left'/'top' drags move in the negative direction — flip so expand = positive
    const directed = (ds.dir === 'left' || ds.dir === 'top') ? -raw : raw;
    // Allow negative offset for contracting (dragging in the opposite direction)
    const clamped = Math.max(-ds.maxContractOffset, Math.min(directed, ds.maxOffset));
    offsetRef.current = clamped;
    setDragOffset(clamped);
  }, [pendingDrag, zones, buildDragState]);

  const onPointerUp = useCallback(() => {
    if (pendingDrag && !dragRef.current) {
      setPendingDrag(null);
      return;
    }
    const ds = dragRef.current;
    if (!ds) return;
    dragRef.current = null;
    const offset = offsetRef.current;

    const isExpandCommit   = offset >= ds.threshold && !ds.blocked && ds.maxN > 0;
    const isContractCommit = offset <= -ds.threshold && ds.maxContractN > 0;

    if (isExpandCommit) {
      // Each step starts 25% (threshold) past the previous cell boundary for consistency.
      const step = Math.max(0, Math.min(Math.floor((offset - ds.threshold) / (ds.cellSize + GAP)), ds.maxN - 1));
      const { rowStart, colStart, rowSpan, colSpan } = ds.mergeResults[step];
      const newKey = `${rowStart},${colStart}`;
      const isX = ds.dir === 'left' || ds.dir === 'right';
      const orig = gridSpansRef.current[ds.zoneKey] ?? { rowSpan: 1, colSpan: 1 };
      const scaleStart = isX ? orig.colSpan / colSpan : orig.rowSpan / rowSpan;

      setMergeFlash({ key: newKey, dir: ds.dir, scaleStart, triggered: false });
      resizeZone(ds.zoneKey, rowStart, colStart, rowSpan, colSpan);
      setDragState(null);
      setDragOffset(0);

      requestAnimationFrame(() => requestAnimationFrame(() => {
        setMergeFlash(prev => prev ? { ...prev, triggered: true } : null);
      }));
      setTimeout(() => setMergeFlash(null), 600);

    } else if (isContractCommit) {
      const step = Math.max(0, Math.min(Math.floor((-offset - ds.threshold) / (ds.cellSize + GAP)), ds.maxContractN - 1));
      const { rowStart, colStart, rowSpan, colSpan } = ds.contractResults[step];
      const newKey = `${rowStart},${colStart}`;
      const isX = ds.dir === 'left' || ds.dir === 'right';
      const orig = gridSpansRef.current[ds.zoneKey] ?? { rowSpan: 1, colSpan: 1 };
      // Contract animation: start at current size then shrink to contracted size
      const scaleStart = isX ? orig.colSpan / colSpan : orig.rowSpan / rowSpan;

      setMergeFlash({ key: newKey, dir: ds.dir, scaleStart, triggered: false });
      resizeZone(ds.zoneKey, rowStart, colStart, rowSpan, colSpan);
      setDragState(null);
      setDragOffset(0);

      requestAnimationFrame(() => requestAnimationFrame(() => {
        setMergeFlash(prev => prev ? { ...prev, triggered: true } : null);
      }));
      setTimeout(() => setMergeFlash(null), 600);

    } else {
      setSnapping(true);
      setDragOffset(0);
      setTimeout(() => { setSnapping(false); setDragState(null); }, SNAP_MS + 50);
    }
  }, [resizeZone, pendingDrag]);

  // ── Handle rendering ──────────────────────────────────────────────────────
  function renderMergeHandles(zone: ZoneInfo) {
    // Occupied zones can expand into adjacent free cells; merged zones can shrink.
    const dirs: Dir[] = ['top', 'right', 'bottom', 'left'];
    return dirs.map(dir => {
      const { results, blocked } = getMaxMerge(zone, dir, gridSpans, grid, notchCols);
      const contractResults = getContractResults(zone, dir);
      const maxN = results.length;
      const maxContractN = contractResults.length;

      // Only skip the handle if there's nothing to do at all (no expand, no contract, not blocked)
      if (maxN === 0 && !blocked && maxContractN === 0) return null;

      const isH = dir === 'left' || dir === 'right';
      const cs = isH ? cellW : cellH;
      const handleId = `merge-${dir}-${zone.key}`;
      const isHovered = hoveredHandle === handleId;
      const isDragging = dragState?.zoneKey === zone.key && dragState?.dir === dir;
      const isShaking = shaking === handleId;

      const inset = 16;
      let hx = 0, hy = 0, hw = 0, hh = 0;
      if (dir === 'right')  { hx = zone.x + zone.w - HIT / 2; hy = zone.y + inset; hw = HIT; hh = zone.h - inset * 2; }
      if (dir === 'left')   { hx = zone.x - HIT / 2;           hy = zone.y + inset; hw = HIT; hh = zone.h - inset * 2; }
      if (dir === 'bottom') { hx = zone.x + inset; hy = zone.y + zone.h - HIT / 2; hw = zone.w - inset * 2; hh = HIT; }
      if (dir === 'top')    { hx = zone.x + inset; hy = zone.y - HIT / 2;           hw = zone.w - inset * 2; hh = HIT; }

      const maxContractOffset = maxContractN > 0 ? maxContractN * (cs + GAP) : 0;
      const dragForHandle: DragState = {
        zoneKey: zone.key, dir,
        axis: isH ? 'x' : 'y',
        cellSize: cs,
        threshold: COMMIT * cs,
        maxOffset: maxN > 0 ? maxN * (cs + GAP) : cs + GAP,
        blocked,
        maxN,
        mergeResults: results,
        contractResults,
        maxContractN,
        maxContractOffset,
        startPtr: 0,
      };

      // Determine visual state: contracting (purple), expanding (teal), blocked (red)
      const isContracting = isDragging && dragState && dragOffset < 0;
      const isExpanding   = isDragging && dragState && dragOffset > 0;
      const pastThreshold = isDragging && dragState
        ? (isContracting ? -dragOffset >= dragState.threshold : dragOffset >= dragState.threshold)
        : false;

      // Teal   → can expand in this direction (free adjacent cell)
      // Orange → can only contract (adjacent is occupied/edge, but zone is merged)
      // Red    → truly nothing (expansion blocked, can't contract either)
      // Active drag overrides idle color.
      const canExpand   = maxN > 0;
      const canContract = maxContractN > 0;
      const lineColor = isContracting && pastThreshold ? '#f97316'
        : isExpanding && pastThreshold               ? '#3de8b0'
        : canExpand                                  ? 'rgba(61,232,176,0.7)'
        : canContract                                ? 'rgba(249,115,22,0.7)'
        : 'rgba(239,68,68,0.8)';
      const glow = canExpand
        ? '0 0 8px rgba(61,232,176,0.6)'
        : canContract
        ? '0 0 8px rgba(249,115,22,0.6)'
        : '0 0 6px rgba(239,68,68,0.5)';

      // Handle translation: positive = expand direction, negative = contract direction
      const translateStyle = isDragging
        ? (dir === 'right' ? `translateX(${dragOffset}px)`
          : dir === 'left'  ? `translateX(${-dragOffset}px)`
          : dir === 'bottom' ? `translateY(${dragOffset}px)`
          : `translateY(${-dragOffset}px)`)
        : 'none';

      return (
        <div
          key={handleId}
          onPointerDown={(e) => onHandlePointerDown(e, handleId, { ...dragForHandle, startPtr: isH ? e.clientX : e.clientY })}
          onMouseEnter={() => setHoveredHandle(handleId)}
          onMouseLeave={() => setHoveredHandle(null)}
          style={{
            position: 'absolute',
            left: hx, top: hy, width: hw, height: hh,
            pointerEvents: 'none',
            cursor: (() => {
              if (blocked && !canContract) return 'not-allowed';
              // Only contraction available → inward-pointing arrow
              if (canContract && maxN === 0 && !blocked) {
                if (dir === 'right')  return 'w-resize';
                if (dir === 'left')   return 'e-resize';
                if (dir === 'bottom') return 'n-resize';
                return 's-resize'; // top
              }
              // Only expansion available → outward-pointing arrow
              if (!canContract && maxN > 0) {
                if (dir === 'right')  return 'e-resize';
                if (dir === 'left')   return 'w-resize';
                if (dir === 'bottom') return 's-resize';
                return 'n-resize'; // top
              }
              // Both directions available → bidirectional
              return isH ? 'ew-resize' : 'ns-resize';
            })(),
            zIndex: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transform: translateStyle,
            transition: snapping && isDragging ? `transform ${SNAP_MS}ms ${SNAP_EASING}` : 'none',
            animation: isShaking ? 'nexusShake 0.42s ease' : 'none',
          }}
        >
          <div style={{
            background: lineColor,
            borderRadius: 4,
            width: isH ? 3 : '75%',
            height: isH ? '75%' : 3,
            opacity: (isHovered || isDragging) ? 1 : (hoveredZone === zone.key ? 0.35 : 0),
            transition: 'opacity 0.12s, background 0.12s',
            boxShadow: (isHovered || isDragging) ? glow : 'none',
            pointerEvents: 'none',
          }} />
        </div>
      );
    });
  }

  // ── Preview rect — grows/shrinks cell-by-cell as drag offset changes ──────
  const preview = (() => {
    if (!dragState) return null;
    const cs = dragState.cellSize;

    if (dragOffset >= dragState.threshold && !dragState.blocked && dragState.maxN > 0) {
      const step = Math.max(0, Math.min(Math.floor((dragOffset - dragState.threshold) / (cs + GAP)), dragState.maxN - 1));
      const r = dragState.mergeResults[step];
      return r ? { rect: zoneRect(r.rowStart, r.colStart, r.rowSpan, r.colSpan, cellW, cellH, topPad, notchCols, notch), isContract: false } : null;
    }
    if (dragOffset <= -dragState.threshold && dragState.maxContractN > 0) {
      const step = Math.max(0, Math.min(Math.floor((-dragOffset - dragState.threshold) / (cs + GAP)), dragState.maxContractN - 1));
      const r = dragState.contractResults[step];
      return r ? { rect: zoneRect(r.rowStart, r.colStart, r.rowSpan, r.colSpan, cellW, cellH, topPad, notchCols, notch), isContract: true } : null;
    }
    return null;
  })();

  return (
    <>
      <style>{`
        @keyframes nexusShake {
          0%,100% { transform: translateX(0); }
          20% { transform: translateX(-5px); }
          50% { transform: translateX(5px); }
          75% { transform: translateX(-3px); }
        }
        @keyframes nexusLayoutFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes nexusSplitExit {
          0%   { transform: scale(1);    opacity: 1; }
          100% { transform: scale(0.86); opacity: 0; }
        }
        @keyframes nexusSplitCell {
          0%   { transform: scale(0.88); }
          100% { transform: scale(1); }
        }
      `}</style>

      <div
        ref={containerRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          position: 'absolute', inset: 0, zIndex: 56,
          background: 'rgba(0,0,0,0.08)',
          cursor: dragState ? 'grabbing' : 'default',
          userSelect: 'none',
          animation: 'nexusLayoutFadeIn 0.28s ease both',
        }}
      >
        {/* Zone overlays */}
        {zones.map(zone => {
          const isMerged = zone.rowSpan > 1 || zone.colSpan > 1;
          const isHovered = hoveredZone === zone.key;
          const canSplit = isMerged && !zone.hasWidget;
          const isMergeFlash = mergeFlash?.key === zone.key;
          const splitInfo = splitCells.get(zone.key);
          // Only animate freshly-split 1×1 cells, not the merging zone or exiting zone
          const isSplitAnim = splitInfo !== undefined && !isMerged;
          const isExiting = exitZoneKey === zone.key;

          // ── Directional merge transform (CSS transition approach) ───────────
          const mDir = mergeFlash?.dir;
          const isXMerge = mDir === 'left' || mDir === 'right';
          const mergeTransform = isMergeFlash && !mergeFlash!.triggered
            ? (isXMerge ? `scaleX(${mergeFlash!.scaleStart})` : `scaleY(${mergeFlash!.scaleStart})`)
            : undefined;
          const mergeOrigin = isMergeFlash
            ? (mDir === 'right' ? 'left center'
              : mDir === 'left' ? 'right center'
              : mDir === 'bottom' ? 'top center'
              : 'bottom center')
            : '50% 50%';
          const mergeTransition = isMergeFlash
            ? (mergeFlash!.triggered
              ? `transform 460ms ${SNAP_EASING}, box-shadow 460ms ease`
              : 'none')
            : 'border-color 0.18s ease, box-shadow 0.18s ease, background 0.2s, backdrop-filter 0.28s ease';

          // ── Animation: exit or split-pop (CSS keyframe, starts on first render) ─
          const animation = isExiting
            ? 'nexusSplitExit 110ms ease-in both'
            : isSplitAnim
            ? `nexusSplitCell 450ms ${SNAP_EASING} ${splitInfo!.idx * 22}ms both`
            : undefined;

          // Per-edge border colors when hovered: teal=expand, orange=contract, red=blocked
          // fillColor is same hue, less intense for region background
          const dirs: Dir[] = ['top', 'right', 'bottom', 'left'];
          const edgeData = dirs.map(dir => {
            const { results, blocked } = getMaxMerge(zone, dir, gridSpans, grid, notchCols);
            const contractResults = getContractResults(zone, dir);
            const canExpand = results.length > 0;
            const canContract = contractResults.length > 0;
            if (canExpand && !blocked) return { border: 'rgba(61,232,176,0.85)',  fill: 'rgba(61,232,176,0.18)'  };
            if (canContract)           return { border: 'rgba(249,115,22,0.75)', fill: 'rgba(249,115,22,0.22)'  };
            if (blocked && !canContract) return { border: 'rgba(239,68,68,0.7)', fill: 'rgba(239,68,68,0.2)'   };
            return { border: 'transparent', fill: 'transparent' };
          });
          const [top, right, bottom, left] = edgeData;
          const topColor = top.border;
          const rightColor = right.border;
          const bottomColor = bottom.border;
          const leftColor = left.border;
          const showEdgeGlow = isHovered && (topColor || rightColor || bottomColor || leftColor);

          return (
            <div
              key={zone.key}
              onMouseEnter={() => setHoveredZone(zone.key)}
              onMouseLeave={() => { setHoveredZone(null); setHoveredDir(null); }}
              onMouseMove={(e) => {
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (!containerRect) return;
                setHoveredDir(getDragDirectionFromPoint(zone, e.clientX, e.clientY, containerRect));
              }}
              onPointerDown={(e) => handleZonePointerDown(e, zone)}
              onDoubleClick={() => handleZoneDblClick(zone)}
              style={{
                position: 'absolute',
                left: zone.x, top: zone.y, width: zone.w, height: zone.h,
                borderRadius: 10,
                borderTop:    `2px solid ${showEdgeGlow ? topColor    : (zone.hasWidget ? 'rgba(255,255,255,0.15)' : isMerged ? 'rgba(167,139,250,0.25)' : 'rgba(255,255,255,0.1)')}`,
                borderRight:  `2px solid ${showEdgeGlow ? rightColor  : (zone.hasWidget ? 'rgba(255,255,255,0.15)' : isMerged ? 'rgba(167,139,250,0.25)' : 'rgba(255,255,255,0.1)')}`,
                borderBottom: `2px solid ${showEdgeGlow ? bottomColor : (zone.hasWidget ? 'rgba(255,255,255,0.15)' : isMerged ? 'rgba(167,139,250,0.25)' : 'rgba(255,255,255,0.1)')}`,
                borderLeft:   `2px solid ${showEdgeGlow ? leftColor   : (zone.hasWidget ? 'rgba(255,255,255,0.15)' : isMerged ? 'rgba(167,139,250,0.25)' : 'rgba(255,255,255,0.1)')}`,
                background: zone.hasWidget ? 'color-mix(in srgb, var(--surface) 80%, transparent)'
                  : isHovered && canSplit ? 'color-mix(in srgb, var(--bg) 85%, rgba(167,139,250,0.3))'
                  : isHovered ? 'color-mix(in srgb, var(--bg) 90%, rgba(61,232,176,0.2))'
                  : 'var(--bg)',
                backdropFilter: zone.hasWidget ? 'blur(6px)' : 'none',
                WebkitBackdropFilter: zone.hasWidget ? 'blur(6px)' : 'none',
                cursor: canSplit ? 'pointer' : (showEdgeGlow ? 'grab' : 'default'),
                boxSizing: 'border-box',
                transform: mergeTransform,
                boxShadow: isMergeFlash && !mergeFlash!.triggered
                  ? '0 0 0 2px rgba(61,232,176,0.65), 0 0 14px rgba(61,232,176,0.3)'
                  : showEdgeGlow
                  ? '0 0 20px rgba(61,232,176,0.15), inset 0 0 20px rgba(61,232,176,0.03)'
                  : undefined,
                transition: mergeTransition,
                zIndex: isSplitAnim ? 8 : undefined,
                animation,
                transformOrigin: isSplitAnim
                  ? `${splitInfo!.originX} ${splitInfo!.originY}`
                  : mergeOrigin,
              }}
            >
              {/* Region fills + guide lines: 5 solid lines, each region tinted by its edge color */}
              {showEdgeGlow && (() => {
                const w = zone.w;
                const h = zone.h;
                const cx = w / 2;
                const topY = h * 0.2;
                const bottomY = h * 0.8;
                return (
                  <svg
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
                    viewBox={`0 0 ${w} ${h}`}
                    preserveAspectRatio="none"
                  >
                    {/* Only the region under the cursor is filled */}
                    {hoveredDir === 'top'    && top.fill    !== 'transparent' && <polygon points={`0,0 ${w},0 ${cx},${topY}`}                           fill={top.fill} />}
                    {hoveredDir === 'bottom' && bottom.fill !== 'transparent' && <polygon points={`0,${h} ${w},${h} ${cx},${bottomY}`}                  fill={bottom.fill} />}
                    {hoveredDir === 'left'   && left.fill   !== 'transparent' && <polygon points={`0,0 ${cx},${topY} ${cx},${bottomY} 0,${h}`}          fill={left.fill} />}
                    {hoveredDir === 'right'  && right.fill  !== 'transparent' && <polygon points={`${w},0 ${cx},${topY} ${cx},${bottomY} ${w},${h}`}    fill={right.fill} />}
                    {/* Solid lines — no dashes */}
                    <line x1={cx} y1={topY} x2={cx} y2={bottomY} stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1={cx} y1={topY} x2={0} y2={0} stroke="rgba(255,255,255,0.28)" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1={cx} y1={topY} x2={w} y2={0} stroke="rgba(255,255,255,0.28)" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1={cx} y1={bottomY} x2={0} y2={h} stroke="rgba(255,255,255,0.28)" strokeWidth="1.5" strokeLinecap="round" />
                    <line x1={cx} y1={bottomY} x2={w} y2={h} stroke="rgba(255,255,255,0.28)" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                );
              })()}
              {/* Split hint for merged zones */}
              {isMerged && !zone.hasWidget && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'none',
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                    color: isHovered ? 'rgba(167,139,250,1)' : 'rgba(167,139,250,0.7)',
                    letterSpacing: '0.04em',
                    transition: 'all 0.12s',
                    background: isHovered ? 'rgba(167,139,250,0.12)' : 'rgba(167,139,250,0.07)',
                    border: `1px solid ${isHovered ? 'rgba(167,139,250,0.35)' : 'rgba(167,139,250,0.2)'}`,
                    borderRadius: 6, padding: '4px 10px',
                  }}>
                    ✂ double-click to split
                  </span>
                </div>
              )}
              {/* Occupied label */}
              {zone.hasWidget && (
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'none',
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.12em',
                    background: 'var(--surface2)',
                    border: '1px solid var(--border)',
                    borderRadius: 5, padding: '3px 8px',
                  }}>occupied</span>
                </div>
              )}
            </div>
          );
        })}

        {/* Merge handles */}
        {zones.map(zone => (
          <div key={`handles-${zone.key}`}>{renderMergeHandles(zone)}</div>
        ))}

        {/* Merge/contract preview */}
        {preview && (
          <div style={{
            position: 'absolute',
            left: preview.rect.x, top: preview.rect.y, width: preview.rect.w, height: preview.rect.h,
            background: preview.isContract ? 'rgba(249,115,22,0.1)' : 'rgba(61,232,176,0.1)',
            border: `2px solid ${preview.isContract ? 'rgba(249,115,22,0.5)' : 'rgba(61,232,176,0.5)'}`,
            borderRadius: 10,
            pointerEvents: 'none',
            zIndex: 8,
          }} />
        )}

        {/* Search bar indicator — shows its current position in the layout */}
        {cw > 0 && (() => {
          const left  = PAD + cfg.colStart * (cellW + GAP);
          const width = cfg.colSpan * cellW + (cfg.colSpan - 1) * GAP;

          let top: number;
          if (cfg.position === 'top') {
            top = PAD;
          } else if (cfg.position === 'bottom') {
            top = ch - cfgBottomPad(cfg) - BAR_H;
          } else {
            const centerY = topPad + cellH + GAP / 2;
            top = centerY - BAR_H / 2;
          }

          return (
            <div style={{
              position: 'absolute', left, top, width, height: BAR_H,
              background: 'rgba(var(--accent-rgb),0.07)',
              border: '1.5px dashed rgba(var(--accent-rgb),0.4)',
              borderRadius: 9999,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
              color: 'var(--accent)', letterSpacing: '0.1em', textTransform: 'uppercase',
              pointerEvents: 'none', zIndex: 60,
            }}>
              ⌕ Search Bar
            </div>
          );
        })()}

      </div>
    </>
  );
}
