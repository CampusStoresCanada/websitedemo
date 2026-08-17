-- `people` is retired. Everything that referenced it has been repointed at
-- `contacts`: zero foreign keys, zero functions, zero views, zero app code.
--
-- Renamed rather than dropped so anything still reaching for it — a dashboard
-- query, an automation, a script outside this repo — fails loudly instead of
-- silently reading a stale table. Grep cannot see those; this can.
--
-- 30-day observation window starts now. DO NOT DROP without a human decision.

alter table if exists public.people rename to people_deprecated;

comment on table public.people_deprecated is
  'RETIRED 2026-08-17. Superseded by public.contacts, which now carries first_name/last_name/tenant_id and is the single identity record. Renamed (not dropped) for a 30-day observation window so any out-of-band reader fails loudly. Do not build on this table. Drop requires human approval.';
