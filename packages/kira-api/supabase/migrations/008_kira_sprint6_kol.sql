-- Sprint 6 Part 2: user-curated KOL sources + distinguishing global vs personal kira_kol_calls.
-- Renumbered from the sprint prompt's suggested 007 to 008: 007 was already taken by
-- 007_alerts_filter_fk_on_delete_set_null.sql (the bot-delete foreign-key fix from this same
-- sprint's bug report). Do not run automatically. Operator runs via the Supabase dashboard or
-- CLI against ccxfetpzllxkoosvzdzd.

-- source_id was NOT NULL in the original Phase 1 schema (every call belonged to a global house
-- source). A user-specific tracked call has no kira_kol_sources row, only source_user_id, so
-- source_id must become nullable to represent that case.
alter table kira_kol_calls alter column source_id drop not null;
alter table kira_kol_calls add column if not exists source_user_id uuid references kira_profiles(id);
-- null source_user_id = global house-list call, set = user-specific tracked call.

create table if not exists kira_user_kol_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references kira_profiles(id) on delete cascade,
  platform text not null default 'telegram',
  channel_identifier text not null,
  display_name text,
  active boolean not null default true,
  added_at timestamptz not null default now(),
  unique (user_id, platform, channel_identifier)
);
create index if not exists kira_user_kol_sources_user_active_idx on kira_user_kol_sources (user_id, active);
alter table kira_user_kol_sources enable row level security;
