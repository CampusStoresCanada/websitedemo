-- Add the `directory_profile_complete` checklist check type.
--
-- The checklist engine's own rule (lib/conference/checklist-engine.ts): a check
-- may only be added once the underlying capture exists. It now does —
-- lib/publication/completeness.ts derives directory readiness from columns on
-- `organizations`, which is what the gap report and the print-readiness gate
-- already read.
--
-- Why this matters more than another nudge: onboarding nudges need a
-- `user_onboarding_progress` journey, and journeys only exist after someone logs
-- in — 29 of 78 partner orgs. Checklist reminders resolve through the
-- `org_admins` audience, which needs only a provisioned account: 76 of 78, and
-- 30 of 30 orgs holding a booth. This is the path that reaches the orgs nothing
-- else can.
--
-- Keep this list in sync with CHECK_TYPES in
-- lib/conference/checklist-check-types.ts.

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
    'directory_profile_complete'::text
  ]));
