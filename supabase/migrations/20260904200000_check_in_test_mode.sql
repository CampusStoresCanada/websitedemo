-- Test mode for the conference check-in desk.
--
-- ⛔ The flag is a COLUMN, not a value smuggled into `check_in_source`.
-- `check_in_source` answers "how were they checked in" — qr, manual — which is
-- a real dimension the desk and any later audit still need for a test run.
-- Overloading it would have made every test check-in forget whether it came
-- from a scan or from the name lookup, and would have put "test" in a list
-- where every other entry is a mechanism.
--
-- ⛔ It lives in the DATABASE rather than only in the desk's UI state because
-- the whole risk of a writing test mode is a rehearsal that nobody resets. A
-- flag on the row can be counted and cleaned up by anyone, from any session,
-- long after whoever ran the rehearsal has closed the tab. The desk surfaces
-- that count even when it is NOT in test mode, so leftovers announce
-- themselves instead of quietly inflating the real check-in numbers on day one.

alter table public.conference_people
  add column if not exists check_in_is_test boolean not null default false;

comment on column public.conference_people.check_in_is_test is
  'This check-in was made during a desk rehearsal. Cleared by resetTestCheckIns.';

alter table public.conference_check_in_events
  add column if not exists is_test boolean not null default false;

comment on column public.conference_check_in_events.is_test is
  'Scan event recorded during a desk rehearsal. Deleted by resetTestCheckIns.';

-- Partial indexes: test rows are a small minority and are only ever queried as
-- "show me the leftovers", so the index only needs to cover the true side.
create index if not exists idx_conference_people_check_in_is_test
  on public.conference_people(conference_id)
  where check_in_is_test;

create index if not exists idx_conference_check_in_events_is_test
  on public.conference_check_in_events(conference_id)
  where is_test;
