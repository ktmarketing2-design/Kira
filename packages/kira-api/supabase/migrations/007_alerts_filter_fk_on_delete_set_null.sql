-- Fixes: DELETE /signal-filters/:id fails with a foreign key violation
-- (kira_alerts_filter_id_fkey) whenever the filter has 1+ matching kira_alerts rows, because the
-- original FK from migration 004 (line 49) had no ON DELETE clause and defaulted to NO ACTION.
-- Reproduced live: bot Delete button on a filter with a "match in 24h" silently no-ops (the bot's
-- filterdelete: callback swallows the resulting 500 into a generic toast with no server log),
-- while kira-api logs the real error:
--   update or delete on table "kira_signal_filters" violates foreign key constraint
--   "kira_alerts_filter_id_fkey" on table "kira_alerts"
-- Do not run automatically. Operator runs via the Supabase dashboard or CLI against ccxfetpzllxkoosvzdzd.

alter table kira_alerts
  drop constraint if exists kira_alerts_filter_id_fkey,
  add constraint kira_alerts_filter_id_fkey
    foreign key (filter_id)
    references kira_signal_filters(id)
    on delete set null;
