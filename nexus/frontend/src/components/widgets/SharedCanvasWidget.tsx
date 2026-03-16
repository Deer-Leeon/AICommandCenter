/**
 * SharedCanvasWidget — real-time collaborative drawing canvas between two friends.
 *
 * Architecture:
 *   mainCanvas   — permanent surface: loaded snapshot + all completed strokes
 *   overlayCanvas — ephemeral layer: your in-progress stroke + partner's live strokes
 *
 * All points are stored as percentages (0.0–1.0) of canvas dimensions so strokes
 * are resolution-independent across different widget sizes.
 *
 * Real-time flow:
 *   Drawing  → POST /api/shared-canvas/:id/stroke (throttled ~40fps)
 *   Complete → final stroke POST → 2s debounce → POST /snapshot
 *   Receive  → useSharedChannel → canvas:stroke / canvas:cleared / canvas:snapshot_saved
 */
import {
  useState, useEffect, useRef, useCallback, useMemo,
  type PointerEvent as RPointerEvent,
} from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useConnections } from '../../hooks/useConnections';
import { useSharedChannel } from '../../hooks/useSharedChannel';
import { apiFetch, apiFetchMultipart } from '../../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tool       = 'brush' | 'eraser' | 'fill';
type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved';
type LayoutMode = 'micro' | 'slim' | 'standard' | 'expanded';

interface StrokePayload {
  strokeId:   string;
  userId:     string;
  tool:       Tool;
  color:      string;
  size:       number;
  points:     [number, number][];
  isComplete: boolean;
}

interface ActiveStroke {
  strokeId: string;
  tool:     Tool;
  color:    string;
  size:     number;
  points:   [number, number][];
}

interface Props {
  connectionId: string;
  slotKey:      string;
  onClose:      () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PALETTE: string[] = [
  '#000000', '#FFFFFF', '#EF4444', '#F97316',
  '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#6B7280',
];

const BRUSH_SIZES = [4, 8, 16, 32] as const;
const MAX_UNDO     = 20;
const BROADCAST_THROTTLE_MS = 25;  // ~40 fps — smooth but server-friendly
const SAVE_DEBOUNCE_MS      = 2000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLayoutMode(w: number, h: number): LayoutMode {
  if (w < 200 && h < 200) return 'micro';
  if (w < 280 || h < 280) return 'slim';
  if (w >= 400 && h >= 400) return 'expanded';
  return 'standard';
}

function uid(): string {
  return Math.random().toString(36).slice(2, 12);
}

function drawStrokeOnCtx(
  ctx: CanvasRenderingContext2D,
  stroke: Pick<ActiveStroke, 'tool' | 'color' | 'size' | 'points'>,
  w: number,
  h: number,
) {
  const { tool, color, size, points } = stroke;
  if (points.length === 0 || w === 0 || h === 0) return;

  ctx.save();
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size;

  const drawColor = tool === 'eraser' ? '#FFFFFF' : color;
  ctx.strokeStyle = drawColor;
  ctx.fillStyle   = drawColor;

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0][0] * w, points[0][1] * h, size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0][0] * w, points[0][1] * h);
    for (let i = 1; i < points.length - 1; i++) {
      const midX = ((points[i][0] + points[i + 1][0]) / 2) * w;
      const midY = ((points[i][1] + points[i + 1][1]) / 2) * h;
      ctx.quadraticCurveTo(
        points[i][0] * w, points[i][1] * h,
        midX, midY,
      );
    }
    const last = points[points.length - 1];
    ctx.lineTo(last[0] * w, last[1] * h);
    ctx.stroke();
  }

  ctx.restore();
}

function floodFill(canvas: HTMLCanvasElement, startX: number, startY: number, hex: string) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const fr = parseInt(hex.slice(1, 3), 16);
  const fg = parseInt(hex.slice(3, 5), 16);
  const fb = parseInt(hex.slice(5, 7), 16);

  const sx = Math.round(startX), sy = Math.round(startY);
  if (sx < 0 || sx >= width || sy < 0 || sy >= height) return;

  const idx0 = (sy * width + sx) * 4;
  const tr = data[idx0], tg = data[idx0 + 1], tb = data[idx0 + 2];

  if (tr === fr && tg === fg && tb === fb) return;

  const stack: number[] = [sy * width + sx];
  const visited = new Uint8Array(width * height);

  while (stack.length) {
    const pos = stack.pop()!;
    if (visited[pos]) continue;
    visited[pos] = 1;
    const idx = pos * 4;
    if (data[idx] !== tr || data[idx + 1] !== tg || data[idx + 2] !== tb) continue;
    data[idx] = fr; data[idx + 1] = fg; data[idx + 2] = fb; data[idx + 3] = 255;
    const x = pos % width, y = Math.floor(pos / width);
    if (x > 0)          stack.push(pos - 1);
    if (x < width - 1)  stack.push(pos + 1);
    if (y > 0)          stack.push(pos - width);
    if (y < height - 1) stack.push(pos + width);
  }

  ctx.putImageData(imageData, 0, 0);
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const STYLES = `
@keyframes sc-toolbar-in {
  from { opacity:0; transform:scaleY(0) translateY(4px); }
  to   { opacity:1; transform:scaleY(1) translateY(0); }
}
@keyframes sc-pulse-dot { 0%,100%{opacity:1} 50%{opacity:0.3} }
@keyframes sc-toast {
  0%{opacity:0;transform:translateY(-6px) translateX(-50%)}
  15%,80%{opacity:1;transform:translateY(0) translateX(-50%)}
  100%{opacity:0;transform:translateY(-6px) translateX(-50%)}
}

.sc-widget {
  position:relative; width:100%; height:100%;
  overflow:hidden; border-radius:inherit;
  user-select:none; -webkit-user-select:none;
}
.sc-canvas-layer {
  position:absolute; inset:0;
  touch-action:none;
}
.sc-toolbar-wrap {
  position:absolute; bottom:10px; left:50%;
  transform:translateX(-50%);
  display:flex; flex-direction:column; align-items:center; gap:8px;
  z-index:20; pointer-events:none;
}
.sc-toolbar-wrap.side {
  bottom:auto; left:auto; right:10px; top:50%;
  transform:translateY(-50%);
  flex-direction:row-reverse; align-items:flex-start;
}
.sc-pill {
  display:flex; align-items:center; gap:8px;
  padding:0 14px; height:40px;
  background:var(--surface2); border:1px solid var(--border);
  border-radius:20px;
  box-shadow:0 4px 24px rgba(0,0,0,0.4);
  backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
  pointer-events:auto; cursor:default; flex-shrink:0;
  transition:height 0.15s;
}
.sc-pill.micro { height:32px; padding:0 10px; gap:6px; }
.sc-expanded {
  background:var(--surface2); border:1px solid var(--border);
  border-radius:14px; padding:12px;
  box-shadow:0 4px 24px rgba(0,0,0,0.4);
  backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
  pointer-events:auto;
  display:flex; flex-direction:column; gap:10px;
  animation:sc-toolbar-in 0.22s cubic-bezier(0.34,1.56,0.64,1) both;
  transform-origin:bottom center;
  min-width:200px;
}
.sc-expanded.side { transform-origin:right center; }
.sc-color-grid {
  display:grid; grid-template-columns:repeat(4,1fr); gap:4px;
}
.sc-swatch {
  width:24px; height:24px; border-radius:5px;
  border:2px solid transparent; cursor:pointer;
  transition:transform 0.1s,border-color 0.1s; flex-shrink:0;
}
.sc-swatch:hover { transform:scale(1.15); }
.sc-swatch.active { border-color:#fff; }
.sc-swatch.rainbow {
  background:conic-gradient(red,orange,yellow,green,blue,violet,red);
}
.sc-size-row { display:flex; align-items:center; gap:6px; padding:2px 0; }
.sc-size-dot {
  border-radius:50%; cursor:pointer;
  border:2px solid transparent;
  background:var(--text); flex-shrink:0;
  transition:border-color 0.1s,transform 0.1s;
}
.sc-size-dot:hover { transform:scale(1.2); }
.sc-size-dot.active { border-color:var(--accent); }
.sc-tool-row { display:flex; gap:5px; }
.sc-tool-btn {
  flex:1; padding:5px 0;
  border:1px solid var(--border); border-radius:7px;
  background:var(--surface); color:var(--text);
  font-size:12px; cursor:pointer; text-align:center;
  transition:background 0.12s,border-color 0.12s;
}
.sc-tool-btn.active  { background:rgba(124,106,255,0.2); border-color:var(--accent); }
.sc-tool-btn:hover:not(.active) { background:var(--surface3); }
.sc-divider { height:1px; background:var(--border); }
.sc-action-row { display:flex; gap:5px; }
.sc-action-btn {
  flex:1; padding:6px 4px;
  border:1px solid var(--border); border-radius:7px;
  background:var(--surface); color:var(--text-muted);
  font-size:10px; cursor:pointer; text-align:center; line-height:1.4;
  display:flex; flex-direction:column; align-items:center; gap:1px;
  transition:background 0.12s;
}
.sc-action-btn:hover { background:var(--surface3); color:var(--text); }
.sc-action-btn.danger:hover { background:rgba(239,68,68,0.12); color:#ef4444; }
.sc-action-btn.success { color:#22c55e; }
.sc-clear-confirm {
  background:var(--surface3); border:1px solid var(--border);
  border-radius:10px; padding:10px 12px;
  font-size:12px; color:var(--text);
  display:flex; flex-direction:column; gap:8px;
}
.sc-clear-confirm p { margin:0; line-height:1.4; }
.sc-confirm-row { display:flex; gap:6px; justify-content:flex-end; }
.sc-confirm-row button {
  padding:5px 12px; border-radius:6px; font-size:12px;
  cursor:pointer; border:none; font-weight:600;
}
.sc-pill-btn {
  width:26px; height:26px; border-radius:50%;
  background:none; border:1px solid var(--border);
  cursor:pointer; display:flex; align-items:center; justify-content:center;
  font-size:11px; color:var(--text-muted); transition:background 0.12s;
  flex-shrink:0;
}
.sc-pill-btn:hover { background:var(--surface3); color:var(--text); }
.sc-save-dot {
  width:7px; height:7px; border-radius:50%;
  transition:background 0.3s; flex-shrink:0;
}
.sc-save-dot.unsaved { background:#f59e0b; }
.sc-save-dot.saving  { background:#f59e0b; animation:sc-pulse-dot 0.8s infinite; }
.sc-save-dot.saved   { background:#22c55e; }
.sc-save-dot.idle    { background:transparent; }
.sc-hint {
  position:absolute; inset:0;
  display:flex; align-items:center; justify-content:center;
  pointer-events:none; z-index:2;
  font-size:13px; color:#c8c8c8;
  font-family:'Space Mono',monospace;
  text-align:center; padding:24px; line-height:1.5;
}
.sc-dissolved {
  position:absolute; inset:0; z-index:30;
  background:rgba(0,0,0,0.72); backdrop-filter:blur(4px);
  display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:14px;
  color:var(--text); text-align:center; padding:24px;
}
.sc-dissolved p { margin:0; font-size:14px; color:var(--text-muted); }
.sc-toast {
  position:absolute; top:10px; left:50%;
  pointer-events:none; z-index:40;
  animation:sc-toast 3.2s ease forwards;
}
.sc-toast-pill {
  display:flex; align-items:center; gap:6px;
  padding:6px 12px; border-radius:20px;
  background:rgba(0,0,0,0.72); backdrop-filter:blur(8px);
  font-size:12px; color:#fff; white-space:nowrap;
  border:1px solid rgba(255,255,255,0.15);
}
`;

let stylesInjected = false;

// ── Component ─────────────────────────────────────────────────────────────────

export function SharedCanvasWidget({ connectionId, onClose }: Props) {
  const { user } = useAuth();
  const { active: connections } = useConnections(true);

  // ── UI State ───────────────────────────────────────────────────────────────
  const [tool,             setTool]             = useState<Tool>('brush');
  const [color,            setColor]            = useState('#000000');
  const [brushSize,        setBrushSize]        = useState(8);
  const [toolbarExpanded,  setToolbarExpanded]  = useState(false);
  const [saveStatus,       setSaveStatus]       = useState<SaveStatus>('idle');
  const [dissolved,        setDissolved]        = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [savedToPhotoMsg,  setSavedToPhotoMsg]  = useState<string | null>(null);
  const [toast,            setToast]            = useState<string | null>(null);
  const [hintVisible,      setHintVisible]      = useState(true);
  const [layoutMode,       setLayoutMode]       = useState<LayoutMode>('standard');
  const [customColors,     setCustomColors]     = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('nexus_canvas_custom_colors') ?? '[]') as string[]; }
    catch { return []; }
  });

  // ── Canvas Refs ────────────────────────────────────────────────────────────
  const mainRef      = useRef<HTMLCanvasElement>(null);
  const overlayRef   = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // ── Drawing Refs ───────────────────────────────────────────────────────────
  const isDrawingRef          = useRef(false);
  const currentStrokeRef      = useRef<ActiveStroke | null>(null);
  const partnerStrokesRef     = useRef<Map<string, ActiveStroke>>(new Map());
  const partnerCursorRef      = useRef<{ x: number; y: number; name: string } | null>(null);
  const partnerCursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Performance Refs ───────────────────────────────────────────────────────
  const lastBroadcastRef  = useRef(0);
  const saveDebounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayDirtyRef   = useRef(false);
  const overlayRafRef     = useRef(0);
  const undoStackRef      = useRef<ImageData[]>([]);
  const canvasSizeRef     = useRef({ w: 0, h: 0 });
  const savedImageRef     = useRef<string | null>(null);  // for resize restoration
  const canvasReadyRef    = useRef(false);
  const toolRef           = useRef<Tool>('brush');
  const colorRef          = useRef('#000000');
  const brushSizeRef      = useRef(8);

  // Keep refs in sync with state (avoids stale closures in event handlers)
  useEffect(() => { toolRef.current = tool; },      [tool]);
  useEffect(() => { colorRef.current = color; },    [color]);
  useEffect(() => { brushSizeRef.current = brushSize; }, [brushSize]);

  // ── Inject CSS ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (stylesInjected) return;
    const el = document.createElement('style');
    el.textContent = STYLES;
    document.head.appendChild(el);
    stylesInjected = true;
  }, []);

  // ── Partner display name ───────────────────────────────────────────────────
  const partnerName = useMemo(() => {
    const conn = connections.find((c) => c.connection_id === connectionId);
    return conn?.partner?.displayName ?? conn?.partner?.username ?? 'Partner';
  }, [connections, connectionId]);

  // ── Check connection dissolved ─────────────────────────────────────────────
  useEffect(() => {
    const conn = connections.find((c) => c.connection_id === connectionId);
    if (connections.length > 0 && !conn) setDissolved(true);
  }, [connections, connectionId]);

  // ── Canvas helpers ─────────────────────────────────────────────────────────
  const getMainCtx = useCallback(() =>
    mainRef.current?.getContext('2d', { willReadFrequently: true }) ?? null, []);

  const getOverlayCtx = useCallback(() =>
    overlayRef.current?.getContext('2d') ?? null, []);

  // ── Overlay redraw (rAF-batched) ───────────────────────────────────────────
  const performOverlayRedraw = useCallback(() => {
    overlayRafRef.current = 0;
    if (!overlayDirtyRef.current) return;
    overlayDirtyRef.current = false;

    const ctx = getOverlayCtx();
    const { w, h } = canvasSizeRef.current;
    if (!ctx || w === 0 || h === 0) return;

    ctx.clearRect(0, 0, w, h);

    // Draw my in-progress stroke
    if (currentStrokeRef.current) {
      drawStrokeOnCtx(ctx, currentStrokeRef.current, w, h);
    }

    // Draw partner strokes
    for (const stroke of partnerStrokesRef.current.values()) {
      drawStrokeOnCtx(ctx, stroke, w, h);
    }

    // Draw partner cursor
    if (partnerCursorRef.current) {
      const { x, y, name } = partnerCursorRef.current;
      const px = x * w, py = y * h;
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(124,106,255,0.85)';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Name label
      ctx.font = 'bold 10px system-ui';
      ctx.fillStyle = 'rgba(124,106,255,1)';
      const label = name.charAt(0).toUpperCase();
      ctx.fillText(label, px + 8, py - 4);
      ctx.restore();
    }
  }, [getOverlayCtx]);

  const scheduleOverlayRedraw = useCallback(() => {
    overlayDirtyRef.current = true;
    if (!overlayRafRef.current) {
      overlayRafRef.current = requestAnimationFrame(performOverlayRedraw);
    }
  }, [performOverlayRedraw]);

  // ── Undo ───────────────────────────────────────────────────────────────────
  const saveToUndoStack = useCallback(() => {
    const main = mainRef.current;
    const { w, h } = canvasSizeRef.current;
    if (!main || w === 0 || h === 0) return;
    const ctx = getMainCtx();
    if (!ctx) return;
    const imageData = ctx.getImageData(0, 0, w, h);
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), imageData];
  }, [getMainCtx]);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const previous = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    const ctx = getMainCtx();
    if (!ctx) return;
    ctx.putImageData(previous, 0, 0);
    // Capture the restored image for resize resilience
    savedImageRef.current = mainRef.current!.toDataURL('image/png');
    scheduleOverlayRedraw();
    // Schedule a snapshot save so partner also sees the undo
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    setSaveStatus('unsaved');
    saveDebounceRef.current = setTimeout(() => saveSnapshot(), SAVE_DEBOUNCE_MS);
  }, [getMainCtx, scheduleOverlayRedraw]);

  // ── Snapshot save ──────────────────────────────────────────────────────────
  const saveSnapshot = useCallback(async () => {
    const main = mainRef.current;
    if (!main) return;
    setSaveStatus('saving');
    try {
      const blob: Blob | null = await new Promise((resolve) =>
        main.toBlob(resolve, 'image/png'),
      );
      if (!blob) throw new Error('toBlob returned null');

      const fd = new FormData();
      fd.append('snapshot', blob, 'canvas.png');

      const res = await apiFetchMultipart(
        `/api/shared-canvas/${connectionId}/snapshot`,
        fd,
      );
      if (res.ok) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2500);
      } else {
        setSaveStatus('unsaved');
      }
    } catch {
      setSaveStatus('unsaved');
    }
  }, [connectionId]);

  const scheduleSave = useCallback(() => {
    setSaveStatus('unsaved');
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => saveSnapshot(), SAVE_DEBOUNCE_MS);
  }, [saveSnapshot]);

  // ── Broadcast stroke ───────────────────────────────────────────────────────
  const broadcastStroke = useCallback((isComplete: boolean) => {
    const stroke = currentStrokeRef.current;
    if (!stroke || !user) return;

    const now = performance.now();
    if (!isComplete && now - lastBroadcastRef.current < BROADCAST_THROTTLE_MS) return;
    lastBroadcastRef.current = now;

    const payload: StrokePayload = {
      strokeId:   stroke.strokeId,
      userId:     user.id,
      tool:       stroke.tool,
      color:      stroke.color,
      size:       stroke.size,
      points:     [...stroke.points],
      isComplete,
    };

    apiFetch(`/api/shared-canvas/${connectionId}/stroke`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    }).catch(() => {/* fire and forget */});
  }, [connectionId, user]);

  // ── Pointer handlers ───────────────────────────────────────────────────────
  function getCanvasPoint(e: RPointerEvent<HTMLCanvasElement>): [number, number] {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return [
      (e.clientX - rect.left) / rect.width,
      (e.clientY - rect.top) / rect.height,
    ];
  }

  const handlePointerDown = useCallback((e: RPointerEvent<HTMLCanvasElement>) => {
    if (dissolved) return;

    // Collapse toolbar when user starts drawing
    setToolbarExpanded(false);
    setShowClearConfirm(false);

    const [px, py] = getCanvasPoint(e);
    const currentTool  = toolRef.current;
    const currentColor = colorRef.current;
    const currentSize  = brushSizeRef.current;

    if (currentTool === 'fill') {
      const { w, h } = canvasSizeRef.current;
      const main = mainRef.current;
      if (!main || w === 0 || h === 0) return;
      saveToUndoStack();
      setHintVisible(false);
      setTimeout(() => {
        floodFill(main, px * w, py * h, currentColor);
        savedImageRef.current = main.toDataURL('image/png');
        scheduleSave();
      }, 10);
      return;
    }

    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    isDrawingRef.current = true;

    currentStrokeRef.current = {
      strokeId: uid(),
      tool:     currentTool,
      color:    currentColor,
      size:     currentSize,
      points:   [[px, py]],
    };

    saveToUndoStack();
    setHintVisible(false);
    scheduleOverlayRedraw();
    broadcastStroke(false);
  }, [dissolved, broadcastStroke, saveToUndoStack, scheduleSave, scheduleOverlayRedraw]);

  const handlePointerMove = useCallback((e: RPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !currentStrokeRef.current) return;

    const [px, py] = getCanvasPoint(e);
    const stroke = currentStrokeRef.current;
    const prev = stroke.points[stroke.points.length - 1];

    // Deduplicate identical points
    if (prev && Math.abs(prev[0] - px) < 0.001 && Math.abs(prev[1] - py) < 0.001) return;

    stroke.points.push([px, py]);
    scheduleOverlayRedraw();
    broadcastStroke(false);
  }, [broadcastStroke, scheduleOverlayRedraw]);

  const handlePointerUp = useCallback((_e: RPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !currentStrokeRef.current) return;
    isDrawingRef.current = false;

    const stroke = currentStrokeRef.current;

    // Commit completed stroke to main canvas
    const ctx = getMainCtx();
    const { w, h } = canvasSizeRef.current;
    if (ctx && w > 0 && h > 0) {
      drawStrokeOnCtx(ctx, stroke, w, h);
      savedImageRef.current = mainRef.current!.toDataURL('image/png');
    }

    // Clear from overlay
    currentStrokeRef.current = null;
    scheduleOverlayRedraw();

    // Final broadcast with isComplete=true
    const finalPayload: StrokePayload = {
      strokeId:   stroke.strokeId,
      userId:     user?.id ?? '',
      tool:       stroke.tool,
      color:      stroke.color,
      size:       stroke.size,
      points:     [...stroke.points],
      isComplete: true,
    };
    apiFetch(`/api/shared-canvas/${connectionId}/stroke`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(finalPayload),
    }).catch(() => {});

    scheduleSave();
  }, [connectionId, getMainCtx, scheduleSave, scheduleOverlayRedraw, user]);

  const handlePointerLeave = useCallback(() => {
    if (isDrawingRef.current) handlePointerUp({} as RPointerEvent<HTMLCanvasElement>);
  }, [handlePointerUp]);

  // ── SSE handler ────────────────────────────────────────────────────────────
  const handleSSE = useCallback((event: { type: string; payload: unknown }) => {
    const { type, payload } = event;

    if (type === 'canvas:stroke') {
      const s = payload as StrokePayload;
      if (s.userId === user?.id) return; // ignore own echoes

      const { w, h } = canvasSizeRef.current;

      if (s.isComplete) {
        // Commit to main canvas
        const ctx = getMainCtx();
        if (ctx && w > 0 && h > 0) drawStrokeOnCtx(ctx, s, w, h);
        partnerStrokesRef.current.delete(s.strokeId);
        // Update cursor from last point
        if (s.points.length > 0) {
          const last = s.points[s.points.length - 1];
          partnerCursorRef.current = { x: last[0], y: last[1], name: partnerName };
          if (partnerCursorTimerRef.current) clearTimeout(partnerCursorTimerRef.current);
          partnerCursorTimerRef.current = setTimeout(() => {
            partnerCursorRef.current = null;
            scheduleOverlayRedraw();
          }, 3000);
        }
        setHintVisible(false);
      } else {
        // Update in-progress partner stroke
        partnerStrokesRef.current.set(s.strokeId, {
          strokeId: s.strokeId,
          tool:     s.tool,
          color:    s.color,
          size:     s.size,
          points:   s.points,
        });
        // Update cursor
        if (s.points.length > 0) {
          const last = s.points[s.points.length - 1];
          partnerCursorRef.current = { x: last[0], y: last[1], name: partnerName };
        }
      }
      scheduleOverlayRedraw();
      savedImageRef.current = mainRef.current?.toDataURL('image/png') ?? null;
    }

    if (type === 'canvas:cleared') {
      const ctx = getMainCtx();
      const { w, h } = canvasSizeRef.current;
      if (ctx && w > 0 && h > 0) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
      }
      partnerStrokesRef.current.clear();
      currentStrokeRef.current = null;
      undoStackRef.current = [];
      savedImageRef.current = null;
      setHintVisible(true);
      scheduleOverlayRedraw();
    }

    if (type === 'canvas:snapshot_saved') {
      // The partner saved a snapshot — we're in sync, nothing to do
      // (our main canvas already has the strokes drawn incrementally)
    }
  }, [getMainCtx, partnerName, scheduleOverlayRedraw, user?.id]);

  useSharedChannel(connectionId, 'shared_canvas', handleSSE);

  // ── Canvas resize ──────────────────────────────────────────────────────────
  const handleResize = useCallback((newW: number, newH: number) => {
    const main = mainRef.current;
    const overlay = overlayRef.current;
    if (!main || !overlay) return;

    // Save current content before dimensions reset it
    if (canvasReadyRef.current && main.width > 0 && main.height > 0) {
      savedImageRef.current = main.toDataURL('image/png');
    }

    main.width    = newW;
    main.height   = newH;
    overlay.width  = newW;
    overlay.height = newH;
    canvasSizeRef.current = { w: newW, h: newH };

    // Fill with white
    const ctx = main.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, newW, newH);

    // Restore content
    if (savedImageRef.current) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, newW, newH);
        scheduleOverlayRedraw();
      };
      img.src = savedImageRef.current;
    }

    canvasReadyRef.current = true;
    scheduleOverlayRedraw();
  }, [scheduleOverlayRedraw]);

  // ── ResizeObserver ─────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const w = Math.round(width);
      const h = Math.round(height);
      if (w > 0 && h > 0) {
        setLayoutMode(getLayoutMode(w, h));
        handleResize(w, h);
      }
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, [handleResize]);

  // ── Initial canvas load ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const res = await apiFetch(`/api/shared-canvas/${connectionId}`);
      if (!res.ok || cancelled) return;
      const data = await res.json() as { empty?: boolean; snapshotUrl?: string };
      if (data.empty || !data.snapshotUrl) return;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (cancelled) return;
        const ctx = getMainCtx();
        const { w, h } = canvasSizeRef.current;
        if (!ctx || w === 0 || h === 0) {
          // Canvas not sized yet — store the URL for when it is
          savedImageRef.current = data.snapshotUrl!;
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        savedImageRef.current = data.snapshotUrl!;
        setHintVisible(false);
        scheduleOverlayRedraw();
      };
      img.src = data.snapshotUrl;
    }

    load().catch(() => {});
    return () => { cancelled = true; };
  }, [connectionId, getMainCtx, scheduleOverlayRedraw]);

  // ── Keyboard shortcut (Cmd/Ctrl+Z) ────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
      if (partnerCursorTimerRef.current) clearTimeout(partnerCursorTimerRef.current);
      if (overlayRafRef.current) cancelAnimationFrame(overlayRafRef.current);
    };
  }, []);

  // ── Canvas clear ───────────────────────────────────────────────────────────
  const clearCanvas = useCallback(async () => {
    const ctx = getMainCtx();
    const { w, h } = canvasSizeRef.current;
    if (!ctx || w === 0 || h === 0) return;
    saveToUndoStack();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    partnerStrokesRef.current.clear();
    currentStrokeRef.current = null;
    savedImageRef.current = null;
    undoStackRef.current = [];
    setHintVisible(true);
    setShowClearConfirm(false);
    scheduleOverlayRedraw();
    await apiFetch(`/api/shared-canvas/${connectionId}`, { method: 'DELETE' });
    setSaveStatus('idle');
  }, [connectionId, getMainCtx, saveToUndoStack, scheduleOverlayRedraw]);

  // ── Save to photo frame ────────────────────────────────────────────────────
  const saveToPhotoFrame = useCallback(async () => {
    // First ensure snapshot is current
    await saveSnapshot();
    try {
      const res = await apiFetch(`/api/shared-canvas/${connectionId}/save-to-photo-frame`, {
        method: 'POST',
      });
      if (res.ok) {
        setSavedToPhotoMsg('✓ Saved to Photo Frame');
      } else {
        setSavedToPhotoMsg('Add a Photo Frame widget to see it');
      }
      setTimeout(() => setSavedToPhotoMsg(null), 4000);
    } catch {
      setSavedToPhotoMsg('Save failed — try again');
      setTimeout(() => setSavedToPhotoMsg(null), 3000);
    }
  }, [connectionId, saveSnapshot]);

  // ── Download ───────────────────────────────────────────────────────────────
  const downloadCanvas = useCallback(() => {
    const main = mainRef.current;
    if (!main) return;
    const url = main.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `drawing-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  }, []);

  // ── Custom color pick ──────────────────────────────────────────────────────
  const handleCustomColor = useCallback((hex: string) => {
    setColor(hex);
    setCustomColors((prev) => {
      const next = [hex, ...prev.filter((c) => c !== hex)].slice(0, 4);
      localStorage.setItem('nexus_canvas_custom_colors', JSON.stringify(next));
      return next;
    });
  }, []);

  // ── Dynamic cursor ─────────────────────────────────────────────────────────
  const cursorStyle = useMemo((): string => {
    if (tool === 'fill') return 'crosshair';
    const size = Math.max(8, brushSize);
    const half = size / 2;
    if (tool === 'eraser') {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size + 4}" height="${size + 4}">
        <rect x="2" y="2" width="${size}" height="${size}" fill="white" stroke="#555" stroke-width="2" rx="2"/>
      </svg>`;
      return `url('data:image/svg+xml,${encodeURIComponent(svg)}') ${half + 2} ${half + 2}, crosshair`;
    }
    const strokeClr = color === '#FFFFFF' ? '#999' : 'rgba(255,255,255,0.6)';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size + 6}" height="${size + 6}">
      <circle cx="${half + 3}" cy="${half + 3}" r="${half}" fill="${color}" stroke="${strokeClr}" stroke-width="1.5"/>
    </svg>`;
    return `url('data:image/svg+xml,${encodeURIComponent(svg)}') ${half + 3} ${half + 3}, crosshair`;
  }, [tool, color, brushSize]);

  // ── Layout flags ───────────────────────────────────────────────────────────
  const isMicro    = layoutMode === 'micro';
  const isSide     = layoutMode === 'expanded' && (containerRef.current?.offsetHeight ?? 0) > (containerRef.current?.offsetWidth ?? 0) * 1.2;
  const maxBrushes = isMicro ? BRUSH_SIZES.slice(0, 3) : BRUSH_SIZES;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="sc-widget" ref={containerRef}>
      {/* Main canvas (permanent) */}
      <canvas
        ref={mainRef}
        className="sc-canvas-layer"
        style={{ cursor: cursorStyle, zIndex: 1 }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      />

      {/* Overlay canvas (ephemeral) */}
      <canvas
        ref={overlayRef}
        className="sc-canvas-layer"
        style={{ pointerEvents: 'none', zIndex: 2 }}
      />

      {/* Empty state hint */}
      {hintVisible && (
        <div className="sc-hint">
          Start drawing — your friend will see it live
        </div>
      )}

      {/* Floating toolbar */}
      <div className={`sc-toolbar-wrap${isSide ? ' side' : ''}`}>

        {/* Expanded panel — renders above the pill */}
        {toolbarExpanded && (
          <div className={`sc-expanded${isSide ? ' side' : ''}`}>
            {/* Color palette */}
            <div className="sc-color-grid">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  className={`sc-swatch${color === c ? ' active' : ''}`}
                  style={{ background: c, boxShadow: c === '#FFFFFF' ? 'inset 0 0 0 1px #ccc' : undefined }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
              {/* Custom colors */}
              {customColors.map((c) => (
                <button
                  key={`custom-${c}`}
                  className={`sc-swatch${color === c ? ' active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
              {/* Rainbow swatch → opens native color picker */}
              <button
                className="sc-swatch rainbow"
                title="Custom color"
                onClick={() => colorInputRef.current?.click()}
              />
              <input
                ref={colorInputRef}
                type="color"
                style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }}
                onChange={(e) => handleCustomColor(e.target.value)}
              />
            </div>

            <div className="sc-divider" />

            {/* Brush sizes */}
            <div className="sc-size-row">
              {maxBrushes.map((s) => (
                <button
                  key={s}
                  className={`sc-size-dot${brushSize === s ? ' active' : ''}`}
                  style={{ width: s, height: s, minWidth: s, minHeight: s }}
                  onClick={() => setBrushSize(s)}
                  title={`${s}px`}
                />
              ))}
            </div>

            <div className="sc-divider" />

            {/* Tools */}
            <div className="sc-tool-row">
              {([['brush', '🖌️', 'Brush'], ['eraser', '◻️', 'Eraser'], ['fill', '🪣', 'Fill']] as const).map(([t, icon, label]) => (
                <button
                  key={t}
                  className={`sc-tool-btn${tool === t ? ' active' : ''}`}
                  onClick={() => setTool(t)}
                  title={label}
                >
                  {icon}
                </button>
              ))}
            </div>

            <div className="sc-divider" />

            {/* Clear confirm flow */}
            {showClearConfirm ? (
              <div className="sc-clear-confirm">
                <p>Clear canvas for both of you?</p>
                <div className="sc-confirm-row">
                  <button style={{ background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6 }} onClick={() => setShowClearConfirm(false)}>No</button>
                  <button style={{ background: '#ef4444', color: '#fff', borderRadius: 6 }} onClick={clearCanvas}>Yes, clear</button>
                </div>
              </div>
            ) : (
              <div className="sc-action-row">
                <button className="sc-action-btn" onClick={undo} title="Undo (Cmd+Z)">
                  <span>↩️</span>
                  <span>Undo</span>
                </button>
                <button className="sc-action-btn danger" onClick={() => setShowClearConfirm(true)} title="Clear canvas">
                  <span>🗑️</span>
                  <span>Clear</span>
                </button>
                <button
                  className={`sc-action-btn${savedToPhotoMsg ? ' success' : ''}`}
                  onClick={saveToPhotoFrame}
                  title="Save as Photo Frame"
                >
                  <span>🖼️</span>
                  <span>{savedToPhotoMsg ? '✓ Saved' : 'Photo'}</span>
                </button>
                <button className="sc-action-btn" onClick={downloadCanvas} title="Download PNG">
                  <span>⬇️</span>
                  <span>Save</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Compact pill */}
        <div className={`sc-pill${isMicro ? ' micro' : ''}`}>
          {/* Color swatch */}
          <div
            style={{
              width: isMicro ? 14 : 18,
              height: isMicro ? 14 : 18,
              borderRadius: '50%',
              background: color,
              border: color === '#FFFFFF' ? '1.5px solid #ccc' : '1.5px solid rgba(255,255,255,0.3)',
              flexShrink: 0,
            }}
          />

          {/* Size dot */}
          {!isMicro && (
            <div
              style={{
                width: brushSize / 2.5,
                height: brushSize / 2.5,
                minWidth: 4,
                minHeight: 4,
                borderRadius: '50%',
                background: 'var(--text)',
                flexShrink: 0,
              }}
            />
          )}

          {/* Tool icon */}
          {!isMicro && (
            <span style={{ fontSize: 12, lineHeight: 1 }}>
              {tool === 'brush' ? '🖌️' : tool === 'eraser' ? '◻️' : '🪣'}
            </span>
          )}

          {/* Save indicator */}
          <div className={`sc-save-dot ${saveStatus}`} />

          {/* Undo button */}
          {!isMicro && (
            <button className="sc-pill-btn" onClick={undo} title="Undo (Cmd+Z)">↩</button>
          )}

          {/* Expand/collapse */}
          <button
            className="sc-pill-btn"
            onClick={() => { setToolbarExpanded((v) => !v); setShowClearConfirm(false); }}
            title={toolbarExpanded ? 'Close toolbar' : 'Open toolbar'}
            style={{ color: toolbarExpanded ? 'var(--accent)' : undefined }}
          >
            {toolbarExpanded ? '✕' : '⋯'}
          </button>
        </div>
      </div>

      {/* Toast notifications */}
      {savedToPhotoMsg && (
        <div className="sc-toast">
          <div className="sc-toast-pill">🖼️ {savedToPhotoMsg}</div>
        </div>
      )}

      {/* Dissolved state overlay */}
      {dissolved && (
        <div className="sc-dissolved">
          <span style={{ fontSize: 28 }}>🎨</span>
          <p>This canvas is no longer available</p>
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px',
              background: 'var(--surface2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Remove Widget
          </button>
        </div>
      )}
    </div>
  );
}
