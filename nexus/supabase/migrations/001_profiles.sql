-- ── Profiles: minimal user identity (username + display_name) ───────────────────
-- Run this in Supabase SQL Editor. Matches existing schema conventions.
-- DROP first so we always create with the correct schema (fixes partial/legacy runs).
DROP TABLE IF EXISTS profiles CASCADE;

CREATE TABLE profiles (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username     TEXT,
  display_name TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_display_name_len CHECK (length(display_name) >= 1 AND length(display_name) <= 40),
  CONSTRAINT chk_username_format CHECK (
    username IS NULL OR (
      length(username) >= 3 AND length(username) <= 20 AND username ~ '^[a-z0-9_]+$'
    )
  )
);

-- Case-insensitive unique username (Leon, leon, LEON all conflict)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower
  ON profiles (LOWER(username)) WHERE username IS NOT NULL;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read and update only their own full profile
CREATE POLICY "profiles_owner_full" ON profiles
  FOR ALL USING (auth.uid() = user_id);

-- All authenticated users can read user_id, username, display_name of any profile
-- (for invite/lookup and leaderboard)
CREATE POLICY "profiles_authenticated_read_public" ON profiles
  FOR SELECT USING (auth.role() = 'authenticated');

-- No user can modify another user's row (owner policy above handles own-row updates)
-- RLS with FOR ALL + USING (auth.uid() = user_id) already restricts UPDATE/DELETE to own row.

-- ── Triggers on auth.users — drop ALL custom ones ────────────────────────────
--
-- Any AFTER INSERT trigger on auth.users that raises an unhandled exception
-- causes a full transaction rollback. Supabase cannot commit the new user row,
-- cannot write to the audit log, and returns "Database error saving new user"
-- to the OAuth callback — blocking sign-up entirely.
--
-- Two triggers were found and removed:
--
--   1. trg_create_profile_on_signup / fn_create_profile_on_signup
--      Our own trigger added to create the profiles row on sign-up.
--      It failed because auth.uid() is NULL in a trigger context, causing
--      the RLS policy INSERT check to reject the profiles INSERT.
--
--   2. on_auth_user_created / handle_new_user  ← THE REAL CULPRIT
--      A legacy trigger (common in older Supabase tutorials / quickstarts)
--      that was already present in the project before profile work began.
--      It called handle_new_user() which was trying to insert into a table
--      that no longer existed in the correct schema, causing a hard error
--      and rolling back every new user creation silently.
--
-- Profile creation is now handled LAZILY by the backend:
-- GET /api/profiles/me creates the profile row on the user's first API call
-- if it doesn't already exist (PGRST116 / no-row handling in profiles.ts).
--
-- If you ever re-add a trigger here, always wrap the body in:
--   EXCEPTION WHEN OTHERS THEN RAISE WARNING '...'; RETURN NEW;
-- so a trigger failure can NEVER block user sign-up.
DROP TRIGGER IF EXISTS trg_create_profile_on_signup ON auth.users;
DROP FUNCTION IF EXISTS fn_create_profile_on_signup();
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Helper for lookup by email (used by GET /api/profiles/lookup?q=)
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(em TEXT)
RETURNS UUID AS $$
  SELECT id FROM auth.users WHERE LOWER(email) = LOWER(em) LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- Backfill: create profiles for existing auth.users that don't have one
INSERT INTO profiles (user_id, display_name, username)
SELECT
  u.id,
  LEFT(COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''), split_part(u.email, '@', 1), 'User'), 40),
  NULL
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = u.id)
ON CONFLICT (user_id) DO NOTHING;
