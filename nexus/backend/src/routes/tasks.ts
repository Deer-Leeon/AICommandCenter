import { Router, type Response } from 'express';
import { google } from 'googleapis';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { getTokensForService, getGoogleAuthClient } from '../services/tokenService.js';

export const tasksRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getTasksClient(userId: string) {
  const tokens = await getTokensForService(userId, 'google-tasks');
  if (!tokens) return null;
  const auth = getGoogleAuthClient(tokens);
  return google.tasks({ version: 'v1', auth });
}

// ── GET /api/tasks — list all incomplete tasks ───────────────────────────────

tasksRouter.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const api = await getTasksClient(req.user!.id);
  if (!api) { res.json({ tasks: [], needsAuth: true }); return; }

  try {
    const response = await api.tasks.list({
      tasklist: '@default',
      showCompleted: false,
      maxResults: 100,
    });

    const tasks = (response.data.items ?? []).map((t) => ({
      id: t.id ?? '',
      title: t.title ?? '',
      due: t.due ?? null,       // RFC 3339 from Google — date only (midnight UTC)
      notes: t.notes ?? null,
      status: t.status ?? 'needsAction',
    }));

    res.json({ tasks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list tasks';
    console.error('Tasks GET /:', msg);
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/tasks — create a task ──────────────────────────────────────────

tasksRouter.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const api = await getTasksClient(req.user!.id);
  if (!api) { res.status(401).json({ error: 'Google Tasks not connected', needsAuth: true }); return; }

  const { title, dueDate, notes } = req.body as {
    title: string;
    dueDate?: string;  // YYYY-MM-DD
    notes?: string;
  };

  if (!title?.trim()) {
    res.status(400).json({ error: 'title is required' });
    return;
  }

  try {
    const task = await api.tasks.insert({
      tasklist: '@default',
      requestBody: {
        title: title.trim(),
        notes: notes ?? undefined,
        due: dueDate ? `${dueDate}T00:00:00.000Z` : undefined,
        status: 'needsAction',
      },
    });

    res.status(201).json({
      id: task.data.id ?? '',
      title: task.data.title ?? '',
      due: task.data.due ?? null,
      notes: task.data.notes ?? null,
      status: task.data.status ?? 'needsAction',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create task';
    console.error('Tasks POST /:', msg);
    res.status(500).json({ error: msg });
  }
});

// ── PATCH /api/tasks/:id/complete — mark a task as done ──────────────────────

tasksRouter.patch('/:id/complete', requireAuth, async (req: AuthRequest, res: Response) => {
  const api = await getTasksClient(req.user!.id);
  if (!api) { res.status(401).json({ error: 'Google Tasks not connected', needsAuth: true }); return; }

  try {
    await api.tasks.patch({
      tasklist: '@default',
      task: req.params.id,
      requestBody: { status: 'completed' },
    });
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to complete task';
    console.error('Tasks PATCH complete:', msg);
    res.status(500).json({ error: msg });
  }
});

// ── DELETE /api/tasks/:id — permanently delete a task ─────────────────────────

tasksRouter.delete('/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  const api = await getTasksClient(req.user!.id);
  if (!api) { res.status(401).json({ error: 'Google Tasks not connected', needsAuth: true }); return; }

  try {
    await api.tasks.delete({ tasklist: '@default', task: req.params.id });
    res.status(204).send();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to delete task';
    console.error('Tasks DELETE:', msg);
    res.status(500).json({ error: msg });
  }
});
