/**
 * canvasWS — WebSocket relay for SharedCanvas real-time strokes.
 *
 * Why WebSocket instead of POST→SSE?
 * HTTP POST + SSE introduces ~50–150 ms of round-trip overhead per stroke.
 * A persistent WebSocket connection relays messages in <5 ms.
 *
 * Protocol:
 *   Client opens:  ws(s)://host/api/canvas-ws?connectionId=X&token=JWT
 *   Server verifies JWT + connection participation once on handshake.
 *   Client sends:  JSON stroke payload  (no userId — server injects it)
 *   Server relays: same JSON + userId injected → every other client in room
 *   Client closes: on unmount / navigation
 *
 * Rooms are keyed by connectionId.  Only ever two participants per room.
 */
import type { Server as HttpServer } from 'http';
import type { IncomingMessage }      from 'http';
import { WebSocketServer, WebSocket }  from 'ws';
import { supabase }                  from './supabase.js';

// ── In-memory room registry ───────────────────────────────────────────────────
// connectionId → Set of open WebSocket connections (max 2)
const rooms = new Map<string, Set<WebSocket>>();
// ws → { connectionId, userId } for lookup on message/close
const meta  = new Map<WebSocket, { connectionId: string; userId: string }>();

// ── Participant cache (same one as sharedCanvas HTTP routes uses) ─────────────
const _participantCache = new Map<string, Set<string>>();

async function verifyParticipant(connectionId: string, userId: string): Promise<boolean> {
  const cached = _participantCache.get(connectionId);
  if (cached) return cached.has(userId);

  const { data } = await supabase
    .from('connections')
    .select('user_id_a, user_id_b')
    .eq('connection_id', connectionId)
    .eq('status', 'accepted')
    .single();

  if (!data) return false;
  const participants = new Set([data.user_id_a, data.user_id_b]);
  _participantCache.set(connectionId, participants);
  return participants.has(userId);
}

// ── Attach to existing HTTP server ────────────────────────────────────────────
export function attachCanvasWS(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  // Intercept only our path prefix — let everything else pass through unchanged
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const urlPath = req.url?.split('?')[0] ?? '';
    if (urlPath !== '/api/canvas-ws') return;
    wss.handleUpgrade(req, socket as never, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    // Parse query params (use a throwaway base so URL ctor works)
    let url: URL;
    try { url = new URL(req.url ?? '', 'http://x'); }
    catch { ws.close(1008, 'Bad request'); return; }

    const connectionId = url.searchParams.get('connectionId') ?? '';
    const token        = url.searchParams.get('token')        ?? '';

    if (!connectionId || !token) { ws.close(1008, 'Missing params'); return; }

    // Verify JWT via Supabase
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) { ws.close(1008, 'Unauthorized'); return; }

    // Verify the user is a participant in this connection
    if (!(await verifyParticipant(connectionId, user.id))) {
      ws.close(1008, 'Forbidden'); return;
    }

    // Register in room
    if (!rooms.has(connectionId)) rooms.set(connectionId, new Set());
    rooms.get(connectionId)!.add(ws);
    meta.set(ws, { connectionId, userId: user.id });

    // ── Message handler: relay to all peers in the room ──────────────────────
    ws.on('message', (buf: Buffer) => {
      const info = meta.get(ws);
      if (!info) return;

      let msg: Record<string, unknown>;
      try { msg = JSON.parse(buf.toString()) as Record<string, unknown>; }
      catch { return; }

      // Inject the sender's userId so the receiver knows whose stroke this is
      const relayPayload = JSON.stringify({ ...msg, userId: info.userId });

      const room = rooms.get(info.connectionId);
      if (!room) return;
      for (const peer of room) {
        if (peer !== ws && peer.readyState === WebSocket.OPEN) {
          peer.send(relayPayload);
        }
      }
    });

    // ── Close: deregister ─────────────────────────────────────────────────────
    ws.on('close', () => {
      const info = meta.get(ws);
      if (!info) return;
      rooms.get(info.connectionId)?.delete(ws);
      if ((rooms.get(info.connectionId)?.size ?? 0) === 0) {
        rooms.delete(info.connectionId);
      }
      meta.delete(ws);
    });

    ws.on('error', () => { try { ws.close(); } catch { /* ignore */ } });
  });
}
