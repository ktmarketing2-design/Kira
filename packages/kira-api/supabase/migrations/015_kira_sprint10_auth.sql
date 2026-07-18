-- Sprint 10 Part 4: Auth System (Telegram Login Widget + account linking).
-- Do not run automatically. Operator runs via the Supabase dashboard or CLI against ccxfetpzllxkoosvzdzd.
--
-- The build prompt suggested adding link_code / link_code_expires_at directly to kira_profiles,
-- but kira_link_codes (from migration 001) already stores exactly this shape generically
-- (code, user_id, expires_at, used) and is already the mechanism the bot's /start command uses
-- for its own linking flow. Adding a second, parallel code-storage mechanism on kira_profiles
-- would fragment linking state across two places for no benefit -- reusing kira_link_codes here
-- instead, extended with two nullable columns for the one new case it doesn't already cover:
-- an email-initiated link (started from the bot's /link {email} command) needs to remember which
-- Telegram identity is pending attachment before the target web account is even known/confirmed,
-- since kira_link_codes.user_id is NOT NULL and can't hold that until the email is verified.

alter table kira_link_codes
  add column if not exists telegram_user_id_pending bigint,
  add column if not exists telegram_username_pending text;
