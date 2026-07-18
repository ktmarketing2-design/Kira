-- Sprint 8 Part 5: Research Notes (lightweight version).
-- Do not run automatically. Operator runs via the Supabase dashboard or CLI against ccxfetpzllxkoosvzdzd.
--
-- Own migration file rather than bundled into 011, matching this project's convention of one
-- migration per shipped unit of work (011 was scoped to just the Watchlist table for the same
-- reason).

create table kira_research_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kira_profiles(id) on delete cascade,
  token_address text not null,
  content text not null,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on kira_research_notes (user_id, token_address, created_at desc);
alter table kira_research_notes enable row level security;
