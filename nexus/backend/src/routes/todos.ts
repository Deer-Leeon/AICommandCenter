import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

export const todosRouter = Router();

interface TodoRow {
  id: string;
  user_id: string;
  text: string;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  due_date: string | null;
  due_time: string | null;
  created_at: string;
}

function toClient(row: TodoRow) {
  return {
    id: row.id,
    text: row.text,
    completed: row.completed,
    priority: row.priority,
    dueDate: row.due_date ?? undefined,
    dueTime: row.due_time ?? undefined,
  };
}

// GET /api/todos
todosRouter.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('user_todos')
    .select('*')
    .eq('user_id', req.user!.id)
    .order('completed', { ascending: true })
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json((data as TodoRow[]).map(toClient));
});

// POST /api/todos
todosRouter.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { text, priority = 'medium', dueDate, dueTime } = req.body as {
    text: string;
    priority?: 'low' | 'medium' | 'high';
    dueDate?: string;
    dueTime?: string;
  };

  if (!text?.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const { data, error } = await supabase
    .from('user_todos')
    .insert({
      user_id: req.user!.id,
      text: text.trim(),
      completed: false,
      priority,
      due_date: dueDate ?? null,
      due_time: dueTime ?? null,
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json(toClient(data as TodoRow));
});

// PUT /api/todos/:id
todosRouter.put('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const { text, completed, priority, dueDate, dueTime } = req.body as {
    text?: string;
    completed?: boolean;
    priority?: 'low' | 'medium' | 'high';
    dueDate?: string | null;
    dueTime?: string | null;
  };

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (text !== undefined) updates.text = text.trim();
  if (completed !== undefined) updates.completed = completed;
  if (priority !== undefined) updates.priority = priority;
  if (dueDate !== undefined) updates.due_date = dueDate ?? null;
  if (dueTime !== undefined) updates.due_time = dueTime ?? null;

  const { data, error } = await supabase
    .from('user_todos')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user!.id) // enforce ownership
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json(toClient(data as TodoRow));
});

// DELETE /api/todos/:id
todosRouter.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const { error } = await supabase
    .from('user_todos')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user!.id);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(204).send();
});
