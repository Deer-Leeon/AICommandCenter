-- ── NEXUS Typing Widget Schema ────────────────────────────────────────────────
-- Creates both tables and the personal-best trigger in the correct order.
-- Safe to run multiple times (all statements are idempotent).


-- ── 1. typing_results: one row per completed typing test ──────────────────────
CREATE TABLE IF NOT EXISTS typing_results (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,                   -- cached at insert time; updated via profile system
  mode         TEXT        NOT NULL CHECK (mode IN ('15s', '30s', '60s', '120s')),
  content_type TEXT        NOT NULL CHECK (content_type IN ('words', 'quotes', 'code')),
  wpm          NUMERIC     NOT NULL,
  raw_wpm      NUMERIC     NOT NULL,
  accuracy     NUMERIC     NOT NULL,
  consistency  NUMERIC     NOT NULL,
  error_count  INTEGER     NOT NULL DEFAULT 0,
  wpm_history  JSONB       NOT NULL DEFAULT '[]',  -- array of {t, wpm} samples for the chart
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE typing_results ENABLE ROW LEVEL SECURITY;

-- Users can write and read their own results
CREATE POLICY "typing_results_own" ON typing_results
  FOR ALL TO authenticated
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- All authenticated users can read all rows (needed for leaderboard)
CREATE POLICY "typing_results_read_all" ON typing_results
  FOR SELECT TO authenticated
  USING (true);

-- Composite index for date-range leaderboard queries (daily / monthly / all-time)
CREATE INDEX IF NOT EXISTS idx_typing_results_mode_completed_wpm
  ON typing_results (mode, completed_at DESC, wpm DESC);


-- ── 2. typing_personal_bests: fast per-user-per-mode PB lookup ────────────────
-- Maintained automatically by the trigger below; one row per (user_id, mode).
CREATE TABLE IF NOT EXISTS typing_personal_bests (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  mode         TEXT        NOT NULL CHECK (mode IN ('15s', '30s', '60s', '120s')),
  wpm          NUMERIC     NOT NULL,
  raw_wpm      NUMERIC,
  accuracy     NUMERIC,
  consistency  NUMERIC,
  result_id    UUID        REFERENCES typing_results(id) ON DELETE SET NULL,
  achieved_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, mode)
);

ALTER TABLE typing_personal_bests ENABLE ROW LEVEL SECURITY;

-- Users can write and read their own PBs
CREATE POLICY "typing_pbs_own" ON typing_personal_bests
  FOR ALL TO authenticated
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- All authenticated users can read PBs (leaderboard)
CREATE POLICY "typing_pbs_read_all" ON typing_personal_bests
  FOR SELECT TO authenticated
  USING (true);

CREATE INDEX IF NOT EXISTS idx_typing_personal_bests_mode_wpm
  ON typing_personal_bests (mode, wpm DESC);


-- ── 3. Trigger: auto-upsert personal best on every typing result INSERT ───────
-- Fires after each row is inserted into typing_results.
-- Upserts into typing_personal_bests ONLY when the new wpm beats the current PB.
CREATE OR REPLACE FUNCTION fn_update_typing_personal_best()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO typing_personal_bests
    (user_id, display_name, mode, wpm, raw_wpm, accuracy, consistency,
     result_id, achieved_at, updated_at)
  VALUES
    (NEW.user_id, NEW.display_name, NEW.mode, NEW.wpm, NEW.raw_wpm, NEW.accuracy,
     NEW.consistency, NEW.id, NEW.completed_at, now())
  ON CONFLICT (user_id, mode) DO UPDATE
    SET wpm          = EXCLUDED.wpm,
        raw_wpm      = EXCLUDED.raw_wpm,
        accuracy     = EXCLUDED.accuracy,
        consistency  = EXCLUDED.consistency,
        display_name = EXCLUDED.display_name,
        result_id    = EXCLUDED.result_id,
        achieved_at  = EXCLUDED.achieved_at,
        updated_at   = now()
    WHERE typing_personal_bests.wpm < EXCLUDED.wpm;  -- only update on new PB

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_typing_update_pb ON typing_results;

CREATE TRIGGER trg_typing_update_pb
  AFTER INSERT ON typing_results
  FOR EACH ROW EXECUTE FUNCTION fn_update_typing_personal_best();
