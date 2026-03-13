-- ── shared_todos: real-time collaborative to-do list shared between two connected users ──
-- Each row belongs to a connection, not a user, so both participants read the same data.
-- Row-level security ensures only the two participants in the connection can access rows.

CREATE TABLE IF NOT EXISTS shared_todos (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID        NOT NULL REFERENCES connections(connection_id) ON DELETE CASCADE,
  text          TEXT        NOT NULL,
  completed     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by    UUID        NOT NULL REFERENCES profiles(user_id),
  position      INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shared_todos_connection_id ON shared_todos(connection_id);
CREATE INDEX IF NOT EXISTS shared_todos_created_by    ON shared_todos(created_by);

ALTER TABLE shared_todos ENABLE ROW LEVEL SECURITY;

-- Helper: returns TRUE if the given user is an accepted participant in the connection.
-- SECURITY DEFINER so the function can query the connections table even when called
-- from a row-level policy expression.
CREATE OR REPLACE FUNCTION is_connection_participant(p_connection_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM connections
    WHERE connection_id = p_connection_id
      AND status        = 'accepted'
      AND (user_id_a = p_user_id OR user_id_b = p_user_id)
  )
$$;

-- SELECT: both participants can read all items for their connection
CREATE POLICY "shared_todos_select" ON shared_todos
  FOR SELECT
  USING (is_connection_participant(connection_id, auth.uid()));

-- INSERT: both participants can add items; created_by must be the inserting user
CREATE POLICY "shared_todos_insert" ON shared_todos
  FOR INSERT
  WITH CHECK (
    is_connection_participant(connection_id, auth.uid())
    AND created_by = auth.uid()
  );

-- UPDATE: both participants can edit any item in their connection
CREATE POLICY "shared_todos_update" ON shared_todos
  FOR UPDATE
  USING (is_connection_participant(connection_id, auth.uid()));

-- DELETE: both participants can delete any item in their connection
CREATE POLICY "shared_todos_delete" ON shared_todos
  FOR DELETE
  USING (is_connection_participant(connection_id, auth.uid()));
