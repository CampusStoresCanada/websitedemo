-- The date the meeting schedule is published and stops being re-solved.
--
-- Until now this existed only as "18 January" written into code comments, which
-- meant nothing in the system could tell whether it was before or after the
-- freeze. That is the difference between running the full search (correct in
-- December) and running a late add (correct in late January), and it was being
-- decided by whoever happened to be at the keyboard.
--
-- Nullable on purpose: a conference with no freeze date has not set one, which
-- is not the same as one whose freeze is today. Readers must treat NULL as
-- "not frozen" rather than defaulting it to a date.
--
-- ⚠️ Registration closes 2027-01-31 but the schedule freezes 2027-01-18, so
-- there are 13 days every year when somebody can legitimately register and
-- land with no meetings. That window is the reason late-add exists.
--
-- ⚠️ Filename version matches the applied ledger entry (20260908214113)
-- deliberately. Migrations applied through the MCP tool are stamped with their
-- own timestamp, so a hand-picked filename drifts from what the database
-- recorded and a future `supabase db push` believes the migration is unapplied.
alter table conference_instances
  add column if not exists schedule_freeze_at timestamptz;

comment on column conference_instances.schedule_freeze_at is
  'When the meeting schedule is published and stops being re-solved. After this, a late registrant is seated by the additive late-add path (join an existing meeting, or open one with another latecomer) rather than by re-running the search, which would move people who have already been told their day. NULL means no freeze has been set.';
