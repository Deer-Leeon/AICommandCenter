-- ── Bible Saved Verses ────────────────────────────────────────────────────────
-- Stores each user's personally bookmarked scripture verses.
-- One row per saved verse per user; duplicates prevented by unique constraint.

create table if not exists public.bible_saved_verses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  reference   text not null,
  text        text not null,
  translation text not null default 'kjv',
  saved_at    timestamptz not null default now(),
  unique (user_id, reference, translation)
);

alter table public.bible_saved_verses enable row level security;

create policy "Users can read own saved verses"
  on public.bible_saved_verses for select
  using (auth.uid() = user_id);

create policy "Users can insert own saved verses"
  on public.bible_saved_verses for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own saved verses"
  on public.bible_saved_verses for delete
  using (auth.uid() = user_id);

create index if not exists bible_saved_verses_user_id_idx
  on public.bible_saved_verses (user_id);
