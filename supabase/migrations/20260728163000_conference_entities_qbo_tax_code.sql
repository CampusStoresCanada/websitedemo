-- QBO requires a GST/HST tax code on every Sales/Refund Receipt line. Same
-- type-level, inherited pattern as qbo_item_id (see effectiveQboTaxCode in
-- lib/conference/entity-graph.ts) — set once on the type, every instance
-- inherits it.
alter table public.conference_entities
  add column if not exists qbo_tax_code_ref text;
