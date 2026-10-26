-- Which private Circle spaces a conference's pass holders are kept in.
--
-- Each rule: { "spaceId": <Circle space id>, "label": "<name>",
--              "passEntityIds": [<conference_entities.id>, ...] | null }
-- passEntityIds null = every registration-kind pass. /api/cron/conference-circle-access
-- adds pass holders who have a Circle account, and removes people it added once
-- they no longer hold a qualifying pass. People added by hand are never removed.
alter table public.conference_instances
  add column if not exists circle_spaces jsonb not null default '[]'::jsonb;

comment on column public.conference_instances.circle_spaces is
  'Private Circle spaces kept in step with this conference''s pass holders by /api/cron/conference-circle-access. [{spaceId,label,passEntityIds|null}]';
