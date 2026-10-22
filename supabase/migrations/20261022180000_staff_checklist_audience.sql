-- CSC staff as a third checklist audience: the War Room's "What's next".
--
-- Stephen, 2026-10-22: the admin's running of a conference is a set of
-- prepared checklists, in order, with what each moment needs living inside
-- them. Those are the checklists that already exist for orgs and people, with
-- one more answerer: CSC staff, answering for the conference itself.
--
--   org    — an org admin answers for the company (reminder engine, /org page)
--   person — each attendee answers for themselves (/me)
--   staff  — CSC staff answer for the conference (War Room). Never emailed:
--            the reminder engine reads 'org' tasks only.
--
-- A staff tick is an ordinary acknowledgement filed under CSC's own
-- organization (type 'Staff'), person_id null — no change to that table.
--
-- The new check types read conference-wide facts (is the badge package
-- current, is the print station online). Keep this list in sync with
-- CHECK_TYPES in lib/conference/checklist-check-types.ts.

alter table public.conference_checklist_tasks
  drop constraint if exists conference_checklist_tasks_audience_check;

alter table public.conference_checklist_tasks
  add constraint conference_checklist_tasks_audience_check
  check (audience in ('org', 'person', 'staff'));

comment on column public.conference_checklist_tasks.audience is
  'Who answers: org (an admin answers for the company), person (each attendee answers for themselves), or staff (CSC answers for the conference, in the War Room).';

alter table public.conference_checklist_tasks
  drop constraint if exists conference_checklist_tasks_check_type_check;

alter table public.conference_checklist_tasks
  add constraint conference_checklist_tasks_check_type_check
  check (check_type = any (array[
    'seat_assigned'::text,
    'entity_purchased'::text,
    'travel_info_submitted'::text,
    'payment_complete'::text,
    'legal_document_accepted'::text,
    'directory_profile_complete'::text,
    'self_reported'::text,
    'directory_profile_enriched'::text,
    'top_choices_declared'::text,
    -- staff
    'badge_package_current'::text,
    'schedule_promoted'::text,
    'print_station_online'::text,
    'test_check_ins_cleared'::text,
    'check_in_cards_printed'::text,
    'door_lists_printed'::text,
    'directory_printed'::text,
    'map_printed'::text,
    'attendee_list_printed'::text
  ]));
