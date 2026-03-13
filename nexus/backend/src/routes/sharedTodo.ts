/**
 * /api/shared-todo — Shared to-do list routes.
 *
 * All mutations broadcast via SSE to both participants so the other user's
 * widget updates instantly without polling.
 */
import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { broadcastToConnection } from '../lib/sseRegistry.js';

export const sharedTodoRouter = Router();

interface SharedTodoRow {
  id:            string;
  connection_id: string;
  text:          string;
  completed:     boolean;
  created_by:    string;
  position:      number;
  created_at:    string;
  updated_at:    string;
}

function toClient(row: SharedTodoRow) {
  return {
    id:           row.id,
    connectionId: row.connection_id,
    text:         row.text,
    completed:    row.completed,
    createdBy:    row.created_by,
    position:     row.position,
    createdAt:    row.created_at,
  };
}

async function assertParticipant(connectionId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('connections')
    .select('user_id_a, user_id_b')
    .eq('connection_id', connectionId)
    .eq('status', 'accepted')
    .single();
  if (!data) return false;
  return data.user_id_a === userId || data.user_id_b === userId;
}

// ── GET /api/shared-todo/:connectionId ────────────────────────────────────────
sharedTodoRouter.get('/:connectionId', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId       = req.user!.id;
  const { connectionId } = req.params;

  if (!(await assertParticipant(connectionId, userId))) {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  const { data, error } = await supabase
    .from('shared_todos')
    .select('*')
    .eq('connection_id', connectionId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) { res.status(500).json({ error: error.message }); return; }

  res.json((data as SharedTodoRow[]).map(toClient));
});

// ── POST /api/shared-todo/:connectionId ───────────────────────────────────────
sharedTodoRouter.post('/:connectionId', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId       = req.user!.id;
  const { connectionId } = req.params;
  const { text, position = 0 } = req.body as { text?: string; position?: number };

  if (!text?.trim()) { res.status(400).json({ error: 'text is required' }); return; }

  if (!(await assertParticipant(connectionId, userId))) {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  const { data, error } = await supabase
    .from('shared_todos')
    .insert({
      connection_id: connectionId,
      text:          text.trim(),
      completed:     false,
      created_by:    userId,
      position,
    })
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }

  const item = toClient(data as SharedTodoRow);

  await broadcastToConnection(connectionId, {
    type:       'todo:item_added',
    connectionId,
    widgetType: 'shared_todo',
    payload:    item,
    sentBy:     userId,
    timestamp:  new Date().toISOString(),
  });

  res.status(201).json(item);
});

// ── PATCH /api/shared-todo/:connectionId/:itemId ──────────────────────────────
sharedTodoRouter.patch('/:connectionId/:itemId', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId       = req.user!.id;
  const { connectionId, itemId } = req.params;
  const { text, completed, position } = req.body as {
    text?: string;
    completed?: boolean;
    position?: number;
  };

  if (!(await assertParticipant(connectionId, userId))) {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (text      !== undefined) updates.text      = text.trim();
  if (completed !== undefined) updates.completed = completed;
  if (position  !== undefined) updates.position  = position;

  const { data, error } = await supabase
    .from('shared_todos')
    .update(updates)
    .eq('id', itemId)
    .eq('connection_id', connectionId)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }

  const item = toClient(data as SharedTodoRow);

  await broadcastToConnection(connectionId, {
    type:       'todo:item_updated',
    connectionId,
    widgetType: 'shared_todo',
    payload:    item,
    sentBy:     userId,
    timestamp:  new Date().toISOString(),
  });

  res.json(item);
});

// ── DELETE /api/shared-todo/:connectionId/:itemId ─────────────────────────────
sharedTodoRouter.delete('/:connectionId/:itemId', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId       = req.user!.id;
  const { connectionId, itemId } = req.params;

  if (!(await assertParticipant(connectionId, userId))) {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  const { error } = await supabase
    .from('shared_todos')
    .delete()
    .eq('id', itemId)
    .eq('connection_id', connectionId);

  if (error) { res.status(500).json({ error: error.message }); return; }

  await broadcastToConnection(connectionId, {
    type:       'todo:item_deleted',
    connectionId,
    widgetType: 'shared_todo',
    payload:    { itemId },
    sentBy:     userId,
    timestamp:  new Date().toISOString(),
  });

  res.status(204).send();
});

// ── PATCH /api/shared-todo/:connectionId/reorder ─────────────────────────────
// Accepts a full ordered array of item IDs and updates positions atomically.
sharedTodoRouter.patch('/:connectionId/reorder', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId       = req.user!.id;
  const { connectionId } = req.params;
  const { orderedIds } = req.body as { orderedIds?: string[] };

  if (!Array.isArray(orderedIds)) {
    res.status(400).json({ error: 'orderedIds must be an array' });
    return;
  }

  if (!(await assertParticipant(connectionId, userId))) {
    res.status(403).json({ error: 'Unauthorized' });
    return;
  }

  // Update each item's position in parallel
  await Promise.all(
    orderedIds.map((id, idx) =>
      supabase
        .from('shared_todos')
        .update({ position: idx, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('connection_id', connectionId),
    ),
  );

  await broadcastToConnection(connectionId, {
    type:       'todo:reordered',
    connectionId,
    widgetType: 'shared_todo',
    payload:    { orderedIds },
    sentBy:     userId,
    timestamp:  new Date().toISOString(),
  });

  res.json({ success: true });
});
