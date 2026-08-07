alter table comms_campaigns
  add column target_condition_keys text[] not null default '{}';
