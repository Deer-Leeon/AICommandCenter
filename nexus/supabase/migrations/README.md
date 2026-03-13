# NEXUS — Supabase Migrations

All SQL must be run in the **Supabase SQL Editor** in the numbered order below.
Each file is idempotent where possible (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `ON CONFLICT DO NOTHING`).

---

## Run order

| File | What it creates | Must run before |
|---|---|---|
| `000_base_tables.sql` | `user_tokens`, `user_layouts`, `user_todos`, `user_stock_favorites`, `user_quick_links`, `user_notes` | everything else |
| `001_profiles.sql` | `profiles` table, signup trigger, `get_user_id_by_email()` helper, backfill | — |
| `002_omnibar.sql` | `omnibar_settings`, `omnibar_shortcuts`, `omnibar_history` | `000` |
| `003_typing.sql` | `typing_results`, `typing_personal_bests`, personal-best trigger | `000` |

---

## Table summary

### `user_tokens`
OAuth access + refresh tokens for connected Google services and Slack.  
Primary key: `(user_id, provider)`.  
Provider values: `google`, `google-calendar`, `google-tasks`, `google-docs`, `google-drive`, `slack`.

### `user_layouts`
Persisted grid layout (widget positions and spans) as a JSONB map.  
One row per user, overwritten on each save.

### `user_todos`
To-do items for the Todo widget. Supports priority (`high`/`medium`/`low`) and optional due date/time.

### `user_stock_favorites`
Array of ticker symbols saved in the Stock widget (`["AAPL","TSLA",...]`).

### `user_quick_links`
Bookmarks for the Quick Links widget. 40 slots per user (`slot_index` 0–39).

### `user_notes`
Rich-text notes for the Notes widget. Multiple notes per user, ordered by `updated_at`.

### `profiles`
Core user identity: `username` (globally unique, 3–20 chars, `[a-z0-9_]`),  
`display_name` (from Google account, 1–40 chars).  
Signup trigger creates a row automatically when a new `auth.users` row is inserted.  
Profile is also created lazily by `GET /api/profiles/me` on first login as a safety net.

### `omnibar_settings`
Per-user smart omnibar preferences: default search engine, smart-URL detection,
open-in-new-tab, show suggestions, quick-launch mode.

### `omnibar_shortcuts`
User-defined keyword → URL shortcuts (e.g. `yt` → `youtube.com`).

### `omnibar_history`
Navigation history for Layer 2 autocomplete suggestions.  
Tracks domain, full URL, visit count, and last-visited timestamp.

### `typing_results`
One row per completed typing test. Stores WPM, raw WPM, accuracy, consistency,
error count, and a JSONB array of per-second WPM samples for the results chart.

### `typing_personal_bests`
Fast per-user-per-mode PB lookup table, maintained automatically by the
`trg_typing_update_pb` trigger on every insert into `typing_results`.
Only updates when the new WPM beats the existing record.

---

## Notes

- All tables have **Row Level Security (RLS)** enabled.
- All user data is scoped to `auth.uid()` — users can only read/write their own rows,
  except where a leaderboard `FOR SELECT … USING (true)` policy is explicitly added.
- The `profiles` signup trigger (`fn_create_profile_on_signup`) uses an
  `EXCEPTION WHEN OTHERS THEN RETURN NEW` block so that a trigger failure
  **never blocks a new user from signing up** — the profile is created lazily instead.
