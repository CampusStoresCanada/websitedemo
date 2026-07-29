-- Superseded by conference_instances.qbo_tax_code_ref — conference commerce
-- tax is one flat GST/HST code per conference (its venue's province), never
-- per entity type. This per-entity-type column was added earlier in the
-- same body of work and never shipped.
alter table public.conference_entities
  drop column if exists qbo_tax_code_ref;
