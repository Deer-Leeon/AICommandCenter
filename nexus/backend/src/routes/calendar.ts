import { Router, type Response } from 'express';
import { google } from 'googleapis';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { getTokensForService, getGoogleAuthClient } from '../services/tokenService.js';

export const calendarRouter = Router();

// ── Server-side response cache ────────────────────────────────────────────────
// Caches the Google Calendar API response per user + days window.
// Eliminates the ~200-500 ms Google round-trip on repeated requests within 5 min.
// Invalidated immediately when any event is created, updated, or deleted.

const CALENDAR_CACHE_TTL = 5 * 60_000; // 5 minutes

interface CalendarCacheEntry {
  events: object[];
  expiresAt: number;
}
const calendarCache = new Map<string, CalendarCacheEntry>();

/** Invalidate all cached calendar responses for a given user. */
function burstCalendarCache(userId: string): void {
  for (const key of calendarCache.keys()) {
    if (key.startsWith(`${userId}:`)) calendarCache.delete(key);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

calendarRouter.get('/events', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 14;
    const cacheKey = `${userId}:days=${days}`;

    // Serve from cache when fresh — skips both Supabase token lookup and Google call
    const cached = calendarCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      res.json(cached.events);
      return;
    }

    const tokens = await getTokensForService(userId, 'google-calendar');
    if (!tokens) {
      res.json({ events: [], needsAuth: true });
      return;
    }

    const auth = getGoogleAuthClient(tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    const now = new Date();
    const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20,
    });

    const events = (response.data.items ?? []).map((e) => ({
      id: e.id,
      title: e.summary ?? '(No title)',
      startDateTime: e.start?.dateTime ?? null,
      date: e.start?.date ?? '',
      time: '',
      duration: (() => {
        if (!e.start?.dateTime || !e.end?.dateTime) return 60;
        return Math.round(
          (new Date(e.end.dateTime).getTime() - new Date(e.start.dateTime).getTime()) / 60000
        );
      })(),
      description: e.description ?? '',
      colorId: e.colorId ?? '',
    }));

    calendarCache.set(cacheKey, { events, expiresAt: Date.now() + CALENDAR_CACHE_TTL });
    res.json(events);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch events';
    console.error('Calendar GET /events:', msg);
    res.status(500).json({ error: msg, success: false });
  }
});

calendarRouter.post('/events', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const tokens = await getTokensForService(userId, 'google-calendar');
    if (!tokens) {
      res.status(401).json({ error: 'Google not connected', needsAuth: true });
      return;
    }

    const auth = getGoogleAuthClient(tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    const { title, date, time, duration = 60, description } = req.body as {
      title: string;
      date: string;
      time?: string;
      duration?: number;
      description?: string;
    };

    const startDateTime = new Date(`${date}T${time ?? '09:00'}:00`);
    const endDateTime = new Date(startDateTime.getTime() + duration * 60_000);

    const event = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: title,
        description,
        start: { dateTime: startDateTime.toISOString() },
        end: { dateTime: endDateTime.toISOString() },
      },
    });

    // New event — make next GET return fresh data from Google
    burstCalendarCache(userId);
    res.status(201).json({ success: true, event: event.data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create event';
    console.error('Calendar POST /events:', msg);
    res.status(500).json({ error: msg, success: false });
  }
});

calendarRouter.put('/events/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const tokens = await getTokensForService(userId, 'google-calendar');
    if (!tokens) {
      res.status(401).json({ error: 'Google not connected', needsAuth: true });
      return;
    }

    const auth = getGoogleAuthClient(tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    const existing = await calendar.events.get({
      calendarId: 'primary',
      eventId: req.params.id,
    });

    const updated = await calendar.events.update({
      calendarId: 'primary',
      eventId: req.params.id,
      requestBody: { ...existing.data, ...req.body },
    });

    burstCalendarCache(userId);
    res.json({ success: true, event: updated.data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update event';
    res.status(500).json({ error: msg, success: false });
  }
});

// Create a Google Task from a todo item
calendarRouter.post('/tasks', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const tokens = await getTokensForService(req.user!.id, 'google-tasks');
    if (!tokens) {
      res.status(401).json({ error: 'Google not connected', needsAuth: true });
      return;
    }

    const auth = getGoogleAuthClient(tokens);
    const tasksApi = google.tasks({ version: 'v1', auth });

    const { title, dueDate, dueTime, notes } = req.body as {
      title: string;
      dueDate: string;
      dueTime?: string;
      notes?: string;
      timezone?: string;
    };

    const dueDateISO = `${dueDate}T00:00:00.000Z`;

    const task = await tasksApi.tasks.insert({
      tasklist: '@default',
      requestBody: {
        title: dueTime ? `${title} (${dueTime})` : title,
        notes,
        due: dueDateISO,
        status: 'needsAction',
      },
    });

    res.status(201).json({ success: true, taskId: task.data.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create task';
    console.error('Calendar POST /tasks:', msg);
    if (
      msg.includes('insufficientPermissions') ||
      msg.includes('Request had insufficient authentication scopes') ||
      msg.includes('invalid_grant')
    ) {
      res.status(403).json({ error: 'needsTasksScope' });
      return;
    }
    res.status(500).json({ error: msg, success: false });
  }
});

calendarRouter.delete('/events/:id', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const tokens = await getTokensForService(userId, 'google-calendar');
    if (!tokens) {
      res.status(401).json({ error: 'Google not connected', needsAuth: true });
      return;
    }

    const auth = getGoogleAuthClient(tokens);
    const calendar = google.calendar({ version: 'v3', auth });

    await calendar.events.delete({ calendarId: 'primary', eventId: req.params.id });

    // Deleted event — bust cache so next poll reflects the removal
    burstCalendarCache(userId);
    res.status(204).send();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to delete event';
    res.status(500).json({ error: msg, success: false });
  }
});
