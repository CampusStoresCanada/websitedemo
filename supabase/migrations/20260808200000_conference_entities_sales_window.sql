alter table conference_entities
  add column sales_window text check (sales_window in ('member', 'vendor'));

comment on column conference_entities.sales_window is 'Which scheduled open time gates this entity''s is_for_sale flip via the sales-open cron: member = conference_instances.registration_open_at, vendor = conference_instances.booth_sales_general_open_at. Null = not part of automated scheduling; toggled manually as before.';
