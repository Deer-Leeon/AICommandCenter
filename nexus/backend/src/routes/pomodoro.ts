import { Router, type Response } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { supabase } from '../lib/supabase.js';

export const pomodoroRouter = Router();

// ── POST /api/pomodoro/sessions ───────────────────────────────────────────────
// Record a completed (or interrupted) focus session.
pomodoroRouter.post('/sessions', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { startedAt, completedAt, durationMinutes, wasInterrupted, attachedTaskId } = req.body;

  if (!startedAt || !completedAt || typeof durationMinutes !== 'number') {
    res.status(400).json({ error: 'startedAt, completedAt, and durationMinutes are required' });
    return;
  }

  const { data, error } = await supabase
    .from('pomodoro_sessions')
    .insert({
      user_id:          userId,
      started_at:       startedAt,
      completed_at:     completedAt,
      duration_minutes: durationMinutes,
      was_interrupted:  wasInterrupted ?? false,
      attached_task_id: attachedTaskId ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('pomodoro insert error:', error);
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json(data);
});

// ── GET /api/pomodoro/stats ───────────────────────────────────────────────────
// Returns stats for the authenticated user:
//   todaySessions    — completed (non-interrupted) sessions today
//   todayMinutes     — total focus minutes today
//   streak           — consecutive calendar days with >= 1 completed session
//   allTimeSessions  — total completed sessions ever
//   allTimeMinutes   — total focus minutes ever
pomodoroRouter.get('/stats', requireAuth, async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  // Fetch all completed (non-interrupted) sessions, newest first.
  // We fetch all to compute streak client-side in JS (simpler than SQL window functions).
  const { data: sessions, error } = await supabase
    .from('pomodoro_sessions')
    .select('completed_at, duration_minutes, was_interrupted')
    .eq('user_id', userId)
    .eq('was_interrupted', false)
    .order('completed_at', { ascending: false });

  if (error) {
    console.error('pomodoro stats error:', error);
    res.status(500).json({ error: error.message });
    return;
  }

  const rows = sessions ?? [];

  // Today in UTC (YYYY-MM-DD)
  const todayUTC = new Date().toISOString().slice(0, 10);

  let todaySessions = 0;
  let todayMinutes  = 0;
  let allTimeSessions = rows.length;
  let allTimeMinutes  = 0;

  for (const row of rows) {
    allTimeMinutes += row.duration_minutes;
    const dayUTC = row.completed_at.slice(0, 10);
    if (dayUTC === todayUTC) {
      todaySessions++;
      todayMinutes += row.duration_minutes;
    }
  }

  // Streak: count consecutive calendar days (UTC) going back from today
  // that each have at least one completed session.
  const daySet = new Set(rows.map(r => r.completed_at.slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);

  // If today has no sessions yet, start streak check from yesterday
  // (so a streak isn't broken just because today hasn't started)
  if (!daySet.has(todayUTC)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  while (true) {
    const dayStr = cursor.toISOString().slice(0, 10);
    if (!daySet.has(dayStr)) break;
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  res.json({
    todaySessions,
    todayMinutes,
    streak,
    allTimeSessions,
    allTimeMinutes,
  });
});
