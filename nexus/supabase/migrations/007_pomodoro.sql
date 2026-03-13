-- ── Pomodoro Sessions ────────────────────────────────────────────────────────
-- Stores one row per completed (or interrupted) focus session.
-- Breaks are not recorded — only focus sessions count toward stats.

CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  started_at       TIMESTAMPTZ NOT NULL,
  completed_at     TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER     NOT NULL,
  was_interrupted  BOOLEAN     NOT NULL DEFAULT FALSE,
  attached_task_id TEXT,       -- optional ref to user_todos.id (no FK — todos can be deleted)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pomodoro_sessions_user_id_idx
  ON pomodoro_sessions (user_id);

CREATE INDEX IF NOT EXISTS pomodoro_sessions_completed_at_idx
  ON pomodoro_sessions (user_id, completed_at DESC);

ALTER TABLE pomodoro_sessions ENABLE ROW LEVEL SECURITY;

-- Users can only see and modify their own sessions
CREATE POLICY "pomodoro_sessions_own"
  ON pomodoro_sessions
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
