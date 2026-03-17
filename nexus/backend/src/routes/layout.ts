import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';
import { broadcastToUser } from '../lib/sseRegistry.js';

export const layoutRouter = Router();

// GET /api/layout — returns the saved grid for the current user
layoutRouter.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data } = await supabase
    .from('user_layouts')
    .select('grid')
    .eq('user_id', req.user!.id)
    .single();

  res.json({ grid: (data?.grid as Record<string, string>) ?? {} });
});

// PUT /api/layout — upserts the grid for the current user
layoutRouter.put('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { grid } = req.body as { grid: Record<string, string> };

  if (!grid || typeof grid !== 'object') {
    res.status(400).json({ error: 'grid must be an object' });
    return;
  }

  const { error } = await supabase.from('user_layouts').upsert(
    {
      user_id: req.user!.id,
      grid,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    console.error('Layout save error:', error.message);
    res.status(500).json({ error: error.message });
    return;
  }

  // Push the full layout to all other sessions so they can apply it
  // immediately — no extra GET round-trip needed on the receiving end.
  broadcastToUser(req.user!.id, { type: 'layout:update', grid });

  res.json({ success: true });
});
