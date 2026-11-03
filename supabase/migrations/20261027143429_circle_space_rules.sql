-- Rules that keep private Circle spaces in step with who qualifies for them,
-- edited at /admin/circle/spaces and applied hourly by
-- /api/cron/conference-circle-access (lib/circle/conference-access.ts).
--
-- Two kinds:
--   conference_passes: holders of a pass at a conference. pass_entity_ids null
--                      = every registration-kind pass at that conference.
--   survey_answer:     every contact at a current-member school whose latest
--                      submitted benchmarking answer in survey_field (an array
--                      column) includes survey_value.
--
-- One rule per space: the job's add/remove ledger in circle_sync_queue is keyed
-- by space, so two rules on one space would each remove the other's people.
--
-- last_run / last_run_at are written by the job after each run, so the admin
-- screen can show what the rule did without reading the Vercel log.
--
-- Replaces conference_instances.circle_spaces and the SURVEY_SPACE_RULES
-- constant; the three rules that existed there are copied in below.

create table if not exists public.circle_space_rules (
  id uuid primary key default gen_random_uuid(),
  space_id bigint not null unique,
  label text not null,
  kind text not null check (kind in ('conference_passes', 'survey_answer')),
  conference_id uuid references public.conference_instances(id) on delete cascade,
  pass_entity_ids uuid[],
  survey_field text,
  survey_value text,
  last_run jsonb,
  last_run_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint circle_space_rules_kind_fields check (
    (kind = 'conference_passes'
      and conference_id is not null
      and survey_field is null and survey_value is null)
    or
    (kind = 'survey_answer'
      and conference_id is null and pass_entity_ids is null
      and survey_field is not null and survey_value is not null)
  )
);

-- Read and written only by the service role (admin screen + cron).
alter table public.circle_space_rules enable row level security;

insert into public.circle_space_rules (space_id, label, kind, conference_id, pass_entity_ids)
select (r->>'spaceId')::bigint,
       r->>'label',
       'conference_passes',
       ci.id,
       case when jsonb_typeof(r->'passEntityIds') = 'array'
            then array(select jsonb_array_elements_text(r->'passEntityIds'))::uuid[]
            else null end
from public.conference_instances ci,
     jsonb_array_elements(ci.circle_spaces) r
on conflict (space_id) do nothing;

insert into public.circle_space_rules (space_id, label, kind, survey_field, survey_value)
values (2922289, 'Bookware Users', 'survey_answer', 'pos_system', 'Carleton Technologies - Bookware')
on conflict (space_id) do nothing;

comment on column public.conference_instances.circle_spaces is
  'Superseded by circle_space_rules (2026-10-27). Read by nothing; kept until the rules screen has run in production.';
