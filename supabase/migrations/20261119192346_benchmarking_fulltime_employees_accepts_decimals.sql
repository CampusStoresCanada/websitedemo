-- The survey form and its validation accept a decimal for Full-Time Employees
-- (step 0.1, registry type "number"), but the column was integer, so 19.25 was
-- refused by the database and the store saw "Failed to save field".
-- McMaster hit this on 2026-11-19, the day before the FY2026 survey closed.
-- Widening only: every existing whole number is unchanged. The other staffing
-- columns are already numeric.
alter table public.benchmarking
  alter column fulltime_employees type numeric(8,2);
