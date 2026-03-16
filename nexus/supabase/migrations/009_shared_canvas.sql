-- ─────────────────────────────────────────────────────────────────────────────
-- 009_shared_canvas.sql
--
-- Shared Drawing Canvas — one canvas per connection pair.
-- The current snapshot is stored in Supabase Storage as a PNG file.
-- Canvas state is identified by a monotonically-incrementing version counter.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shared_canvas (
  connection_id   UUID        PRIMARY KEY
                      REFERENCES connections(connection_id) ON DELETE CASCADE,
  snapshot_url    TEXT,
  snapshot_path   TEXT,
  last_drawn_by   UUID        REFERENCES profiles(user_id) ON DELETE SET NULL,
  last_drawn_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  version         INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS shared_canvas_last_drawn ON shared_canvas(last_drawn_by);

ALTER TABLE shared_canvas ENABLE ROW LEVEL SECURITY;

-- SELECT: only participants can read
CREATE POLICY "shared_canvas_select" ON shared_canvas
  FOR SELECT USING (is_connection_participant(connection_id, auth.uid()));

-- INSERT: only participants can create
CREATE POLICY "shared_canvas_insert" ON shared_canvas
  FOR INSERT WITH CHECK (is_connection_participant(connection_id, auth.uid()));

-- UPDATE: only participants can update
CREATE POLICY "shared_canvas_update" ON shared_canvas
  FOR UPDATE USING (is_connection_participant(connection_id, auth.uid()));

-- DELETE: only participants can delete
CREATE POLICY "shared_canvas_delete" ON shared_canvas
  FOR DELETE USING (is_connection_participant(connection_id, auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Storage bucket: "shared-canvas"
--
-- Public bucket — snapshots are referenced by public URL in the DB row.
-- The backend service-role key bypasses bucket RLS.
-- Bucket is created programmatically in sharedCanvas.ts on first boot.
-- File path convention: shared-canvas/{connectionId}/canvas.png
-- Uploading always replaces the same path (upsert: true) so only one
-- canvas snapshot ever exists per connection.
-- ─────────────────────────────────────────────────────────────────────────────
