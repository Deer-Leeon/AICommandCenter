-- ── shared_chess: one active chess game per connection ────────────────────────
-- Full game state stored as FEN. Both participants in the connection can read
-- and update. The is_connection_participant helper (defined in 005) is reused;
-- CREATE OR REPLACE means this file is safe to apply even if it already exists.

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

CREATE TABLE IF NOT EXISTS shared_chess (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID        NOT NULL UNIQUE
                            REFERENCES connections(connection_id) ON DELETE CASCADE,
  board_fen     TEXT        NOT NULL
                            DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  white_user_id UUID        REFERENCES profiles(user_id),
  black_user_id UUID        REFERENCES profiles(user_id),
  current_turn  TEXT        NOT NULL DEFAULT 'white'
                            CHECK (current_turn IN ('white', 'black')),
  status        TEXT        NOT NULL DEFAULT 'waiting'
                            CHECK (status IN ('waiting', 'active', 'white_wins',
                                              'black_wins', 'draw', 'stalemate')),
  move_history  JSONB       NOT NULL DEFAULT '[]',
  last_move     JSONB,      -- { from: string, to: string }
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shared_chess_connection_id ON shared_chess(connection_id);
CREATE INDEX IF NOT EXISTS shared_chess_white         ON shared_chess(white_user_id);
CREATE INDEX IF NOT EXISTS shared_chess_black         ON shared_chess(black_user_id);

ALTER TABLE shared_chess ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shared_chess_select" ON shared_chess
  FOR SELECT USING (is_connection_participant(connection_id, auth.uid()));

CREATE POLICY "shared_chess_insert" ON shared_chess
  FOR INSERT WITH CHECK (is_connection_participant(connection_id, auth.uid()));

CREATE POLICY "shared_chess_update" ON shared_chess
  FOR UPDATE USING (is_connection_participant(connection_id, auth.uid()));

CREATE POLICY "shared_chess_delete" ON shared_chess
  FOR DELETE USING (is_connection_participant(connection_id, auth.uid()));
