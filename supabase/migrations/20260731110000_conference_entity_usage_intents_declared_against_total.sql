alter table conference_entity_usage_intents
  add column declared_against_total integer not null default 0;

comment on column conference_entity_usage_intents.declared_against_total is
  'Total purchased seat count at the moment this intent was declared. If the real seat count later exceeds this (a new purchase), the intent is stale and the checklist check falls back to strict "all assigned" until re-declared.';
