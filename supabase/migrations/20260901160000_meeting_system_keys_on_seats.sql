-- The meeting system keys on SEATS, not on the v2 registration monolith.
--
-- conference_registrations has 0 rows, 68 columns and NO writer — not in app
-- code, not in a DB function. It is the v2 person-record: delegate_name,
-- dietary_restrictions, hotel_name, badge_print_status, blackout_list. v3 split
-- every one of those out (conference_people, entity_balance_seats, the entity
-- graph, organizations.procurement_info), which is exactly why nothing fills it.
--
-- But six tables still FK'd to it, so the scheduler asked a dead table who was
-- coming and got nobody — INSUFFICIENT_ACTIVE_REGISTRATIONS — while 3 people sat
-- named on seats the whole time.
--
-- The seat is the fact: entity_balance_seats is FK-enforced to conference_people
-- and allocateSeat is its only writer (see lib/conference/seats.ts). So the
-- meeting system points there instead.
--
-- Safe as a rename: match_scores, schedules, swap_requests and
-- swap_cap_increase_requests are ALL empty, and both registration columns on
-- conference_people are null on both rows. Nothing to migrate, only to repoint.
--
-- Precedent, from the same subsystem: blackout_list was already moved off the
-- per-registration column to org_meeting_refusals, because "a refusal expired
-- every year unless someone retyped it" (conference-scheduler.ts). This is the
-- same move for who-is-coming.

begin;

-- ── match_scores ────────────────────────────────────────────────────────────
alter table match_scores drop constraint match_scores_delegate_registration_id_fkey;
alter table match_scores drop constraint match_scores_exhibitor_registration_id_fkey;
alter table match_scores rename column delegate_registration_id to delegate_seat_id;
alter table match_scores rename column exhibitor_registration_id to exhibitor_seat_id;
alter table match_scores
  add constraint match_scores_delegate_seat_id_fkey
  foreign key (delegate_seat_id) references entity_balance_seats(id) on delete cascade;
alter table match_scores
  add constraint match_scores_exhibitor_seat_id_fkey
  foreign key (exhibitor_seat_id) references entity_balance_seats(id) on delete cascade;

-- ── schedules ───────────────────────────────────────────────────────────────
-- delegate_registration_ids never had an FK (it is an array); renamed for
-- honesty so the pair reads the same way.
alter table schedules drop constraint schedules_exhibitor_registration_id_fkey;
alter table schedules rename column exhibitor_registration_id to exhibitor_seat_id;
alter table schedules rename column delegate_registration_ids to delegate_seat_ids;
alter table schedules
  add constraint schedules_exhibitor_seat_id_fkey
  foreign key (exhibitor_seat_id) references entity_balance_seats(id) on delete cascade;

-- ── swaps ───────────────────────────────────────────────────────────────────
alter table swap_requests drop constraint swap_requests_delegate_registration_id_fkey;
alter table swap_requests drop constraint swap_requests_replacement_exhibitor_id_fkey;
alter table swap_requests rename column delegate_registration_id to delegate_seat_id;
alter table swap_requests rename column replacement_exhibitor_id to replacement_exhibitor_seat_id;
alter table swap_requests
  add constraint swap_requests_delegate_seat_id_fkey
  foreign key (delegate_seat_id) references entity_balance_seats(id) on delete cascade;
alter table swap_requests
  add constraint swap_requests_replacement_exhibitor_seat_id_fkey
  foreign key (replacement_exhibitor_seat_id) references entity_balance_seats(id) on delete set null;

alter table swap_cap_increase_requests
  drop constraint swap_cap_increase_requests_delegate_registration_id_fkey;
alter table swap_cap_increase_requests
  rename column delegate_registration_id to delegate_seat_id;
alter table swap_cap_increase_requests
  add constraint swap_cap_increase_requests_delegate_seat_id_fkey
  foreign key (delegate_seat_id) references entity_balance_seats(id) on delete cascade;

-- ── conference_people ───────────────────────────────────────────────────────
-- Two nullable pointers at the dead table, null on every row. conference_people
-- IS the person in v3; the seat says what they hold. Dropping these removes the
-- last reason for a v3 row to reference a v2 registration.
alter table conference_people drop column registration_id;
alter table conference_people drop column schedule_registration_id;

commit;

-- NOT dropped: conference_registrations itself, conference_staff.registration_id,
-- and conference_registrations.linked_registration_id. Legal, travel-import,
-- staff, the register page and ops alerts still read the table. Those are
-- separate subsystems; porting them is its own coherent job, not a loose end to
-- leave half-done inside this one. The table keeps 0 rows and gains no writer.
