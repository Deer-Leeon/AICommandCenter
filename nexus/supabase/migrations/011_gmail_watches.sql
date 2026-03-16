create table if not exists public.gmail_watches (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  history_id   text not null,
  expiration   bigint not null,
  created_at   timestamptz not null default now()
);

alter table public.gmail_watches enable row level security;

create policy "Users can read own gmail watch"
  on public.gmail_watches for select
  using (auth.uid() = user_id);

create policy "Users can insert own gmail watch"
  on public.gmail_watches for insert
  with check (auth.uid() = user_id);

create policy "Users can update own gmail watch"
  on public.gmail_watches for update
  using (auth.uid() = user_id);

create policy "Users can delete own gmail watch"
  on public.gmail_watches for delete
  using (auth.uid() = user_id);
