-- Sprint 9 Part 16: Research Threads (AI chat upgrade for the Research Notes panel).
-- Do not run automatically. Operator runs via the Supabase dashboard or CLI against ccxfetpzllxkoosvzdzd.
--
-- Extends kira_research_notes (created in 012) rather than a new table: a chat message is the
-- same shape as a plain note (user_id, token_address, content, created_at) plus two additions --
-- is_ai_message distinguishes Kira's replies from the user's own text, and parent_id links a
-- reply back to the question that produced it. Existing plain notes are unaffected: both new
-- columns default to a value that reproduces current behavior (is_ai_message false, parent_id
-- null), so every row written before this migration reads back identically after it.

alter table kira_research_notes
  add column if not exists is_ai_message boolean not null default false,
  add column if not exists parent_id uuid references kira_research_notes(id);

create index if not exists kira_research_notes_parent_idx on kira_research_notes (parent_id);
