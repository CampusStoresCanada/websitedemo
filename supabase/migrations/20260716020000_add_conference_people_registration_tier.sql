-- Purely additive display field: the human-readable tier label derived from
-- the catalog entity a person's seat is tied to (e.g. "Full Conference",
-- "Connected Exhibitor"). person_kind stays the coarse enum used elsewhere
-- for scheduling/access; this is just for badge/roster display.
alter table conference_people add column if not exists registration_tier text;
