-- Expand conference_schedule_modules to support broader modular scope.
-- Also formalizes always-included modules (handled at app layer).

alter table public.conference_schedule_modules
  drop constraint if exists conference_schedule_modules_module_key_check;

alter table public.conference_schedule_modules
  add constraint conference_schedule_modules_module_key_check
  check (
    module_key in (
      'meetings',
      'trade_show',
      'education',
      'meals',
      'offsite',
      'custom',
      'registration_ops',
      'communications',
      'sponsorship_ops',
      'logistics',
      'travel_accommodation',
      'content_capture',
      'lead_capture',
      'compliance_safety',
      'staffing',
      'post_event',
      'virtual_hybrid',
      'expo_floor_plan'
    )
  );

