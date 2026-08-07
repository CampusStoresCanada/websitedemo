alter table comms_campaigns
  add column target_condition_match text not null default 'all'
  check (target_condition_match in ('all', 'any'));
