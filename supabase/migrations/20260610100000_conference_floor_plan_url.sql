alter table public.conference_instances
  add column if not exists floor_plan_url text;

comment on column public.conference_instances.floor_plan_url is
  'Public URL of the uploaded trade show floor plan image (1920x1080 aspect ratio expected to match conference_booths map_cx/cy coordinate space).';
