-- v3 catalog proof — collapse per-kind detail tables into one attributes jsonb.
--
-- "Build all the categories" needs adding a kind to be config, not a new table.
-- The relational structure (the references graph) stays a real, queryable table;
-- only the leaf SCALARS of each kind move into conference_entities.attributes.
-- This is what lets one generic interview author every kind.

alter table public.conference_entities
  add column if not exists attributes jsonb not null default '{}'::jsonb;

-- Fold existing typed detail into attributes (proof data; tables drop below).
update public.conference_entities e
set attributes = e.attributes || jsonb_strip_nulls(jsonb_build_object(
  'date', s.date::text, 'start_time', s.start_time::text, 'end_time', s.end_time::text,
  'purpose', s.purpose, 'format', s.format))
from public.entity_session s where s.entity_id = e.id;

update public.conference_entities e
set attributes = e.attributes || jsonb_strip_nulls(jsonb_build_object('address', v.address, 'capacity', v.capacity))
from public.entity_venue v where v.entity_id = e.id;

update public.conference_entities e
set attributes = e.attributes || jsonb_strip_nulls(jsonb_build_object('description', a.description, 'source_role', a.source_role))
from public.entity_audience a where a.entity_id = e.id;

update public.conference_entities e
set attributes = e.attributes || jsonb_strip_nulls(jsonb_build_object('date', d.date::text))
from public.entity_day d where d.entity_id = e.id;

drop table if exists public.entity_session;
drop table if exists public.entity_venue;
drop table if exists public.entity_audience;
drop table if exists public.entity_day;
