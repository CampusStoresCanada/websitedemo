-- entity_balance_seats.holder_person_id is the authoritative holder-tracking
-- column; entity_balances.holder / holder_person_id are vestigial leftovers
-- from an earlier iteration of the v3 catalog, confirmed empty (0 of 3 rows)
-- and referenced by zero application code.
alter table entity_balances drop column if exists holder;
alter table entity_balances drop column if exists holder_person_id;
