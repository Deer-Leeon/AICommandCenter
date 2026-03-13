/**
 * Global SSE connection registry.
 *
 * Stores one active Response object per authenticated user.
 * broadcastToUser / broadcastToConnection are the two primitives all
 * shared-widget phases will use to deliver server-push events.
 */
import type { Response } from 'express';
import { supabase } from './supabase.js';

// ── In-memory registry ─────────────────────────────────────────────────────
// Map<userId, Response>
const registry = new Map<string, Response>();

export function registerSSE(userId: string, res: Response): void {
  // If the user already has a stale connection, close it first
  const existing = registry.get(userId);
  if (existing) {
    try { existing.end(); } catch { /* already closed */ }
  }
  registry.set(userId, res);
}

export function unregisterSSE(userId: string, res: Response): void {
  // Only remove if the stored response is the same object (guards against
  // a race where a new connection registered before the old one cleaned up)
  if (registry.get(userId) === res) {
    registry.delete(userId);
    void supabase
      .from('presence')
      .upsert({ user_id: userId, is_online: false, last_seen: new Date().toISOString() });
  }
}

/** Deliver an event to one user if they have an open SSE connection.
 *
 *  We intentionally omit the `event:` line and send a plain `data:` frame.
 *  This ensures every event — connection, chess, todo, or any future widget —
 *  is received by the single `EventSource.onmessage` handler on the client
 *  without needing to maintain a hardcoded list of named event types.
 */
export function broadcastToUser(
  userId: string,
  event: { type: string; [key: string]: unknown },
): void {
  const res = registry.get(userId);
  if (!res) return;
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    registry.delete(userId);
  }
}

/** Deliver an event to both users of a connection (fire-and-forget). */
export async function broadcastToConnection(
  connectionId: string,
  event: { type: string; [key: string]: unknown },
): Promise<void> {
  const { data } = await supabase
    .from('connections')
    .select('user_id_a, user_id_b')
    .eq('connection_id', connectionId)
    .single();
  if (!data) return;
  broadcastToUser(data.user_id_a, event);
  broadcastToUser(data.user_id_b, event);
}

/** Check if a user currently has an open SSE connection. */
export function isUserConnected(userId: string): boolean {
  return registry.has(userId);
}
