-- Per-org pause on membership renewal notifications.
--
-- Stops the chase for an org whose payment is genuinely in transit (an EFT
-- sitting in a bank queue, a cheque in the mail) without touching anything
-- else about their membership. The countdown keeps running: grace still
-- starts, the lock still lands on schedule, invoices still exist and still
-- carry a balance. The ONLY thing this suppresses is outbound mail.
--
-- Columns live on `organizations` rather than a side table because both
-- renewal jobs already SELECT from organizations per run — the gate rides
-- along on a query that was happening anyway, instead of adding a lookup
-- per org.
--
-- `paused_until` is NOT NULLABLE-as-forever by design. A pause with no end
-- date stops being a pause and becomes a permanent exemption, because
-- clearing it is nobody's job. The date forces the decision to come back.

alter table organizations
  add column if not exists renewal_notifications_paused_until date,
  add column if not exists renewal_pause_reason text,
  add column if not exists renewal_pause_set_by uuid references auth.users(id) on delete set null,
  add column if not exists renewal_pause_set_at timestamptz;

comment on column organizations.renewal_notifications_paused_until is
  'Inclusive last day on which renewal notification emails are suppressed for this org. NULL = not paused. Suppresses mail only — membership state transitions, invoices and balances are unaffected.';
comment on column organizations.renewal_pause_reason is
  'Why the pause was set, as declared by the admin who set it. Free text, not interpreted by any code path.';
comment on column organizations.renewal_pause_set_by is
  'auth.users id of the admin who set the current pause.';
comment on column organizations.renewal_pause_set_at is
  'When the current pause was set.';

-- Partial index: the jobs ask "is this org paused right now", and the paused
-- set is a handful of rows out of the whole directory.
create index if not exists idx_organizations_renewal_pause
  on organizations (renewal_notifications_paused_until)
  where renewal_notifications_paused_until is not null;
