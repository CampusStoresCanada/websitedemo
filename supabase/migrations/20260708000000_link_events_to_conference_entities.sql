-- Links the general Events system to the conference catalog so a
-- conference-authored "event" (or session/meeting/networking) entity can
-- optionally have a real Events row backing it for RSVP/Circle sync.
-- Nullable + unique: at most one Events row per catalog entity, and the
-- vast majority of events (non-conference) are entirely unaffected.

alter table public.events
  add column if not exists conference_entity_id uuid references public.conference_entities(id) on delete set null;

create unique index if not exists events_conference_entity_id_key
  on public.events(conference_entity_id) where conference_entity_id is not null;
