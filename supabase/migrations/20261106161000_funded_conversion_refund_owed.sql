-- A CANCOLL switch and its refund are two steps (2026-11-06).
--
-- The switch moves a paid registration onto the CANCOLL-funded one and can
-- happen any time. The refund to the school still waits for CANCOLL's first
-- invoice to be paid (MOU 5.5), so a switched school can be owed money for
-- weeks. refunded_at is what says it has been paid back: null = still owed.
--
-- refund_cents already holds what is owed; refund_id stays the Stripe refund,
-- null when it was paid back by hand.

alter table public.conference_funded_conversions
  add column if not exists refunded_at timestamptz;

-- Every switch before today refunded in the same step.
update public.conference_funded_conversions
  set refunded_at = created_at
  where refunded_at is null;
