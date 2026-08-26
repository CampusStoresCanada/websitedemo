-- The Articles fix a RANGE (7 to 9 for CSC); the members then fix the actual
-- number within it by Ordinary Resolution (By-Law Part IV S1). The Nominating
-- Committee Report states the range verbatim every year, so it belongs on the
-- body rather than being retyped.
alter table public.governance_bodies
  add column if not exists min_seat_count integer;

comment on column public.governance_bodies.min_seat_count is
  'Minimum directors permitted by the Articles. seat_count is the fixed number set by Ordinary Resolution within that range.';

update public.governance_bodies
   set min_seat_count = 7, updated_at = now()
 where key = 'board_of_directors' and min_seat_count is null;
