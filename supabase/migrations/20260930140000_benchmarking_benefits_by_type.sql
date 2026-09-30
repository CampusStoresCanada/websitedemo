-- Benefits beside wages, one pair per employment type.
--
-- The single benefits_total assumed a store under a collective agreement could
-- not split it. Put beside the wage column rather than asked as its own
-- question, the split costs nothing to leave blank, and a store that CAN
-- separate it is no longer forced to merge. benefits_total stays as the
-- fallback for stores that only have one number, and is counted only when the
-- per-type rows are empty.

alter table public.benchmarking
  add column if not exists benefits_full_time numeric,
  add column if not exists benefits_part_time numeric,
  add column if not exists benefits_student numeric,
  add column if not exists benefits_seasonal numeric;

comment on column public.benchmarking.benefits_full_time is
  'What the STORE pays toward benefits for this group. Blank where the institution carries it.';
