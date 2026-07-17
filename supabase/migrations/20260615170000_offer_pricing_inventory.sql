-- v3 catalog proof — sellability rules both A and B need: eligibility, tiered
-- pricing, and inventory. Isolated, fork-agnostic.
--
--  • inventory     : how many of an Offer can be sold (null = unlimited).
--  • tier_prices   : per-permission-tier price overrides over the base price_cents,
--                    keyed by source_role ({"member": 50000, "public": 80000}).
--  • eligibility   : who can buy = the Offer's `who` audiences (their tiers) — no
--                    new column; it rides on the existing reference graph.

alter table public.conference_entities
  add column if not exists inventory   integer,
  add column if not exists tier_prices jsonb not null default '{}'::jsonb;

-- Record what was actually charged + the buyer's tier on each purchase.
alter table public.entity_purchases
  add column if not exists price_cents integer,
  add column if not exists buyer_tier  text;

-- Mint, now with an atomic oversell guard (nullable price/tier params appended so
-- the generated signature stays back-compatible).
create or replace function public.mint_entity_offer_purchase(
  p_conference_id uuid,
  p_offer_id      uuid,
  p_quantity      integer,
  p_buyer         text,
  p_unit_price    integer default null,
  p_buyer_tier    text    default null
) returns uuid
language plpgsql
as $$
declare
  v_purchase uuid;
  v_qty      integer := greatest(coalesce(p_quantity, 1), 1);
  v_cap      integer;
  v_sold     integer;
begin
  -- Inventory guard: refuse to oversell. Lock the offer row so concurrent
  -- buyers can't both slip past the cap.
  select inventory into v_cap
  from public.conference_entities
  where id = p_offer_id
  for update;

  if v_cap is not null then
    select coalesce(sum(quantity), 0) into v_sold
    from public.entity_purchases
    where offer_entity_id = p_offer_id;

    if v_sold + v_qty > v_cap then
      raise exception 'SOLD_OUT: % of % remain', greatest(v_cap - v_sold, 0), v_cap
        using errcode = 'check_violation';
    end if;
  end if;

  insert into public.entity_purchases(conference_id, offer_entity_id, quantity, buyer, price_cents, buyer_tier)
  values (p_conference_id, p_offer_id, v_qty, p_buyer, p_unit_price, p_buyer_tier)
  returning id into v_purchase;

  insert into public.entity_balances(conference_id, purchase_id, entity_id, quantity)
  with recursive exp(entity_id, qty) as (
    select p_offer_id, v_qty
    union all
    select r.to_entity_id, exp.qty * coalesce(r.quantity, 1)
    from exp
    join public.conference_entity_refs r
      on r.from_entity_id = exp.entity_id
     and r.role = 'includes'
     and r.conference_id = p_conference_id
  )
  select p_conference_id, v_purchase, entity_id, sum(qty)
  from exp
  group by entity_id;

  return v_purchase;
end;
$$;
