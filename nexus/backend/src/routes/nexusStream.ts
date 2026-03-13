/**
 * GET /api/stream  — Global per-user SSE channel.
 *
 * Auth: ?token=<supabase_access_token> (EventSource cannot set headers).
 * On connect:
 *   1. Authenticates the token.
 *   2. Registers the response in the global SSE registry.
 *   3. Marks user online in the presence table.
 *   4. Sends a `connections:init` snapshot with all pending/accepted
 *      connections + partner profile info so the client can bootstrap.
 * On disconnect: marks user offline, unregisters from the registry.
 */
import { Router, type Response } from 'express';
import { supabase } from '../lib/supabase.js';
import { registerSSE, unregisterSSE } from '../lib/sseRegistry.js';
import type { AuthRequest } from '../middleware/auth.js';

export const nexusStreamRouter = Router();

nexusStreamRouter.get('/', async (req: AuthRequest, res: Response) => {
  const token = req.query.token as string | undefined;
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) { res.status(401).json({ error: 'Invalid token' }); return; }

  const userId = user.id;

  res.setHeader('Content-Type',     'text/event-stream');
  res.setHeader('Cache-Control',    'no-cache');
  res.setHeader('Connection',       'keep-alive');
  res.setHeader('X-Accel-Buffering','no');
  res.flushHeaders();

  registerSSE(userId, res);

  // Mark online
  await supabase.from('presence').upsert({
    user_id:   userId,
    is_online: true,
    last_seen: new Date().toISOString(),
  });

  // ── Bootstrap: send current connection state ────────────────────────────
  const [connectionsResult, presenceResult] = await Promise.all([
    supabase
      .from('connections')
      .select('*')
      .or(`user_id_a.eq.${userId},user_id_b.eq.${userId}`)
      .in('status', ['pending', 'accepted']),
    supabase
      .from('presence')
      .select('*'),
  ]);

  const connections = connectionsResult.data ?? [];

  // Collect partner user IDs for profile lookup
  const partnerIds = connections.map(c =>
    c.user_id_a === userId ? c.user_id_b : c.user_id_a,
  );
  const uniquePartnerIds = [...new Set(partnerIds)];

  let profiles: Array<{ user_id: string; username: string | null; display_name: string }> = [];
  if (uniquePartnerIds.length > 0) {
    const { data } = await supabase
      .from('profiles')
      .select('user_id, username, display_name')
      .in('user_id', uniquePartnerIds);
    profiles = data ?? [];
  }

  const presenceMap: Record<string, { is_online: boolean; last_seen: string }> = {};
  for (const p of presenceResult.data ?? []) {
    presenceMap[p.user_id] = { is_online: p.is_online, last_seen: p.last_seen };
  }

  res.write(
    `event: connections:init\ndata: ${JSON.stringify({
      type:        'connections:init',
      connections,
      profiles,
      presence:    presenceMap,
    })}\n\n`,
  );

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  const heartbeat = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch { cleanup(); }
  }, 25_000);

  function cleanup() {
    clearInterval(heartbeat);
    unregisterSSE(userId, res);
    try { res.end(); } catch { /* already closed */ }
  }

  req.on('close', cleanup);
  req.on('error', cleanup);
});
