-- ─────────────────────────────────────────────────────────────────────────────
-- 004_connections.sql
-- Collaborative infrastructure: connections, presence, shared_widget_registry
-- ─────────────────────────────────────────────────────────────────────────────

-- ── connections ───────────────────────────────────────────────────────────────
-- One row per pair of users. user_id_a is always the lexicographically smaller
-- UUID so the (user_id_a, user_id_b) pair is canonical and a plain UNIQUE index
-- is sufficient to prevent duplicates regardless of invite direction.
CREATE TABLE public.connections (
  connection_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id_a      UUID        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  user_id_b      UUID        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'accepted', 'declined', 'dissolved')),
  invited_by     UUID        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at    TIMESTAMPTZ,

  -- No self-connections
  CONSTRAINT chk_no_self_connection CHECK (user_id_a <> user_id_b),
  -- Canonical order enforced at insert time by the backend
  CONSTRAINT chk_ordered_users      CHECK (user_id_a < user_id_b)
);

-- One active (pending/accepted) connection per pair
CREATE UNIQUE INDEX idx_connections_pair_active
  ON public.connections (user_id_a, user_id_b)
  WHERE status IN ('pending', 'accepted');

-- Fast lookup by either participant
CREATE INDEX idx_connections_user_id_a ON public.connections (user_id_a);
CREATE INDEX idx_connections_user_id_b ON public.connections (user_id_b);
CREATE INDEX idx_connections_status    ON public.connections (status);

ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;

-- Participants can see their own connections
CREATE POLICY connections_participant_select
  ON public.connections FOR SELECT
  USING (auth.uid() = user_id_a OR auth.uid() = user_id_b);

-- Backend (service role) handles inserts; allow participants via RLS too
CREATE POLICY connections_participant_insert
  ON public.connections FOR INSERT
  WITH CHECK (auth.uid() = user_id_a OR auth.uid() = user_id_b);

-- Participants can update their own connections
CREATE POLICY connections_participant_update
  ON public.connections FOR UPDATE
  USING (auth.uid() = user_id_a OR auth.uid() = user_id_b);


-- ── presence ──────────────────────────────────────────────────────────────────
-- One row per user, upserted by the client heartbeat every 30 s.
-- A user is considered online if last_seen > now() - 60 s.
CREATE TABLE public.presence (
  user_id    UUID        PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_online  BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX idx_presence_last_seen ON public.presence (last_seen DESC);

ALTER TABLE public.presence ENABLE ROW LEVEL SECURITY;

-- Users can always see their own presence row
-- Connected users (accepted connection) can see each other's presence
CREATE POLICY presence_self_or_connected_select
  ON public.presence FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.connections c
      WHERE c.status = 'accepted'
        AND (
          (c.user_id_a = auth.uid() AND c.user_id_b = presence.user_id)
          OR
          (c.user_id_b = auth.uid() AND c.user_id_a = presence.user_id)
        )
    )
  );

-- Users manage only their own presence row
CREATE POLICY presence_owner_write
  ON public.presence FOR ALL
  USING   (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ── shared_widget_registry ────────────────────────────────────────────────────
-- Tracks which shared widget types are enabled for a given connection.
-- One row per (connection, widget_type) pair.
-- Cascades on connection delete so dissolving a connection removes all widgets.
CREATE TABLE public.shared_widget_registry (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id  UUID        NOT NULL
                             REFERENCES public.connections(connection_id) ON DELETE CASCADE,
  widget_type    TEXT        NOT NULL,
  settings       JSONB       NOT NULL DEFAULT '{}',
  created_by     UUID        NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT shared_widget_registry_unique_widget UNIQUE (connection_id, widget_type)
);

CREATE INDEX idx_shared_widget_registry_connection
  ON public.shared_widget_registry (connection_id);

ALTER TABLE public.shared_widget_registry ENABLE ROW LEVEL SECURITY;

-- Participants of an accepted connection can read its widget registrations
CREATE POLICY shared_widgets_participant_select
  ON public.shared_widget_registry FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.connections c
      WHERE c.connection_id = shared_widget_registry.connection_id
        AND c.status = 'accepted'
        AND (c.user_id_a = auth.uid() OR c.user_id_b = auth.uid())
    )
  );

-- Participants of an accepted connection can register shared widgets
CREATE POLICY shared_widgets_participant_insert
  ON public.shared_widget_registry FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (
      SELECT 1 FROM public.connections c
      WHERE c.connection_id = shared_widget_registry.connection_id
        AND c.status = 'accepted'
        AND (c.user_id_a = auth.uid() OR c.user_id_b = auth.uid())
    )
  );

-- Either participant can remove a shared widget registration
CREATE POLICY shared_widgets_participant_delete
  ON public.shared_widget_registry FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.connections c
      WHERE c.connection_id = shared_widget_registry.connection_id
        AND c.status = 'accepted'
        AND (c.user_id_a = auth.uid() OR c.user_id_b = auth.uid())
    )
  );
