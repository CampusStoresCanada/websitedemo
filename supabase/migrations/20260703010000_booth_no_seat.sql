-- A booth is a place and furniture, not a person — it shouldn't mint its
-- own entity_balance_seats row implying someone can be "assigned" to it.
-- Only the entity actually purchased AND anything reached via includes that
-- represents a person-held unit gets a balance + seat. Booths join
-- day/item/meal/suite in the exclusion list; the booth's own identity is
-- still tracked via entity_purchases/entity_balances and shown as a plain
-- headline on the org profile, just not as an assignable seat.
--
-- Floor/session access (Trade Show sessions, venue, floorplan) that used to
-- only resolve through a booth-seat holder is being moved onto the
-- registration entity itself in this same migration (see the
-- conference_entity_refs UPDATE below) — a person's badge access should
-- come from what they're actually registered for, not from someone
-- incidentally "holding" the booth.

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
    where ce.kind not in ('day', 'item', 'meal', 'suite', 'booth')
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
  where ce.kind not in ('day', 'item', 'meal', 'suite', 'booth')
  group by exp.entity_id;

  insert into public.entity_balance_seats(conference_id, organization_id, balance_id, entity_id, seat_index)
  select b.conference_id, b.organization_id, b.id, b.entity_id, gs.i
  from public.entity_balances b
  cross join lateral generate_series(1, greatest(b.quantity, 1)) gs(i)
  where b.purchase_id = v_purchase;

  return v_purchase;
end;
$function$;

-- Move floor/session/venue access from the booth type onto the registration
-- a person actually holds. Booth type "600" carries these today; the
-- registration it bundles ("Connected Exhibitor Staff Registration") has
-- none. Confirmed no collision: the registration has zero existing
-- involved_in/where rows.
update public.conference_entity_refs
set from_entity_id = '5396cdfe-87bb-46cf-915f-b6100e0f6b13'
where from_entity_id = '1fd9f53c-8471-4a50-8018-76cc0944fc77'
  and role in ('involved_in', 'where');

-- "Exhibitor Staff Registration" (not booth-bundled) already directly
-- includes the Wednesday/Thursday trade show sessions but has no venue
-- reference — add just that one for consistency. Not adding the Monday/
-- Tuesday session edges since it has no matching day/meal coverage.
insert into public.conference_entity_refs (conference_id, from_entity_id, to_entity_id, role)
values (
  '7e650b08-51d1-4573-a332-7d6b6fbc50bd',
  'b5e5e2a7-e2c2-4cbf-add6-117b7ea76bce',
  'e5e49bdf-7b5a-465d-8646-d8f15dc0fd86',
  'where'
);
