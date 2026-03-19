/**
 * nexusSSE — global singleton SSE connection manager.
 *
 * Creates ONE EventSource for the entire app. All useSharedChannel /
 * usePresence / useConnections hooks subscribe to this single connection
 * and filter events by type, connectionId, or widgetType.
 *
 * Responsibilities:
 *  - Maintain a single authenticated SSE connection to GET /api/stream
 *  - Reconnect automatically with exponential backoff on failure
 *  - Run the presence heartbeat (POST /api/connections/presence every 30 s)
 *  - Dispatch incoming events to registered listeners
 */

import { supabase } from './supabase';
import { apiFetch } from './api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface NexusSSEEvent {
  type: string;
  [key: string]: unknown;
}

type Listener = (event: NexusSSEEvent) => void;

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string) ?? 'https://nexus-api.lj-buchmiller.com';

// ── Singleton class ────────────────────────────────────────────────────────

class NexusSSEManager {
  private es: EventSource | null = null;
  private listeners              = new Set<Listener>();
  private reconnectTimer: ReturnType<typeof setTimeout>  | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelay = 1_000;   // ms — doubles on each failure, max 30 s
  private stopped        = false;
  private connectionCount = 0;      // 0 = never connected, >0 = has connected before

  // ── Public API ─────────────────────────────────────────────────────────

  /** Call once on app mount (after the user is signed in). */
  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
    this.startHeartbeat();
  }

  /** Call on app unmount / sign-out. */
  stop(): void {
    this.stopped = true;
    this.closeConnection();
    this.stopHeartbeat();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  /**
   * Subscribe to all incoming SSE events.
   * Returns an unsubscribe function — call it in useEffect cleanup.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Connection management ───────────────────────────────────────────────

  private async connect(): Promise<void> {
    if (this.stopped) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    const url = `${API_BASE}/api/stream?token=${encodeURIComponent(session.access_token)}`;

    this.closeConnection();
    const es = new EventSource(url);
    this.es  = es;

    // All broadcast events (chess, todo, connections, presence, …) arrive as
    // plain data frames with no `event:` line — onmessage handles all of them.
    es.onmessage = (e) => this.dispatch(e.data);

    // The stream endpoint sends `connections:init` as a named event (it writes
    // `event: connections:init` directly), so we keep one named listener for it.
    es.addEventListener('connections:init', (e: Event) => {
      this.dispatch((e as MessageEvent).data);
    });

    es.onopen = () => {
      this.reconnectDelay = 1_000; // reset on success
      this.connectionCount++;
      if (this.connectionCount > 1) {
        // This is a re-connect — tell every subscriber to re-sync their state.
        // We dispatch synchronously before any buffered data events arrive so
        // widgets can issue a REST re-fetch and fill any gap from the outage.
        this.dispatch(JSON.stringify({ type: 'nexus:reconnected' }));
      }
    };

    es.onerror = () => {
      this.closeConnection();
      if (!this.stopped) this.scheduleReconnect();
    };
  }

  private closeConnection(): void {
    if (this.es) {
      this.es.onmessage = null;
      this.es.onerror   = null;
      try { this.es.close(); } catch { /* already closed */ }
      this.es = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat();
    // Fire immediately, then every 30 s
    this.sendHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private sendHeartbeat(): void {
    apiFetch('/api/connections/presence', { method: 'POST' }).catch(() => {});
  }

  // ── Event dispatch ─────────────────────────────────────────────────────

  private dispatch(raw: string): void {
    try {
      const event = JSON.parse(raw) as NexusSSEEvent;
      for (const listener of this.listeners) {
        try { listener(event); } catch { /* isolate listener errors */ }
      }
    } catch { /* malformed JSON — ignore */ }
  }
}

export const nexusSSE = new NexusSSEManager();

/**
 * Stable per-tab identifier, generated once when this module is loaded.
 * Stamped on every layout PUT so the SSE echo that bounces back from the
 * server can be recognised and ignored — preventing the "brief snap to
 * old state" flicker that occurred when setPages() was called mid-drag.
 */
export const nexusSessionId: string = crypto.randomUUID();
