-- Which door a check-in scan happened at.
--
-- ⛔ NULL means the badge-pickup desk, which is not a door. A desk scan is
-- "you collected your badge"; a door scan is "you went into this specific
-- thing". Conflating them would make the only per-event attendance record the
-- conference has unable to distinguish a reception from a registration table.
--
-- Nothing writes this yet — the door surface is Phase 2 of
-- planning/conference-check-in-model.md. The column lands first because
-- `conference_check_in_events` has been append-only and write-only since it was
-- built, and the catering audit it is meant to answer needs somewhere to put
-- the answer before anyone can start collecting it.

alter table public.conference_check_in_events
  add column if not exists entity_id uuid references public.conference_entities(id) on delete set null;

comment on column public.conference_check_in_events.entity_id is
  'Which door this scan happened at — a conference_entities id (an event, a day, a meal). NULL means the badge-pickup desk, which is not a door.';

-- Partial: door scans are a minority of rows and are only ever queried as
-- "how many people came through this entity".
create index if not exists idx_conference_check_in_events_entity
  on public.conference_check_in_events(conference_id, entity_id, checked_in_at desc)
  where entity_id is not null;
