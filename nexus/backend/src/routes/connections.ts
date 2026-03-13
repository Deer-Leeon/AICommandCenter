/**
 * /api/connections  — Connection management routes.
 *
 * All routes require the standard `requireAuth` middleware.
 * The backend normalises user_id_a/b so that user_id_a is always the
 * lexicographically smaller UUID — this makes the canonical pair unique.
 */
import { Router, type Response } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { broadcastToUser, broadcastToConnection } from '../lib/sseRegistry.js';

export const connectionsRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise (a, b) so that a < b lexicographically. */
function normalise(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function fetchProfile(userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('user_id, username, display_name')
    .eq('user_id', userId)
    .single();
  return data;
}

// ── POST /api/connections/invite ─────────────────────────────────────────────
connectionsRouter.post('/invite', requireAuth, async (req: AuthRequest, res: Response) => {
  const senderId = req.user!.id;
  const { usernameOrEmail } = req.body as { usernameOrEmail?: string };

  if (!usernameOrEmail?.trim()) {
    res.status(400).json({ error: 'usernameOrEmail is required' });
    return;
  }

  // Look up target user (reuse profile lookup logic)
  const q = usernameOrEmail.trim();
  const isEmail = q.includes('@');
  let targetProfile: { user_id: string; username: string | null; display_name: string } | null = null;

  if (isEmail) {
    const { data: uid } = await supabase.rpc('get_user_id_by_email', { em: q });
    if (uid) {
      const { data } = await supabase
        .from('profiles')
        .select('user_id, username, display_name')
        .eq('user_id', uid)
        .single();
      if (data) targetProfile = data;
    }
  } else {
    const normalized = q.toLowerCase().replace(/^@/, '');
    const { data } = await supabase
      .from('profiles')
      .select('user_id, username, display_name')
      .ilike('username', normalized)
      .maybeSingle();
    if (data) targetProfile = data;
  }

  if (!targetProfile) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (targetProfile.user_id === senderId) {
    res.status(400).json({ error: "You can't connect with yourself" });
    return;
  }

  const [uidA, uidB] = normalise(senderId, targetProfile.user_id);

  // Check for an existing active (pending/accepted) connection
  const { data: existing } = await supabase
    .from('connections')
    .select('connection_id, status')
    .eq('user_id_a', uidA)
    .eq('user_id_b', uidB)
    .in('status', ['pending', 'accepted'])
    .maybeSingle();

  if (existing) {
    if (existing.status === 'accepted') {
      res.status(409).json({ error: 'You are already connected with this user' });
    } else {
      res.status(409).json({ error: 'You already have a pending invite with this user' });
    }
    return;
  }

  // Create the pending connection
  const { data: connection, error } = await supabase
    .from('connections')
    .insert({
      user_id_a:  uidA,
      user_id_b:  uidB,
      status:     'pending',
      invited_by: senderId,
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  // Notify the invitee via SSE if they are online
  const senderProfile = await fetchProfile(senderId);
  broadcastToUser(targetProfile.user_id, {
    type:       'connection:invite_received',
    connection,
    fromProfile: senderProfile,
  });

  res.status(201).json({
    connection,
    targetProfile: {
      userId:      targetProfile.user_id,
      username:    targetProfile.username,
      displayName: targetProfile.display_name,
    },
  });
});

// ── POST /api/connections/:connectionId/accept ────────────────────────────────
connectionsRouter.post('/:connectionId/accept', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId       = req.user!.id;
  const { connectionId } = req.params;

  const { data: conn, error: fetchErr } = await supabase
    .from('connections')
    .select('*')
    .eq('connection_id', connectionId)
    .single();

  if (fetchErr || !conn) { res.status(404).json({ error: 'Connection not found' }); return; }
  if (conn.invited_by === userId) {
    res.status(403).json({ error: 'Only the invited user can accept' });
    return;
  }
  if (conn.user_id_a !== userId && conn.user_id_b !== userId) {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }
  if (conn.status !== 'pending') {
    res.status(400).json({ error: `Cannot accept a connection with status '${conn.status}'` });
    return;
  }

  const { data: updated, error: updateErr } = await supabase
    .from('connections')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('connection_id', connectionId)
    .select()
    .single();

  if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }

  const acceptorProfile = await fetchProfile(userId);
  // Notify the inviter that their invite was accepted
  broadcastToUser(conn.invited_by, {
    type:       'connection:invite_accepted',
    connectionId,
    connection: updated,
    byProfile:  acceptorProfile,
  });
  // Also notify the acceptor's own SSE channel (multi-tab support)
  broadcastToUser(userId, {
    type:       'connection:state_updated',
    connectionId,
    connection: updated,
  });

  res.json({ connection: updated });
});

// ── POST /api/connections/:connectionId/decline ───────────────────────────────
connectionsRouter.post('/:connectionId/decline', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId       = req.user!.id;
  const { connectionId } = req.params;

  const { data: conn, error: fetchErr } = await supabase
    .from('connections')
    .select('*')
    .eq('connection_id', connectionId)
    .single();

  if (fetchErr || !conn) { res.status(404).json({ error: 'Connection not found' }); return; }
  if (conn.invited_by === userId) {
    res.status(403).json({ error: 'Only the invited user can decline' });
    return;
  }
  if (conn.user_id_a !== userId && conn.user_id_b !== userId) {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }
  if (conn.status !== 'pending') {
    res.status(400).json({ error: `Cannot decline a connection with status '${conn.status}'` });
    return;
  }

  await supabase
    .from('connections')
    .update({ status: 'declined' })
    .eq('connection_id', connectionId);

  broadcastToUser(conn.invited_by, {
    type:         'connection:invite_declined',
    connectionId,
  });

  res.json({ success: true });
});

// ── DELETE /api/connections/:connectionId ─────────────────────────────────────
connectionsRouter.delete('/:connectionId', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId       = req.user!.id;
  const { connectionId } = req.params;

  const { data: conn, error: fetchErr } = await supabase
    .from('connections')
    .select('*')
    .eq('connection_id', connectionId)
    .single();

  if (fetchErr || !conn) { res.status(404).json({ error: 'Connection not found' }); return; }
  if (conn.user_id_a !== userId && conn.user_id_b !== userId) {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  await supabase
    .from('connections')
    .update({ status: 'dissolved' })
    .eq('connection_id', connectionId);

  // Cascade is handled by the DB (shared_widget_registry ON DELETE CASCADE)
  const otherId = conn.user_id_a === userId ? conn.user_id_b : conn.user_id_a;
  // Notify the other user
  broadcastToUser(otherId, {
    type:         'connection:dissolved',
    connectionId,
  });
  // Also notify the dissolver's own SSE channel (multi-tab support)
  broadcastToUser(userId, {
    type:         'connection:dissolved',
    connectionId,
  });

  res.json({ success: true });
});

// ── DELETE /api/connections/:connectionId/cancel ──────────────────────────────
// Cancel an outgoing invite (only the inviter can cancel while still pending)
connectionsRouter.delete('/:connectionId/cancel', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId       = req.user!.id;
  const { connectionId } = req.params;

  const { data: conn, error: fetchErr } = await supabase
    .from('connections')
    .select('*')
    .eq('connection_id', connectionId)
    .single();

  if (fetchErr || !conn) { res.status(404).json({ error: 'Connection not found' }); return; }
  if (conn.invited_by !== userId) {
    res.status(403).json({ error: 'Only the inviter can cancel a pending invite' });
    return;
  }
  if (conn.status !== 'pending') {
    res.status(400).json({ error: `Cannot cancel a connection with status '${conn.status}'` });
    return;
  }

  await supabase
    .from('connections')
    .update({ status: 'declined' })
    .eq('connection_id', connectionId);

  const otherId = conn.user_id_a === userId ? conn.user_id_b : conn.user_id_a;
  broadcastToUser(otherId, {
    type:         'connection:invite_cancelled',
    connectionId,
  });

  res.json({ success: true });
});

// ── GET /api/connections ──────────────────────────────────────────────────────
connectionsRouter.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const { data: connections, error } = await supabase
    .from('connections')
    .select('*')
    .or(`user_id_a.eq.${userId},user_id_b.eq.${userId}`)
    .in('status', ['pending', 'accepted']);

  if (error) { res.status(500).json({ error: error.message }); return; }

  const rows = connections ?? [];

  // Collect all partner IDs for profile + presence lookup
  const partnerIds = [...new Set(
    rows.map(c => c.user_id_a === userId ? c.user_id_b : c.user_id_a),
  )];

  const [profilesResult, presenceResult] = await Promise.all([
    partnerIds.length > 0
      ? supabase.from('profiles').select('user_id, username, display_name').in('user_id', partnerIds)
      : Promise.resolve({ data: [] }),
    partnerIds.length > 0
      ? supabase.from('presence').select('*').in('user_id', partnerIds)
      : Promise.resolve({ data: [] }),
  ]);

  const profileMap: Record<string, { userId: string; username: string | null; displayName: string }> = {};
  for (const p of (profilesResult.data ?? [])) {
    profileMap[p.user_id] = { userId: p.user_id, username: p.username, displayName: p.display_name };
  }

  const presenceMap: Record<string, { isOnline: boolean; lastSeen: string }> = {};
  const now = Date.now();
  for (const p of (presenceResult.data ?? [])) {
    const lastSeenMs = new Date(p.last_seen).getTime();
    const isOnline   = p.is_online && (now - lastSeenMs < 60_000);
    presenceMap[p.user_id] = { isOnline, lastSeen: p.last_seen };
  }

  const active   = rows.filter(c => c.status === 'accepted');
  const outgoing = rows.filter(c => c.status === 'pending' && c.invited_by === userId);
  const incoming = rows.filter(c => c.status === 'pending' && c.invited_by !== userId);

  const enrich = (c: typeof rows[0]) => {
    const partnerId = c.user_id_a === userId ? c.user_id_b : c.user_id_a;
    return {
      ...c,
      partner:  profileMap[partnerId] ?? null,
      presence: presenceMap[partnerId] ?? null,
    };
  };

  res.json({
    active:   active.map(enrich),
    outgoing: outgoing.map(enrich),
    incoming: incoming.map(enrich),
  });
});

// ── POST /api/connections/presence ───────────────────────────────────────────
connectionsRouter.post('/presence', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  await supabase.from('presence').upsert({
    user_id:   userId,
    is_online: true,
    last_seen: new Date().toISOString(),
  });

  // Broadcast presence update to all accepted connections
  const { data: conns } = await supabase
    .from('connections')
    .select('connection_id, user_id_a, user_id_b')
    .or(`user_id_a.eq.${userId},user_id_b.eq.${userId}`)
    .eq('status', 'accepted');

  for (const c of conns ?? []) {
    const partnerId = c.user_id_a === userId ? c.user_id_b : c.user_id_a;
    broadcastToUser(partnerId, {
      type:      'presence:update',
      userId,
      isOnline:  true,
      lastSeen:  new Date().toISOString(),
    });
  }

  res.json({ success: true });
});

// ── GET /api/connections/:connectionId/widgets ────────────────────────────────
connectionsRouter.get('/:connectionId/widgets', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId       = req.user!.id;
  const { connectionId } = req.params;

  // Verify participant
  const { data: conn } = await supabase
    .from('connections')
    .select('user_id_a, user_id_b')
    .eq('connection_id', connectionId)
    .eq('status', 'accepted')
    .single();

  if (!conn || (conn.user_id_a !== userId && conn.user_id_b !== userId)) {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  const { data, error } = await supabase
    .from('shared_widget_registry')
    .select('*')
    .eq('connection_id', connectionId);

  if (error) { res.status(500).json({ error: error.message }); return; }

  res.json({ widgets: data ?? [] });
});

// ── POST /api/connections/:connectionId/widgets ───────────────────────────────
connectionsRouter.post('/:connectionId/widgets', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId       = req.user!.id;
  const { connectionId } = req.params;
  const { widgetType, settings } = req.body as { widgetType?: string; settings?: object };

  if (!widgetType) { res.status(400).json({ error: 'widgetType is required' }); return; }

  const { data: conn } = await supabase
    .from('connections')
    .select('user_id_a, user_id_b')
    .eq('connection_id', connectionId)
    .eq('status', 'accepted')
    .single();

  if (!conn || (conn.user_id_a !== userId && conn.user_id_b !== userId)) {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  const { data, error } = await supabase
    .from('shared_widget_registry')
    .insert({ connection_id: connectionId, widget_type: widgetType, settings: settings ?? {}, created_by: userId })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'Widget type already registered for this connection' });
    } else {
      res.status(500).json({ error: error.message });
    }
    return;
  }

  res.status(201).json({ widget: data });
});

// ── DELETE /api/connections/:connectionId/widgets/:widgetType ─────────────────
connectionsRouter.delete('/:connectionId/widgets/:widgetType', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId       = req.user!.id;
  const { connectionId, widgetType } = req.params;

  const { data: conn } = await supabase
    .from('connections')
    .select('user_id_a, user_id_b')
    .eq('connection_id', connectionId)
    .eq('status', 'accepted')
    .single();

  if (!conn || (conn.user_id_a !== userId && conn.user_id_b !== userId)) {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  await supabase
    .from('shared_widget_registry')
    .delete()
    .eq('connection_id', connectionId)
    .eq('widget_type', widgetType);

  res.json({ success: true });
});

// ── POST /api/connections/:connectionId/broadcast ─────────────────────────────
// Used by Phase 2+ shared widgets to send an event to both users via SSE.
connectionsRouter.post('/:connectionId/broadcast', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId       = req.user!.id;
  const { connectionId } = req.params;
  const { type, widgetType, payload } = req.body as {
    type?: string;
    widgetType?: string;
    payload?: object;
  };

  if (!type || !widgetType) {
    res.status(400).json({ error: 'type and widgetType are required' });
    return;
  }

  const { data: conn } = await supabase
    .from('connections')
    .select('user_id_a, user_id_b')
    .eq('connection_id', connectionId)
    .eq('status', 'accepted')
    .single();

  if (!conn || (conn.user_id_a !== userId && conn.user_id_b !== userId)) {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  await broadcastToConnection(connectionId, {
    type,
    connectionId,
    widgetType,
    payload:    payload ?? {},
    sentBy:     userId,
    timestamp:  new Date().toISOString(),
  });

  res.json({ success: true });
});
