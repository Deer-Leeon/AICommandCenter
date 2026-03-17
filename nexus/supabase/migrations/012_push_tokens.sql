-- Push notification device tokens
-- Stores APNs (iOS) and FCM (Android, future) tokens per user/device.
-- One row per physical device; upserted by token value on each app launch.

CREATE TABLE IF NOT EXISTS push_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token       text NOT NULL,
  platform    text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- One row per token; if the same physical device re-registers it just
  -- updates the user association and timestamp.
  UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS push_tokens_user_id_idx ON push_tokens (user_id);

-- Automatically bump updated_at on every update
CREATE OR REPLACE FUNCTION update_push_tokens_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER push_tokens_updated_at
  BEFORE UPDATE ON push_tokens
  FOR EACH ROW EXECUTE PROCEDURE update_push_tokens_updated_at();

-- RLS
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- Users may only read and manage their own tokens
CREATE POLICY "push_tokens: owner select"
  ON push_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "push_tokens: owner insert"
  ON push_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "push_tokens: owner update"
  ON push_tokens FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "push_tokens: owner delete"
  ON push_tokens FOR DELETE
  USING (auth.uid() = user_id);
