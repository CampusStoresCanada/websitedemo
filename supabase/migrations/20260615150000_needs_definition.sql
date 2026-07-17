-- v3 catalog proof — the open-questions loop.
--
-- Reference-or-create makes it trivial to coin a thing mid-sentence ("includes
-- 4× Exhibitor Registration"). That new thing is a STUB — a promise, not a
-- definition. needs_definition marks it so the Build screen can walk the admin
-- back to finish it. Cleared when they actually define the thing. This is what
-- stops the graph from filling up with half-defined references.

alter table public.conference_entities
  add column if not exists needs_definition boolean not null default false;

comment on column public.conference_entities.needs_definition is
  'True for things coined inline (stubs) until the admin defines them. Drives the Build "open questions" worklist.';
