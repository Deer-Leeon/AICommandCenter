-- ── shared_photos: one active photo per connection ───────────────────────────
-- Only one row ever exists per connection (connection_id is the PRIMARY KEY).
-- Uploading a new photo replaces the row and the old storage file is deleted
-- by the backend before this table is updated.
--
-- Supabase Storage bucket setup (run once via Supabase dashboard or API):
--   Bucket name : shared-photos
--   Public      : true  (files are served via public CDN URL)
--   File size   : 10 MB limit
--   MIME types  : image/*
--
-- Bucket RLS is not enforced on the bucket itself — the backend uses the
-- service role key which bypasses RLS.  Access control lives entirely in the
-- backend's assertParticipant() check.

CREATE TABLE IF NOT EXISTS shared_photos (
  connection_id         UUID        PRIMARY KEY
                                    REFERENCES connections(connection_id) ON DELETE CASCADE,
  photo_url             TEXT        NOT NULL,
  photo_path            TEXT        NOT NULL,   -- storage path for deletion, e.g. "{connId}/{ts}-{rand}.jpg"
  uploaded_by           UUID        NOT NULL
                                    REFERENCES profiles(user_id) ON DELETE CASCADE,
  uploader_username     TEXT,
  uploader_display_name TEXT,
  uploaded_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shared_photos_uploaded_by ON shared_photos(uploaded_by);

ALTER TABLE shared_photos ENABLE ROW LEVEL SECURITY;

-- Participants can view their shared photo
CREATE POLICY "shared_photos_select" ON shared_photos
  FOR SELECT USING (is_connection_participant(connection_id, auth.uid()));

-- Participants can insert (first upload for a connection)
CREATE POLICY "shared_photos_insert" ON shared_photos
  FOR INSERT WITH CHECK (
    is_connection_participant(connection_id, auth.uid())
    AND uploaded_by = auth.uid()
  );

-- Participants can update (replace photo)
CREATE POLICY "shared_photos_update" ON shared_photos
  FOR UPDATE USING (is_connection_participant(connection_id, auth.uid()));

-- Participants can delete (clear photo)
CREATE POLICY "shared_photos_delete" ON shared_photos
  FOR DELETE USING (is_connection_participant(connection_id, auth.uid()));
