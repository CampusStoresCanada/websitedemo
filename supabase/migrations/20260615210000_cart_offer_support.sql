-- Fork B · slice B2b — a cart line can reference a v3 Offer.
--
-- Mirrors the order-line change (B2): product_id becomes optional, offer_entity_id
-- is added, and a line targets exactly one of the two. Eligibility + inventory
-- are checked at add time (addOfferToCart) against the offer's `who` audiences
-- and inventory; checkout-through (Stripe + order lines) follows in B2c.

alter table public.cart_items
  alter column product_id drop not null,
  add column if not exists offer_entity_id uuid references public.conference_entities(id) on delete cascade;

alter table public.cart_items
  drop constraint if exists cart_items_one_target_chk;
alter table public.cart_items
  add constraint cart_items_one_target_chk
  check ((product_id is not null) <> (offer_entity_id is not null));
