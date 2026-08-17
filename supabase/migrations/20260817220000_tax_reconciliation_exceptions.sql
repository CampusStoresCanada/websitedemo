-- Known-and-accepted tax discrepancies.
--
-- Some gaps are real, permanent, and deliberately not being corrected — the
-- money was collected under an older treatment and nobody is re-billing or
-- refunding a customer over $48. Without somewhere to record that decision the
-- reconciler re-raises the same alert every time a human closes it, and a
-- report that cries wolf is a report people stop reading.
--
-- Deliberately NOT a blanket "ignore this sale" flag: the acknowledged figures
-- are stored alongside, and the reconciler only stays quiet while the
-- discrepancy still looks exactly as it did when it was accepted. If any of
-- the three numbers moves, the sale surfaces again as a new finding.

create table if not exists public.tax_reconciliation_exceptions (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('conference_order', 'prospective_booth')),
  reference text not null,
  expected_tax_cents integer not null,
  charged_tax_cents integer,
  booked_tax_cents integer,
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (source, reference)
);

comment on table public.tax_reconciliation_exceptions is
  'Tax discrepancies a human has reviewed and accepted. quickbooksTaxReconciliationRun skips a sale only while its discrepancy still matches the acknowledged figures exactly.';

alter table public.tax_reconciliation_exceptions enable row level security;

-- Written and read by the reconciler (service role) only; no end-user access.
revoke all on public.tax_reconciliation_exceptions from anon, authenticated;
grant select, insert, update, delete on public.tax_reconciliation_exceptions to service_role;
