-- mint_v3_for_order() and mint_entity_offer_purchase() never resolved a
-- purchased entity's `instance_of` type when expanding what it includes.
-- Booth instances typically only carry their own physical suite as a direct
-- `includes` edge; everything else a booth actually grants (registrations,
-- table, chairs) is defined on the booth TYPE. Confirmed live: buying booth
-- "100" (instance_of booth type "600") minted only the booth + its own suite
-- instead of also minting the type's 4 included staff registrations.
--
-- Fix mirrors the already-correct client-side effectiveIncludes() in
-- lib/conference/entity-graph.ts: an entity's real includes = its own edges
-- plus edges inherited from its instance_of type, except where the entity
-- already has its own includes edge to that same target (instance wins,
-- no double-count).
--
-- Also confirmed (and deliberately excluded): the includes graph keeps
-- going past registrations into what a registration itself implies (days,
-- meals) and past booths into bundled physical items (tables, chairs) and
-- the booth's own suite. None of that is something a specific person is
-- individually seated into — a registration's included days/meals are
-- fixed, non-mutable consequences of holding the registration, resolved on
-- demand by resolve_person_access(), not separately assignable units. Only
-- the entity actually purchased and anything reached via `includes` whose
-- kind represents a person-held unit (i.e. not day/item/meal/suite) gets a
-- balance + seats.

create or replace function public.mint_v3_for_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_conf  uuid;
  v_org   uuid;
  v_count integer := 0;
  r       record;
  v_purchase uuid;
begin
  select conference_id, organization_id into v_conf, v_org from public.conference_orders where id = p_order_id;
  if v_conf is null then return 0; end if;

  for r in
    select oi.id as item_id, oi.offer_entity_id, oi.quantity, oi.unit_price_cents
    from public.conference_order_items oi
    where oi.order_id = p_order_id and oi.offer_entity_id is not null
      and not exists (select 1 from public.entity_purchases p where p.order_item_id = oi.id)
  loop
    insert into public.entity_purchases(conference_id, offer_entity_id, quantity, buyer, price_cents, order_item_id)
    values (v_conf, r.offer_entity_id, greatest(r.quantity, 1), 'order:' || p_order_id, r.unit_price_cents, r.item_id)
    returning id into v_purchase;

    insert into public.entity_balances(conference_id, organization_id, purchase_id, entity_id, quantity)
    with recursive effective_includes as (
      select from_entity_id, to_entity_id, quantity
      from public.conference_entity_refs
      where role = 'includes' and conference_id = v_conf
      union all
      select inst.from_entity_id, er.to_entity_id, er.quantity
      from public.conference_entity_refs inst
      join public.conference_entity_refs er
        on er.from_entity_id = inst.to_entity_id and er.role = 'includes' and er.conference_id = v_conf
      where inst.role = 'instance_of' and inst.conference_id = v_conf
        and not exists (
          select 1 from public.conference_entity_refs own
          where own.from_entity_id = inst.from_entity_id and own.role = 'includes' and own.to_entity_id = er.to_entity_id
        )
    ),
    exp(entity_id, qty) as (
      select r.offer_entity_id, greatest(r.quantity, 1)
      union all
      select ei.to_entity_id, exp.qty * coalesce(ei.quantity, 1)
      from exp
      join effective_includes ei on ei.from_entity_id = exp.entity_id
    )
    select v_conf, v_org, v_purchase, exp.entity_id, sum(exp.qty)
    from exp
    join public.conference_entities ce on ce.id = exp.entity_id
    where ce.kind not in ('day', 'item', 'meal', 'suite')
    group by exp.entity_id;

    insert into public.entity_balance_seats(conference_id, organization_id, balance_id, entity_id, seat_index)
    select b.conference_id, b.organization_id, b.id, b.entity_id, gs.i
    from public.entity_balances b
    cross join lateral generate_series(1, greatest(b.quantity, 1)) gs(i)
    where b.purchase_id = v_purchase;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.mint_entity_offer_purchase(
  p_conference_id uuid,
  p_offer_id uuid,
  p_quantity integer,
  p_buyer text,
  p_unit_price integer default null::integer,
  p_buyer_tier text default null::text
)
returns uuid
language plpgsql
as $function$
declare
  v_purchase uuid;
  v_qty      integer := greatest(coalesce(p_quantity, 1), 1);
  v_cap      integer;
  v_sold     integer;
begin
  select inventory into v_cap from public.conference_entities where id = p_offer_id for update;
  if v_cap is not null then
    select coalesce(sum(quantity), 0) into v_sold from public.entity_purchases where offer_entity_id = p_offer_id;
    if v_sold + v_qty > v_cap then
      raise exception 'SOLD_OUT: % of % remain', greatest(v_cap - v_sold, 0), v_cap using errcode = 'check_violation';
    end if;
  end if;

  insert into public.entity_purchases(conference_id, offer_entity_id, quantity, buyer, price_cents, buyer_tier)
  values (p_conference_id, p_offer_id, v_qty, p_buyer, p_unit_price, p_buyer_tier)
  returning id into v_purchase;

  insert into public.entity_balances(conference_id, purchase_id, entity_id, quantity)
  with recursive effective_includes as (
    select from_entity_id, to_entity_id, quantity
    from public.conference_entity_refs
    where role = 'includes' and conference_id = p_conference_id
    union all
    select inst.from_entity_id, er.to_entity_id, er.quantity
    from public.conference_entity_refs inst
    join public.conference_entity_refs er
      on er.from_entity_id = inst.to_entity_id and er.role = 'includes' and er.conference_id = p_conference_id
    where inst.role = 'instance_of' and inst.conference_id = p_conference_id
      and not exists (
        select 1 from public.conference_entity_refs own
        where own.from_entity_id = inst.from_entity_id and own.role = 'includes' and own.to_entity_id = er.to_entity_id
      )
  ),
  exp(entity_id, qty) as (
    select p_offer_id, v_qty
    union all
    select ei.to_entity_id, exp.qty * coalesce(ei.quantity, 1)
    from exp
    join effective_includes ei on ei.from_entity_id = exp.entity_id
  )
  select p_conference_id, v_purchase, exp.entity_id, sum(exp.qty)
  from exp
  join public.conference_entities ce on ce.id = exp.entity_id
  where ce.kind not in ('day', 'item', 'meal', 'suite')
  group by exp.entity_id;

  insert into public.entity_balance_seats(conference_id, organization_id, balance_id, entity_id, seat_index)
  select b.conference_id, b.organization_id, b.id, b.entity_id, gs.i
  from public.entity_balances b
  cross join lateral generate_series(1, greatest(b.quantity, 1)) gs(i)
  where b.purchase_id = v_purchase;

  return v_purchase;
end;
$function$;
