import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

export const notesRouter = Router();

interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

function toClient(row: NoteRow) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/notes — list all for user, newest first
notesRouter.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('user_notes')
    .select('*')
    .eq('user_id', req.user!.id)
    .order('updated_at', { ascending: false });

  if (error) {
    // Gracefully return empty array if table not yet created
    res.status(error.code === '42P01' ? 200 : 500)
      .json(error.code === '42P01' ? [] : { error: error.message });
    return;
  }

  res.json((data as NoteRow[]).map(toClient));
});

// POST /api/notes — create a new note
notesRouter.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { title = '', content = '' } = req.body as { title?: string; content?: string };

  const { data, error } = await supabase
    .from('user_notes')
    .insert({
      user_id: req.user!.id,
      title: title.trim(),
      content,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json(toClient(data as NoteRow));
});

// PUT /api/notes/:id — update title and/or content
notesRouter.put('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const { title, content } = req.body as { title?: string; content?: string };

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (title !== undefined) updates.title = title.trim();
  if (content !== undefined) updates.content = content;

  const { data, error } = await supabase
    .from('user_notes')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user!.id)
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json(toClient(data as NoteRow));
});

// DELETE /api/notes/:id
notesRouter.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const { error } = await supabase
    .from('user_notes')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user!.id);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(204).send();
});
