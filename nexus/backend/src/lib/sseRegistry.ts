/**
 * Global SSE connection registry.
 *
 * Supports MULTIPLE simultaneous connections per user (e.g. browser + desktop app
 * logged in with the same account). Every connection receives broadcasts.
 *
 * broadcastToUser / broadcastToConnection are the two primitives all
 * shared-widget phases use to deliver server-push events.
 */
import type { Response } from 'express';
import { supabase } from './supabase.js';

// ── In-memory registry ──────────────────────────────────────────────────────
// Map<userId, Set<Response>> — multiple open connections per user
const registry = new Map<string, Set<Response>>();

export function registerSSE(userId: string, res: Response): void {
  if (!registry.has(userId)) {
    registry.set(userId, new Set());
  }
  registry.get(userId)!.add(res);
}

export function unregisterSSE(userId: string, res: Response): void {
  const connections = registry.get(userId);
  if (!connections) return;

  connections.delete(res);

  // Only mark the user offline when every connection is gone
  if (connections.size === 0) {
    registry.delete(userId);
    void supabase
      .from('presence')
      .upsert({ user_id: userId, is_online: false, last_seen: new Date().toISOString() });
  }
}

/**
 * Deliver an event to ALL open connections for a user.
 *
 * We intentionally omit the `event:` line and send a plain `data:` frame so
 * every event is received by the single `EventSource.onmessage` handler on the
 * client without needing a hardcoded list of named event types.
 */
export function broadcastToUser(
  userId: string,
  event: { type: string; [key: string]: unknown },
): void {
  const connections = registry.get(userId);
  if (!connections || connections.size === 0) return;

  const data = `data: ${JSON.stringify(event)}\n\n`;
  const dead: Response[] = [];

  for (const res of connections) {
    try {
      res.write(data);
    } catch {
      dead.push(res);
    }
  }

  // Prune broken connections
  for (const res of dead) connections.delete(res);
  if (connections.size === 0) registry.delete(userId);
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

/** Check if a user currently has at least one open SSE connection. */
export function isUserConnected(userId: string): boolean {
  const connections = registry.get(userId);
  return !!connections && connections.size > 0;
}
