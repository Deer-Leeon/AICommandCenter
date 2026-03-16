/**
 * SharedCanvasWidget — real-time collaborative drawing canvas between two friends.
 *
 * ── Architecture ──────────────────────────────────────────────────────────────
 *
 *   Three canvas elements:
 *     worldCanvas  (2000×2000, hidden) — source of truth: all drawing lives here
 *     viewportCanvas (widget size)     — blitted slice of worldCanvas, receives input
 *     overlayCanvas  (widget size)     — ephemeral: in-progress strokes (yours +
 *                                        partner's), with pan transform applied
 *
 *   Infinite canvas:
 *     The world is always 2000×2000 px. Resizing the widget only changes how
 *     much of the world is visible — nothing is scaled, stretched, or blurred.
 *     Pan offset (panX, panY) = top-left world coord visible at screen (0,0).
 *     Coordinate conversion: worldX = screenX + panX, worldY = screenY + panY
 *
 *   Zero-latency strokes (WebSocket):
 *     Strokes are broadcast via a persistent WS connection (useCanvasWebSocket).
 *     The server relays each message to the partner in <5 ms — no per-message
 *     HTTP overhead. SSE is kept only for snapshot_saved / canvas:cleared events.
 *
 *   Points are stored as absolute world-pixel coordinates (0–WORLD_W / WORLD_H).
 */
import {
  useState, useEffect, useRef, useCallback, useMemo,
  type PointerEvent as RPointerEvent,
} from 'react';
import { useAuth }             from '../../hooks/useAuth';
import { useConnections }      from '../../hooks/useConnections';
import { useSharedChannel }    from '../../hooks/useSharedChannel';
import { useCanvasWebSocket }  from '../../hooks/useCanvasWebSocket';
import { apiFetch, apiFetchMultipart } from '../../lib/api';

// ── Constants ─────────────────────────────────────────────────────────────────

const WORLD_W  = 2000;
const WORLD_H  = 2000;
const MAX_UNDO = 12;
const SAVE_DEBOUNCE_MS = 2000;

// ── Types ─────────────────────────────────────────────────────────────────────

type Tool       = 'brush' | 'eraser' | 'fill' | 'pan';
type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved';
type LayoutMode = 'micro' | 'slim' | 'standard' | 'expanded';

interface StrokeMsg {
  strokeId:   string;
  userId?:    string;   // injected by server on relay
  tool:       Tool;
  color:      string;
  size:       number;
  points:     [number, number][];  // absolute world coords
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

// ── Palette / sizes ───────────────────────────────────────────────────────────

const PALETTE: string[] = [
  '#000000', '#FFFFFF', '#EF4444', '#F97316',
  '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#6B7280',
];
const BRUSH_SIZES = [4, 8, 16, 32] as const;

// ── Drawing helpers ───────────────────────────────────────────────────────────

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
) {
  const { tool, color, size, points } = stroke;
  if (points.length === 0) return;

  ctx.save();
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size;

  const drawColor = tool === 'eraser' ? '#FFFFFF' : color;
  ctx.strokeStyle = drawColor;
  ctx.fillStyle   = drawColor;

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0][0], points[0][1], size / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length - 1; i++) {
      const midX = (points[i][0] + points[i + 1][0]) / 2;
      const midY = (points[i][1] + points[i + 1][1]) / 2;
      ctx.quadraticCurveTo(points[i][0], points[i][1], midX, midY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
  }
  ctx.restore();
}

function floodFill(canvas: HTMLCanvasElement, worldX: number, worldY: number, hex: string) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const fr = parseInt(hex.slice(1, 3), 16);
  const fg = parseInt(hex.slice(3, 5), 16);
  const fb = parseInt(hex.slice(5, 7), 16);

  const sx = Math.round(worldX), sy = Math.round(worldY);
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
@keyframes sc-toast-kf {
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
  position:absolute; inset:0; touch-action:none;
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
  transform-origin:bottom center; min-width:200px;
}
.sc-expanded.side { transform-origin:right center; }
.sc-color-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:4px; }
.sc-swatch {
  width:24px; height:24px; border-radius:5px;
  border:2px solid transparent; cursor:pointer;
  transition:transform 0.1s,border-color 0.1s; flex-shrink:0;
}
.sc-swatch:hover { transform:scale(1.15); }
.sc-swatch.active { border-color:#fff; }
.sc-swatch.rainbow { background:conic-gradient(red,orange,yellow,green,blue,violet,red); }
.sc-size-row { display:flex; align-items:center; gap:6px; padding:2px 0; }
.sc-size-dot {
  border-radius:50%; cursor:pointer;
  border:2px solid transparent; background:var(--text); flex-shrink:0;
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
.sc-clear-confirm {
  background:var(--surface3); border:1px solid var(--border);
  border-radius:10px; padding:10px 12px;
  font-size:12px; color:var(--text); display:flex; flex-direction:column; gap:8px;
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
  font-size:13px; color:#c8c8c8; font-family:'Space Mono',monospace;
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
  position:absolute; top:10px; left:50%; pointer-events:none; z-index:40;
  animation:sc-toast-kf 3.2s ease forwards;
}
.sc-toast-pill {
  display:flex; align-items:center; gap:6px;
  padding:6px 12px; border-radius:20px;
  background:rgba(0,0,0,0.72); backdrop-filter:blur(8px);
  font-size:12px; color:#fff; white-space:nowrap;
  border:1px solid rgba(255,255,255,0.15);
}
`;

let _stylesInjected = false;

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
  const [hintVisible,      setHintVisible]      = useState(true);
  const [layoutMode,       setLayoutMode]       = useState<LayoutMode>('standard');
  const [customColors,     setCustomColors]     = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('nexus_canvas_custom_colors') ?? '[]') as string[]; }
    catch { return []; }
  });

  // ── Canvas refs ────────────────────────────────────────────────────────────
  const worldRef     = useRef<HTMLCanvasElement>(null);  // 2000×2000 hidden world
  const viewportRef  = useRef<HTMLCanvasElement>(null);  // widget-size, shown to user
  const overlayRef   = useRef<HTMLCanvasElement>(null);  // partner strokes + cursor
  const containerRef = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // ── Drawing refs ───────────────────────────────────────────────────────────
  const isDrawingRef          = useRef(false);
  const isPanningRef          = useRef(false);
  const panStartRef           = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const panXRef               = useRef(0);
  const panYRef               = useRef(0);
  const currentStrokeRef      = useRef<ActiveStroke | null>(null);
  const partnerStrokesRef     = useRef<Map<string, ActiveStroke>>(new Map());
  const partnerCursorRef      = useRef<{ x: number; y: number; name: string } | null>(null);
  const partnerCursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dedup: track completed strokeIds so WS + SSE don't draw the same stroke twice
  const completedStrokesRef   = useRef<Set<string>>(new Set());

  // ── Performance refs ───────────────────────────────────────────────────────
  const saveDebounceRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlayDirtyRef          = useRef(false);
  const overlayRafRef            = useRef(0);
  const undoStackRef             = useRef<string[]>([]);   // dataURL strings (PNG compressed)
  const viewSizeRef              = useRef({ w: 0, h: 0 });
  const toolRef                  = useRef<Tool>('brush');
  const colorRef                 = useRef('#000000');
  const brushSizeRef             = useRef(8);
  // Throttle for in-progress stroke SSE broadcasts (~12fps over HTTP POST)
  const sseProgressThrottleRef   = useRef(0);

  // Keep tool/color/size refs in sync (avoid stale closures in event handlers)
  useEffect(() => { toolRef.current = tool; },          [tool]);
  useEffect(() => { colorRef.current = color; },        [color]);
  useEffect(() => { brushSizeRef.current = brushSize; }, [brushSize]);

  // ── Inject CSS once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (_stylesInjected) return;
    const el = document.createElement('style');
    el.textContent = STYLES;
    document.head.appendChild(el);
    _stylesInjected = true;
  }, []);

  // ── Partner display name ───────────────────────────────────────────────────
  const partnerName = useMemo(() => {
    const conn = connections.find((c) => c.connection_id === connectionId);
    return conn?.partner?.displayName ?? conn?.partner?.username ?? '?';
  }, [connections, connectionId]);

  // ── Check connection dissolved ─────────────────────────────────────────────
  useEffect(() => {
    if (connections.length > 0 && !connections.find((c) => c.connection_id === connectionId)) {
      setDissolved(true);
    }
  }, [connections, connectionId]);

  // ── Context helpers ────────────────────────────────────────────────────────
  const getWorldCtx = useCallback(() =>
    worldRef.current?.getContext('2d', { willReadFrequently: true }) ?? null, []);

  const getOverlayCtx = useCallback(() =>
    overlayRef.current?.getContext('2d') ?? null, []);

  // ── Blit world → viewport (shows the current pan offset as the visible area) ─
  const blitViewport = useCallback(() => {
    const vp  = viewportRef.current;
    const world = worldRef.current;
    if (!vp || !world) return;
    const ctx = vp.getContext('2d');
    if (!ctx) return;
    const { w, h } = viewSizeRef.current;
    if (w === 0 || h === 0) return;
    ctx.clearRect(0, 0, w, h);
    // Copy the pan-offset slice of the world onto the viewport 1:1 — no scaling!
    ctx.drawImage(world, panXRef.current, panYRef.current, w, h, 0, 0, w, h);
  }, []);

  // ── Overlay redraw (rAF-batched) ───────────────────────────────────────────
  const performOverlayRedraw = useCallback(() => {
    overlayRafRef.current = 0;
    if (!overlayDirtyRef.current) return;
    overlayDirtyRef.current = false;

    const ctx = getOverlayCtx();
    const { w, h } = viewSizeRef.current;
    if (!ctx || w === 0 || h === 0) return;

    ctx.clearRect(0, 0, w, h);

    // Apply inverse pan so world-coord strokes appear at the right screen position
    ctx.save();
    ctx.translate(-panXRef.current, -panYRef.current);

    // My in-progress stroke (in world coords)
    if (currentStrokeRef.current) {
      drawStrokeOnCtx(ctx, currentStrokeRef.current);
    }

    // Partner strokes (in world coords)
    for (const stroke of partnerStrokesRef.current.values()) {
      drawStrokeOnCtx(ctx, stroke);
    }

    // Partner cursor dot
    if (partnerCursorRef.current) {
      const { x, y, name } = partnerCursorRef.current;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(124,106,255,0.85)';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = 'bold 10px system-ui';
      ctx.fillStyle = 'rgba(124,106,255,1)';
      ctx.fillText(name.charAt(0).toUpperCase(), x + 8, y - 4);
    }

    ctx.restore();
  }, [getOverlayCtx]);

  const scheduleOverlayRedraw = useCallback(() => {
    overlayDirtyRef.current = true;
    if (!overlayRafRef.current) {
      overlayRafRef.current = requestAnimationFrame(performOverlayRedraw);
    }
  }, [performOverlayRedraw]);

  // ── Undo ───────────────────────────────────────────────────────────────────
  const saveToUndoStack = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const dataUrl = world.toDataURL('image/png');
    undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), dataUrl];
  }, []);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    const img = new Image();
    img.onload = () => {
      const ctx = getWorldCtx();
      if (!ctx) return;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      ctx.drawImage(img, 0, 0);
      blitViewport();
      scheduleOverlayRedraw();
      scheduleSave();
    };
    img.src = prev;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blitViewport, getWorldCtx, scheduleOverlayRedraw]);

  // ── Snapshot save ──────────────────────────────────────────────────────────
  const saveSnapshot = useCallback(async () => {
    const world = worldRef.current;
    if (!world) return;
    setSaveStatus('saving');
    try {
      const blob: Blob | null = await new Promise((r) => world.toBlob(r, 'image/png'));
      if (!blob) throw new Error('toBlob null');
      const fd = new FormData();
      fd.append('snapshot', blob, 'canvas.png');
      const res = await apiFetchMultipart(`/api/shared-canvas/${connectionId}/snapshot`, fd);
      setSaveStatus(res.ok ? 'saved' : 'unsaved');
      if (res.ok) setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('unsaved');
    }
  }, [connectionId]);

  const scheduleSave = useCallback(() => {
    setSaveStatus('unsaved');
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(saveSnapshot, SAVE_DEBOUNCE_MS);
  }, [saveSnapshot]);

  // ── World ↔ Screen coordinate conversion ──────────────────────────────────
  function screenToWorld(sx: number, sy: number): [number, number] {
    return [
      Math.max(0, Math.min(WORLD_W - 1, sx + panXRef.current)),
      Math.max(0, Math.min(WORLD_H - 1, sy + panYRef.current)),
    ];
  }

  function getEventScreenPos(e: RPointerEvent<HTMLCanvasElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  // ── Shared stroke processor — used by BOTH WebSocket and SSE handlers ───────
  // Deduplication: WS arrives first (~5 ms), SSE arrives ~100 ms later for the
  // same completed stroke.  completedStrokesRef ensures each stroke is drawn
  // to the world canvas exactly once regardless of which transport delivers it.
  const processStroke = useCallback((msg: StrokeMsg) => {
    if (!msg?.strokeId) return;
    // Ignore own echoes (server injects userId on relay)
    if (msg.userId === user?.id) return;

    if (msg.isComplete) {
      // Skip if this stroke was already committed (e.g. arrived via WS first)
      if (completedStrokesRef.current.has(msg.strokeId)) return;
      completedStrokesRef.current.add(msg.strokeId);
      // Prevent unbounded growth — keep last 500 strokeIds
      if (completedStrokesRef.current.size > 500) {
        completedStrokesRef.current.delete(completedStrokesRef.current.values().next().value!);
      }

      const ctx = getWorldCtx();
      if (ctx) drawStrokeOnCtx(ctx, msg);
      partnerStrokesRef.current.delete(msg.strokeId);

      if (msg.points.length > 0) {
        const last = msg.points[msg.points.length - 1];
        partnerCursorRef.current = { x: last[0], y: last[1], name: partnerName };
        if (partnerCursorTimerRef.current) clearTimeout(partnerCursorTimerRef.current);
        partnerCursorTimerRef.current = setTimeout(() => {
          partnerCursorRef.current = null;
          scheduleOverlayRedraw();
        }, 3000);
      }
      blitViewport();
      setHintVisible(false);
    } else {
      // In-progress stroke — skip if stroke was already completed
      if (completedStrokesRef.current.has(msg.strokeId)) return;
      // Take the version with more points (WS and SSE may race)
      const existing = partnerStrokesRef.current.get(msg.strokeId);
      if (!existing || msg.points.length >= existing.points.length) {
        partnerStrokesRef.current.set(msg.strokeId, {
          strokeId: msg.strokeId,
          tool:     msg.tool,
          color:    msg.color,
          size:     msg.size,
          points:   msg.points,
        });
      }
      if (msg.points.length > 0) {
        const last = msg.points[msg.points.length - 1];
        partnerCursorRef.current = { x: last[0], y: last[1], name: partnerName };
      }
    }
    scheduleOverlayRedraw();
  }, [blitViewport, getWorldCtx, partnerName, scheduleOverlayRedraw, user?.id]);

  // ── WebSocket handler — fast path (~5 ms) ─────────────────────────────────
  const handleWsMessage = useCallback((raw: unknown) => {
    processStroke(raw as StrokeMsg);
  }, [processStroke]);

  const { send: wsSend } = useCanvasWebSocket(connectionId, handleWsMessage);

  // ── SSE handler — reliable fallback path (~100 ms) ────────────────────────
  // canvas:stroke events arrive here via HTTP POST → broadcastToConnection.
  // If WS already delivered the stroke, completedStrokesRef deduplicates it.
  const handleSSE = useCallback((event: { type: string; payload: unknown }) => {
    const { type, payload } = event;

    if (type === 'canvas:stroke') {
      processStroke(payload as StrokeMsg);
      return;
    }

    if (type === 'canvas:cleared') {
      const ctx = getWorldCtx();
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      }
      partnerStrokesRef.current.clear();
      currentStrokeRef.current = null;
      undoStackRef.current = [];
      completedStrokesRef.current.clear();
      blitViewport();
      setHintVisible(true);
      scheduleOverlayRedraw();
    }

    // canvas:snapshot_saved — do NOT reload the canvas here.
    // Snapshots are only for initial load (REST GET on mount).
    // Reloading here would overwrite live strokes with a potentially stale/cached PNG.
    // Stroke-by-stroke sync (canvas:stroke via WS + SSE) already keeps both
    // canvases perfectly in sync without any snapshot reload.
  }, [blitViewport, getWorldCtx, processStroke, scheduleOverlayRedraw]);

  useSharedChannel(connectionId, 'shared_canvas', handleSSE);

  // ── Pointer handlers ───────────────────────────────────────────────────────
  const handlePointerDown = useCallback((e: RPointerEvent<HTMLCanvasElement>) => {
    if (dissolved) return;

    setToolbarExpanded(false);
    setShowClearConfirm(false);

    const [sx, sy] = getEventScreenPos(e);

    // Pan tool — or middle mouse button — or shift+drag
    if (toolRef.current === 'pan' || e.button === 1 || e.shiftKey) {
      isPanningRef.current = true;
      panStartRef.current = { x: sx, y: sy, panX: panXRef.current, panY: panYRef.current };
      (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
      return;
    }

    const [wx, wy] = screenToWorld(sx, sy);

    if (toolRef.current === 'fill') {
      const world = worldRef.current;
      if (!world) return;
      saveToUndoStack();
      setHintVisible(false);
      setTimeout(() => {
        floodFill(world, wx, wy, colorRef.current);
        blitViewport();
        scheduleSave();
      }, 10);
      return;
    }

    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    currentStrokeRef.current = {
      strokeId: uid(),
      tool:     toolRef.current,
      color:    colorRef.current,
      size:     brushSizeRef.current,
      points:   [[wx, wy]],
    };
    saveToUndoStack();
    setHintVisible(false);
    scheduleOverlayRedraw();

    // Broadcast the first point immediately
    wsSend({
      strokeId:   currentStrokeRef.current.strokeId,
      tool:       currentStrokeRef.current.tool,
      color:      currentStrokeRef.current.color,
      size:       currentStrokeRef.current.size,
      points:     [[wx, wy]],
      isComplete: false,
    });
  }, [blitViewport, dissolved, saveToUndoStack, scheduleSave, scheduleOverlayRedraw, wsSend]);

  const handlePointerMove = useCallback((e: RPointerEvent<HTMLCanvasElement>) => {
    const [sx, sy] = getEventScreenPos(e);

    // Pan
    if (isPanningRef.current) {
      const { x: startSx, y: startSy, panX: startPanX, panY: startPanY } = panStartRef.current;
      const { w, h } = viewSizeRef.current;
      panXRef.current = Math.max(0, Math.min(WORLD_W - w, startPanX - (sx - startSx)));
      panYRef.current = Math.max(0, Math.min(WORLD_H - h, startPanY - (sy - startSy)));
      blitViewport();
      scheduleOverlayRedraw();
      return;
    }

    if (!isDrawingRef.current || !currentStrokeRef.current) return;

    const [wx, wy] = screenToWorld(sx, sy);
    const stroke = currentStrokeRef.current;
    const prev = stroke.points[stroke.points.length - 1];

    // Skip near-duplicate points to keep payload lean
    if (prev && Math.abs(prev[0] - wx) < 0.5 && Math.abs(prev[1] - wy) < 0.5) return;

    stroke.points.push([wx, wy]);
    scheduleOverlayRedraw();

    const progressMsg = {
      strokeId:   stroke.strokeId,
      tool:       stroke.tool,
      color:      stroke.color,
      size:       stroke.size,
      points:     stroke.points,
      isComplete: false,
    };

    // Fast path: WS on every move (partner sees live drawing with <5 ms delay)
    wsSend(progressMsg);

    // SSE fallback: HTTP POST throttled to ~12 fps so partner sees live preview
    // even when WS is unavailable — no flooding the server
    const now = Date.now();
    if (now - sseProgressThrottleRef.current >= 80) {
      sseProgressThrottleRef.current = now;
      apiFetch(`/api/shared-canvas/${connectionId}/stroke`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...progressMsg, userId: user?.id }),
      }).catch(() => {});
    }
  }, [blitViewport, connectionId, scheduleOverlayRedraw, user?.id, wsSend]);

  const handlePointerUp = useCallback((_e: RPointerEvent<HTMLCanvasElement>) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      return;
    }

    if (!isDrawingRef.current || !currentStrokeRef.current) return;
    isDrawingRef.current = false;

    const stroke = currentStrokeRef.current;

    // Commit completed stroke to world canvas
    const ctx = getWorldCtx();
    if (ctx) drawStrokeOnCtx(ctx, stroke);
    blitViewport();

    // Clear from overlay
    currentStrokeRef.current = null;
    scheduleOverlayRedraw();

    const completedMsg = {
      strokeId:   stroke.strokeId,
      tool:       stroke.tool,
      color:      stroke.color,
      size:       stroke.size,
      points:     stroke.points,
      isComplete: true,
    };

    // Fast path: WebSocket (~5 ms when connected)
    wsSend(completedMsg);

    // Reliable fallback: HTTP POST → SSE broadcast (~100 ms, always works).
    // If WS delivered it first, completedStrokesRef deduplicates on the receiver.
    apiFetch(`/api/shared-canvas/${connectionId}/stroke`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...completedMsg, userId: user?.id }),
    }).catch(() => {});

    scheduleSave();
  }, [blitViewport, connectionId, getWorldCtx, scheduleSave, scheduleOverlayRedraw, user?.id, wsSend]);

  const handlePointerLeave = useCallback(() => {
    if (isDrawingRef.current) handlePointerUp({} as RPointerEvent<HTMLCanvasElement>);
    if (isPanningRef.current) isPanningRef.current = false;
  }, [handlePointerUp]);

  // ── ResizeObserver — viewport & overlay resize, world never changes ────────
  const handleViewportResize = useCallback((newW: number, newH: number) => {
    const vp  = viewportRef.current;
    const ov  = overlayRef.current;
    if (!vp || !ov) return;

    vp.width  = newW;
    vp.height = newH;
    ov.width  = newW;
    ov.height = newH;
    viewSizeRef.current = { w: newW, h: newH };

    // Clamp pan so we don't show outside world bounds
    panXRef.current = Math.max(0, Math.min(WORLD_W - newW, panXRef.current));
    panYRef.current = Math.max(0, Math.min(WORLD_H - newH, panYRef.current));

    // Re-blit — content is untouched because world canvas never resizes
    blitViewport();
    scheduleOverlayRedraw();
  }, [blitViewport, scheduleOverlayRedraw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const w = Math.round(width), h = Math.round(height);
      if (w > 0 && h > 0) {
        setLayoutMode(getLayoutMode(w, h));
        handleViewportResize(w, h);
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [handleViewportResize]);

  // ── Two-finger trackpad scroll → pan (must be non-passive to preventDefault) ─
  useEffect(() => {
    const canvas = viewportRef.current;
    if (!canvas) return;

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const { w, h } = viewSizeRef.current;
      panXRef.current = Math.max(0, Math.min(WORLD_W - w, panXRef.current + e.deltaX));
      panYRef.current = Math.max(0, Math.min(WORLD_H - h, panYRef.current + e.deltaY));
      blitViewport();
      scheduleOverlayRedraw();
    }

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [blitViewport, scheduleOverlayRedraw]);

  // ── Initialise world canvas (once on mount) ────────────────────────────────
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    world.width  = WORLD_W;
    world.height = WORLD_H;
    const ctx = world.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  }, []);

  // ── Load snapshot from backend ─────────────────────────────────────────────
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
        const ctx = getWorldCtx();
        if (!ctx) return;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
        // Draw snapshot at its natural size anchored to top-left of world
        ctx.drawImage(img, 0, 0, WORLD_W, WORLD_H);
        blitViewport();
        setHintVisible(false);
      };
      img.src = data.snapshotUrl;
    }
    load().catch(() => {});
    return () => { cancelled = true; };
  }, [connectionId, blitViewport, getWorldCtx]);

  // ── Keyboard undo ──────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  // ── Cleanup ────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
      if (partnerCursorTimerRef.current) clearTimeout(partnerCursorTimerRef.current);
      if (overlayRafRef.current) cancelAnimationFrame(overlayRafRef.current);
    };
  }, []);

  // ── Canvas clear ───────────────────────────────────────────────────────────
  const clearCanvas = useCallback(async () => {
    const ctx = getWorldCtx();
    if (!ctx) return;
    saveToUndoStack();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    partnerStrokesRef.current.clear();
    currentStrokeRef.current = null;
    undoStackRef.current = [];
    blitViewport();
    setHintVisible(true);
    setShowClearConfirm(false);
    scheduleOverlayRedraw();
    setSaveStatus('idle');
    await apiFetch(`/api/shared-canvas/${connectionId}`, { method: 'DELETE' });
  }, [blitViewport, connectionId, getWorldCtx, saveToUndoStack, scheduleOverlayRedraw]);

  // ── Save to photo frame ────────────────────────────────────────────────────
  const saveToPhotoFrame = useCallback(async () => {
    await saveSnapshot();
    try {
      const res = await apiFetch(`/api/shared-canvas/${connectionId}/save-to-photo-frame`, { method: 'POST' });
      setSavedToPhotoMsg(res.ok ? '✓ Saved to Photo Frame' : 'Add a Photo Frame widget to see it');
    } catch {
      setSavedToPhotoMsg('Save failed — try again');
    }
    setTimeout(() => setSavedToPhotoMsg(null), 4000);
  }, [connectionId, saveSnapshot]);

  // ── Download ───────────────────────────────────────────────────────────────
  const downloadCanvas = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    const a = document.createElement('a');
    a.href = world.toDataURL('image/png');
    a.download = `drawing-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
  }, []);

  // ── Custom color ───────────────────────────────────────────────────────────
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
    if (tool === 'pan')  return 'grab';
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
  const isMicro = layoutMode === 'micro';
  const isSide  = layoutMode === 'expanded'
    && (containerRef.current?.offsetHeight ?? 0) > (containerRef.current?.offsetWidth ?? 0) * 1.2;
  const maxBrushes = isMicro ? BRUSH_SIZES.slice(0, 3) : BRUSH_SIZES;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="sc-widget" ref={containerRef}>
      {/* Hidden world canvas — source of truth, never shown directly */}
      <canvas
        ref={worldRef}
        style={{ display: 'none' }}
      />

      {/* Viewport canvas — 1:1 blit of the pan-offset slice of the world */}
      <canvas
        ref={viewportRef}
        className="sc-canvas-layer"
        style={{ cursor: isPanningRef.current ? 'grabbing' : cursorStyle, zIndex: 1 }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
      />

      {/* Overlay — in-progress strokes + partner cursor */}
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

      {/* Toolbar */}
      <div className={`sc-toolbar-wrap${isSide ? ' side' : ''}`}>

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
              {customColors.map((c) => (
                <button
                  key={`custom-${c}`}
                  className={`sc-swatch${color === c ? ' active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
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
              {([['brush', '🖌️', 'Brush'], ['eraser', '◻️', 'Eraser'], ['fill', '🪣', 'Fill'], ['pan', '✋', 'Pan']] as const).map(([t, icon, label]) => (
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
                  <span>↩️</span><span>Undo</span>
                </button>
                <button className="sc-action-btn danger" onClick={() => setShowClearConfirm(true)} title="Clear canvas">
                  <span>🗑️</span><span>Clear</span>
                </button>
                <button
                  className="sc-action-btn"
                  onClick={saveToPhotoFrame}
                  title="Save as Photo Frame"
                >
                  <span>🖼️</span><span>Photo</span>
                </button>
                <button className="sc-action-btn" onClick={downloadCanvas} title="Download PNG">
                  <span>⬇️</span><span>Save</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Compact pill */}
        <div className={`sc-pill${isMicro ? ' micro' : ''}`}>
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
          {!isMicro && (
            <span style={{ fontSize: 12, lineHeight: 1 }}>
              {tool === 'brush' ? '🖌️' : tool === 'eraser' ? '◻️' : tool === 'fill' ? '🪣' : '✋'}
            </span>
          )}
          <div className={`sc-save-dot ${saveStatus}`} />
          {!isMicro && (
            <button className="sc-pill-btn" onClick={undo} title="Undo (Cmd+Z)">↩</button>
          )}
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

      {savedToPhotoMsg && (
        <div className="sc-toast">
          <div className="sc-toast-pill">🖼️ {savedToPhotoMsg}</div>
        </div>
      )}

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
