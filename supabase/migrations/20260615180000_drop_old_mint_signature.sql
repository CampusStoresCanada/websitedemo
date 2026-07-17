-- The pricing migration (20260615170000) added a 6-arg overload of
-- mint_entity_offer_purchase via create-or-replace; Postgres keyed it as a NEW
-- function (overloads are distinguished by argument list), leaving the original
-- 4-arg version in place. A 4-arg call then matches both → "could not choose
-- the best candidate". Drop the old one so the 6-arg version (with the nullable
-- price/tier defaults) is the single, unambiguous implementation.
drop function if exists public.mint_entity_offer_purchase(uuid, uuid, integer, text);
