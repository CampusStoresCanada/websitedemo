-- The War Room's meeting checks (phase 3).
--
--   schedule_emailed   — everyone in the published schedule has been told
--   schedules_printed  — individual schedules and suite door sheets (a tick)
--   meetings_confirmed — the meetings so far, against booth check-in card scans
--   bursary_proof_sent — the CANCOLL meeting proof (a tick, with the report)
--
-- Same list as 20261022180000 plus these four. Keep in sync with
-- STAFF_CHECK_TYPES in lib/conference/checklist-check-types.ts.

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
    'badge_package_current'::text,
    'schedule_promoted'::text,
    'print_station_online'::text,
    'test_check_ins_cleared'::text,
    'check_in_cards_printed'::text,
    'door_lists_printed'::text,
    'directory_printed'::text,
    'map_printed'::text,
    'attendee_list_printed'::text,
    'schedule_emailed'::text,
    'schedules_printed'::text,
    'meetings_confirmed'::text,
    'bursary_proof_sent'::text
  ]));
