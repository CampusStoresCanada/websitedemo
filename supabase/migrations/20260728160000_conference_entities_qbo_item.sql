-- A QuickBooks item mapping for a sellable conference entity (booth,
-- registration, sponsorship, ...). Set once on the type entity and inherited
-- by every instance via effectiveAttributes() (lib/conference/entity-graph.ts),
-- exactly like other type-level defaults — so "Booth" gets one QBO item and
-- all individual booth instances inherit it. A real dedicated column, not a
-- key inside `attributes`, matching this table's own precedent for
-- cross-cutting single fields (needs_definition, inventory) vs. per-kind
-- descriptive scalars (capacity, booth.size) which live in `attributes`.
alter table public.conference_entities
  add column if not exists qbo_item_id text;
