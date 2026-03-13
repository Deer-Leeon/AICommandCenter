import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

export const quickLinksRouter = Router();

interface QuickLinkRow {
  id: string;
  user_id: string;
  slot_index: number;
  url: string;
  display_name: string;
  favicon_url: string;
  created_at: string;
  updated_at?: string;
}

function toClient(row: QuickLinkRow) {
  return {
    slotIndex: row.slot_index,
    url: row.url,
    displayName: row.display_name,
    faviconUrl: row.favicon_url,
  };
}

// GET /api/quick-links
quickLinksRouter.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('user_quick_links')
    .select('*')
    .eq('user_id', req.user!.id)
    .order('slot_index', { ascending: true });

  if (error) {
    // Return empty array if the table doesn't exist yet (table not created in Supabase)
    res.status(error.code === '42P01' ? 200 : 500)
      .json(error.code === '42P01' ? [] : { error: error.message });
    return;
  }

  res.json((data as QuickLinkRow[]).map(toClient));
});

// PUT /api/quick-links — upsert a single slot
quickLinksRouter.put('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { slotIndex, url, displayName, faviconUrl } = req.body as {
    slotIndex: number;
    url: string;
    displayName: string;
    faviconUrl: string;
  };

  if (slotIndex === undefined || slotIndex === null || !url?.trim()) {
    res.status(400).json({ error: 'slotIndex and url are required' });
    return;
  }

  const { data, error } = await supabase
    .from('user_quick_links')
    .upsert(
      {
        user_id: req.user!.id,
        slot_index: slotIndex,
        url: url.trim(),
        display_name: displayName?.trim() || url.trim(),
        favicon_url: faviconUrl || '',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,slot_index' },
    )
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json(toClient(data as QuickLinkRow));
});

// POST /api/quick-links/batch — upsert multiple slots at once (used for drag-to-reorder)
quickLinksRouter.post('/batch', requireAuth, async (req: AuthRequest, res: Response) => {
  const { links } = req.body as {
    links: Array<{ slotIndex: number; url: string; displayName: string; faviconUrl: string }>;
  };

  if (!Array.isArray(links) || links.length === 0) {
    res.status(400).json({ error: 'links array is required' });
    return;
  }

  const rows = links.map(({ slotIndex, url, displayName, faviconUrl }) => ({
    user_id: req.user!.id,
    slot_index: slotIndex,
    url: url.trim(),
    display_name: displayName?.trim() || url.trim(),
    favicon_url: faviconUrl || '',
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('user_quick_links')
    .upsert(rows, { onConflict: 'user_id,slot_index' });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ ok: true });
});

// DELETE /api/quick-links/:slotIndex — remove a single slot
quickLinksRouter.delete('/:slotIndex', requireAuth, async (req: AuthRequest, res: Response) => {
  const slotIndex = parseInt(req.params.slotIndex, 10);

  if (isNaN(slotIndex)) {
    res.status(400).json({ error: 'Invalid slotIndex' });
    return;
  }

  const { error } = await supabase
    .from('user_quick_links')
    .delete()
    .eq('slot_index', slotIndex)
    .eq('user_id', req.user!.id);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(204).send();
});
