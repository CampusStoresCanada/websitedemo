-- Three answers that were being made FOR the store.

-- §4: whether a service line is revenue. Some stores run a print desk or a
-- locker programme at cost as a campus obligation — it clears its expenses and
-- nothing more. Counting that as revenue makes the store look bigger and its
-- margin worse, and only the store knows which kind it is.
alter table public.benchmarking_other_income
  add column if not exists counts_as_income boolean not null default true;

comment on column public.benchmarking_other_income.counts_as_income is
  'The store''s own call on whether this line belongs in its revenue for comparison.';

-- §6: wages and benefits, told apart. The wages_* columns held both in one
-- figure, and whether benefits are in it depends on something the store does
-- not control — some institutions pay them centrally and the store never sees
-- the cost, others charge it back. Two stores with identical payroll can differ
-- by a quarter on that alone. Asked as one total plus who pays, because most
-- stores are under a collective agreement covering everybody and cannot split
-- benefits by employment type even if we asked.
alter table public.benchmarking
  add column if not exists benefits_paid_by text,
  add column if not exists benefits_total numeric,
  add column if not exists student_wages_is_contribution boolean not null default true;

comment on column public.benchmarking.benefits_paid_by is
  'Who carries the benefit cost: the store, the institution, or split. The wages_* columns are wages only.';
comment on column public.benchmarking.student_wages_is_contribution is
  'Whether the store counts student wages toward its campus contribution. Its call, not ours.';
