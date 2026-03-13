-- ── NEXUS Base Tables ────────────────────────────────────────────────────────
-- Run this first — all other migrations depend on these tables.
-- All tables use auth.users(id) as the foreign key and have RLS enabled.


-- ── user_tokens: OAuth tokens for connected Google / Slack services ───────────
-- Stores per-user, per-provider access & refresh tokens.
-- provider values: 'google', 'google-calendar', 'google-tasks',
--                  'google-docs', 'google-drive', 'slack'
CREATE TABLE IF NOT EXISTS user_tokens (
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider      TEXT        NOT NULL,
  access_token  TEXT        NOT NULL,
  refresh_token TEXT,
  expires_at    BIGINT,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

ALTER TABLE user_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_tokens_owner" ON user_tokens
  FOR ALL USING (auth.uid() = user_id);


-- ── user_layouts: persisted drag-and-drop grid layout per user ────────────────
-- grid is a JSONB map of slot-key → { widgetId, colSpan, rowSpan }
CREATE TABLE IF NOT EXISTS user_layouts (
  user_id    UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  grid       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_layouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_layouts_owner" ON user_layouts
  FOR ALL USING (auth.uid() = user_id);


-- ── user_todos: to-do items for the Todo widget ───────────────────────────────
CREATE TABLE IF NOT EXISTS user_todos (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text       TEXT        NOT NULL,
  completed  BOOLEAN     DEFAULT FALSE,
  priority   TEXT        DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  due_date   DATE,
  due_time   TIME,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_todos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_todos_owner" ON user_todos
  FOR ALL USING (auth.uid() = user_id);


-- ── user_stock_favorites: ticker symbols saved in the Stock widget ────────────
-- symbols is a JSONB array of ticker strings e.g. ["AAPL","TSLA"]
CREATE TABLE IF NOT EXISTS user_stock_favorites (
  user_id    TEXT        PRIMARY KEY,  -- stored as text to match auth.uid()::text
  symbols    JSONB       NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_stock_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_stock_favorites_owner" ON user_stock_favorites
  FOR ALL
  USING     (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);


-- ── user_quick_links: bookmarks shown in the Quick Links widget ───────────────
-- 40 slots per user (slot_index 0–39).
CREATE TABLE IF NOT EXISTS user_quick_links (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slot_index   INTEGER     NOT NULL CHECK (slot_index >= 0 AND slot_index < 40),
  url          TEXT        NOT NULL,
  display_name TEXT        NOT NULL,
  favicon_url  TEXT        NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_user_quick_links_user_id
  ON user_quick_links (user_id);

ALTER TABLE user_quick_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_quick_links_owner" ON user_quick_links
  FOR ALL USING (auth.uid() = user_id);


-- ── user_notes: rich-text notes for the Notes widget ─────────────────────────
CREATE TABLE IF NOT EXISTS user_notes (
  id         UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      TEXT        NOT NULL DEFAULT '',
  content    TEXT        NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_notes_user_id_updated
  ON user_notes (user_id, updated_at DESC);

ALTER TABLE user_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_notes_owner" ON user_notes
  FOR ALL USING (auth.uid() = user_id);
