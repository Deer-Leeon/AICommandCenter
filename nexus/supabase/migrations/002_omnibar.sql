-- ── Omnibar: per-user search bar settings ───────────────────────────────────
CREATE TABLE IF NOT EXISTS omnibar_settings (
  user_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  search_engine    TEXT    NOT NULL DEFAULT 'google',
  smart_url        BOOLEAN NOT NULL DEFAULT true,
  open_new_tab     BOOLEAN NOT NULL DEFAULT false,
  show_suggestions BOOLEAN NOT NULL DEFAULT true,
  quick_launch     BOOLEAN NOT NULL DEFAULT false,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE omnibar_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "omnibar_settings_owner" ON omnibar_settings
  FOR ALL USING (auth.uid() = user_id);

-- ── Omnibar: per-user keyword shortcuts ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS omnibar_shortcuts (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger    TEXT NOT NULL,
  url        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, trigger)
);
ALTER TABLE omnibar_shortcuts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "omnibar_shortcuts_owner" ON omnibar_shortcuts
  FOR ALL USING (auth.uid() = user_id);

-- ── Omnibar: per-user navigation history ────────────────────────────────────
CREATE TABLE IF NOT EXISTS omnibar_history (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  domain       TEXT NOT NULL,
  url          TEXT NOT NULL,
  visit_count  INTEGER NOT NULL DEFAULT 1,
  last_visited TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, domain)
);
ALTER TABLE omnibar_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "omnibar_history_owner" ON omnibar_history
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_omnibar_history_user_freq
  ON omnibar_history (user_id, visit_count DESC, last_visited DESC);
