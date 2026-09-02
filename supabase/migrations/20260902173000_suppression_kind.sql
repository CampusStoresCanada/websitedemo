-- Distinguish WHY an address is suppressed, so transactional mail can respect
-- dead mailboxes while still ignoring marketing preferences.
--
-- Before this, comms_suppressions said only "don't send commercial mail here".
-- Transactional templates skipped the table entirely (CASL: a member who owes
-- money is told regardless of their marketing preferences). That conflated two
-- unrelated facts: "this person opted out" and "this mailbox does not exist".
-- The second is not a preference and cannot be overridden by legal exemption —
-- mail to a dead address bounces no matter how transactional it is, and every
-- repeat costs sending reputation.
--
--   unsubscribe -> a stated preference. Commercial mail only. Transactional
--                  mail still goes, unchanged.
--   bounce      -> the mailbox is gone (Resend "Permanent"). Blocks EVERYTHING,
--                  transactional included.
--   complaint   -> marked us as spam. Treated as unsubscribe for now: it is a
--                  preference, however emphatic, and transactional mail remains
--                  legally permitted. Split out so this can be revisited
--                  without another backfill.

alter table comms_suppressions
  add column if not exists kind text not null default 'unsubscribe';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comms_suppressions_kind_check'
  ) then
    alter table comms_suppressions
      add constraint comms_suppressions_kind_check
      check (kind in ('unsubscribe', 'bounce', 'complaint'));
  end if;
end $$;

-- Backfill from the free-text reason, which is all we have for existing rows.
-- Measured 2026-09-02 before writing this: 44 rows match bounce, 9 match
-- unsubscribe, 0 match complaint. Complaint is checked first because the
-- webhook writes a distinct string for it and a reason should never satisfy
-- both, but ordering makes the outcome deterministic if one ever does.
update comms_suppressions
set kind = case
  when reason ilike '%complaint%' or reason ilike '%spam%' then 'complaint'
  when reason ilike '%bounce%' then 'bounce'
  else 'unsubscribe'
end
where kind = 'unsubscribe';

comment on column comms_suppressions.kind is
  'unsubscribe = preference (commercial mail only); bounce = dead mailbox (blocks transactional too); complaint = spam report (treated as unsubscribe).';

-- The hot path is "is this address hard-bounced", asked for every send.
create index if not exists comms_suppressions_kind_email_idx
  on comms_suppressions (kind, email);
