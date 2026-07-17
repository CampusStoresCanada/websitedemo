-- Fork B · slice B2 — a paid order mints v3 grants.
--
-- An order line can now reference a v3 Offer (offer_entity_id) instead of a
-- legacy product. On payment, mint_v3_for_order expands each offer line's
-- `includes` into entity_purchases + entity_balances — the SAME fulfillment the
-- isolated proof did, now driven by the real order. The old product path is
-- untouched; both coexist until B6 retires products.

-- A line targets exactly one of: a legacy product OR a v3 Offer.
alter table public.conference_order_items
  alter column product_id drop not null,
  add column if not exists offer_entity_id uuid references public.conference_entities(id) on delete restrict;

alter table public.conference_order_items
  drop constraint if exists conference_order_items_one_target_chk;
alter table public.conference_order_items
  add constraint conference_order_items_one_target_chk
  check ((product_id is not null) <> (offer_entity_id is not null));

-- Link each minted purchase back to its order line — for idempotency + refunds.
alter table public.entity_purchases
  add column if not exists order_item_id uuid references public.conference_order_items(id) on delete cascade;
create unique index if not exists uq_entity_purchases_order_item
  on public.entity_purchases(order_item_id) where order_item_id is not null;

-- Mint v3 grants for every offer line of a paid order. Idempotent (skips lines
-- already minted). NO oversell guard here — inventory is enforced at checkout,
-- not at fulfillment; the money is already taken.
create or replace function public.mint_v3_for_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conf  uuid;
  v_count integer := 0;
  r       record;
  v_purchase uuid;
begin
  select conference_id into v_conf from public.conference_orders where id = p_order_id;
  if v_conf is null then return 0; end if;

  for r in
    select oi.id as item_id, oi.offer_entity_id, oi.quantity, oi.unit_price_cents
    from public.conference_order_items oi
    where oi.order_id = p_order_id
      and oi.offer_entity_id is not null
      and not exists (select 1 from public.entity_purchases p where p.order_item_id = oi.id)
  loop
    insert into public.entity_purchases(conference_id, offer_entity_id, quantity, buyer, price_cents, order_item_id)
    values (v_conf, r.offer_entity_id, greatest(r.quantity, 1), 'order:' || p_order_id, r.unit_price_cents, r.item_id)
    returning id into v_purchase;

    insert into public.entity_balances(conference_id, purchase_id, entity_id, quantity)
    with recursive exp(entity_id, qty) as (
      select r.offer_entity_id, greatest(r.quantity, 1)
      union all
      select er.to_entity_id, exp.qty * coalesce(er.quantity, 1)
      from exp
      join public.conference_entity_refs er
        on er.from_entity_id = exp.entity_id
       and er.role = 'includes'
       and er.conference_id = v_conf
    )
    select v_conf, v_purchase, entity_id, sum(qty)
    from exp
    group by entity_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Hook the v3 mint into the existing paid path (one line) so the webhook and its
-- pinned tests are unchanged. Reproduces the current body verbatim + the perform.
create or replace function public.process_conference_order_paid(p_order_id uuid, p_checkout_session_id text, p_payment_intent_id text default null::text)
returns conference_orders
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  existing_order public.conference_orders%rowtype;
begin
  select *
  into existing_order
  from public.conference_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND:%', p_order_id;
  end if;

  if existing_order.status = 'pending' then
    update public.conference_orders
    set
      status = 'paid',
      paid_at = coalesce(existing_order.paid_at, now()),
      stripe_checkout_session_id = coalesce(p_checkout_session_id, existing_order.stripe_checkout_session_id),
      stripe_payment_intent_id = coalesce(p_payment_intent_id, existing_order.stripe_payment_intent_id)
    where id = p_order_id;

    update public.conference_products cp
    set current_sold = cp.current_sold + oi.quantity
    from public.conference_order_items oi
    where oi.order_id = p_order_id
      and oi.product_id = cp.id;
  else
    update public.conference_orders
    set
      stripe_checkout_session_id = coalesce(p_checkout_session_id, stripe_checkout_session_id),
      stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
    where id = p_order_id;
  end if;

  perform public.mint_grant_balances_for_order(p_order_id);
  perform public.mint_v3_for_order(p_order_id);

  select *
  into existing_order
  from public.conference_orders
  where id = p_order_id;

  return existing_order;
end;
$function$;
