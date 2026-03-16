/**
 * useCanvasWebSocket — persistent WebSocket connection for real-time canvas strokes.
 *
 * Why not POST→SSE?
 *   HTTP POST+SSE adds ~50–150 ms round-trip overhead per stroke.
 *   A persistent WebSocket relays messages in <5 ms — drawing feels instantaneous.
 *
 * Features:
 *   - Authenticates once on open (JWT token as URL param — standard for WS)
 *   - Auto-reconnects on disconnect (2 s backoff)
 *   - Queues outbound messages while connecting — nothing is lost
 *   - Stable `send` reference (useCallback) — no unnecessary re-renders
 */
import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Derive WS base from the same env var the HTTP client uses.
// "https://..." → "wss://..." and "http://..." → "ws://..."
const HTTP_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined
  ?? 'https://nexus-api.lj-buchmiller.com';
const WS_BASE = HTTP_BASE.replace(/^http/, 'ws');

type OnMessage = (msg: unknown) => void;

export function useCanvasWebSocket(
  connectionId: string,
  onMessage: OnMessage,
) {
  const wsRef       = useRef<WebSocket | null>(null);
  const queueRef    = useRef<string[]>([]);
  const onMsgRef    = useRef<OnMessage>(onMessage);
  const cancelledRef = useRef(false);

  // Keep the callback ref current without restarting the connection on every render
  useEffect(() => { onMsgRef.current = onMessage; }, [onMessage]);

  const send = useCallback((data: unknown) => {
    const str = JSON.stringify(data);
    const ws  = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(str);
    } else {
      // Buffer until the connection opens — typically only the first 1-2 strokes
      queueRef.current.push(str);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      if (cancelledRef.current) return;

      // Get a fresh token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // Not authenticated — retry after backoff
        reconnectTimer = setTimeout(connect, 3000);
        return;
      }

      const url = `${WS_BASE}/api/canvas-ws?connectionId=${encodeURIComponent(connectionId)}&token=${session.access_token}`;
      const ws  = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        // Flush any messages queued before the connection was ready
        for (const msg of queueRef.current) ws.send(msg);
        queueRef.current = [];
      };

      ws.onmessage = (ev) => {
        try { onMsgRef.current(JSON.parse(ev.data as string)); }
        catch { /* malformed JSON — ignore */ }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!cancelledRef.current) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        try { ws.close(); } catch { /* ignore */ }
      };
    }

    connect();

    return () => {
      cancelledRef.current = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connectionId]); // reconnect only if connectionId changes

  return { send };
}
