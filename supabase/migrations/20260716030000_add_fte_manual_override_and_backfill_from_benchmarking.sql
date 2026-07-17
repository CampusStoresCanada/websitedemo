-- Track whether organizations.fte was explicitly set by an admin (sticky
-- until the next benchmarking submission) vs. synced from the org's latest
-- benchmarking enrollment_fte (the normal, refreshed-every-cycle case).
alter table organizations
  add column fte_is_manual_override boolean not null default false;

-- One-time backfill: organizations.fte had drifted stale/wrong relative to
-- each org's latest confirmed benchmarking submission (e.g. Algonquin College
-- showed fte=12 instead of their real 20169 enrollment_fte from FY2025).
-- Since fte_is_manual_override defaults false for every existing row, this
-- sync applies to all of them uniformly.
with latest_benchmarking as (
  select distinct on (organization_id)
    organization_id,
    enrollment_fte
  from benchmarking
  where enrollment_fte is not null
  order by organization_id, fiscal_year desc, created_at desc
)
update organizations o
set fte = lb.enrollment_fte,
    updated_at = now()
from latest_benchmarking lb
where lb.organization_id = o.id
  and o.fte_is_manual_override = false
  and (o.fte is distinct from lb.enrollment_fte);
