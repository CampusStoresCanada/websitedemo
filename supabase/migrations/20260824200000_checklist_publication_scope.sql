-- A checklist can target the organisations in a PUBLICATION, not only those
-- who bought something at a conference.
--
-- Why: the printed directory covers the whole network — 123 organisations —
-- but `findDueOrgs` scoped on `entity_balances`, so only the 30 who purchased
-- at the conference could ever be reminded. Every member store and 41 partners
-- printed data that nothing asked them to check. A directory is a network
-- artifact; the loop that maintains it has to reach everyone it prints.
--
-- Nullable and additive: existing checklists keep purchaser scoping untouched.
alter table conference_checklists
  add column if not exists publication_id uuid references publications(id) on delete set null;

comment on column conference_checklists.publication_id is
  'When set, this checklist targets every organisation listed in the publication '
  'instead of orgs with entity_balances for the conference. Used by Directory '
  'Listing, which maintains content for the printed book.';

create index if not exists idx_conference_checklists_publication
  on conference_checklists(publication_id) where publication_id is not null;
