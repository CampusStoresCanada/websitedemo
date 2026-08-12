CREATE OR REPLACE FUNCTION public.mint_v3_for_order(p_order_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_conf  uuid;
  v_org   uuid;
  v_count integer := 0;
  r       record;
  v_purchase uuid;
  v_own_suite_id uuid;
  v_own_suite_number int;
  v_org_already_has_suite boolean;
  v_item_kind text;
  v_booth_conflict boolean;
begin
  select conference_id, organization_id into v_conf, v_org from public.conference_orders where id = p_order_id;
  if v_conf is null then return 0; end if;

  for r in
    select oi.id as item_id, oi.offer_entity_id, oi.quantity, oi.unit_price_cents
    from public.conference_order_items oi
    where oi.order_id = p_order_id and oi.offer_entity_id is not null
      and not exists (select 1 from public.entity_purchases p where p.order_item_id = oi.id)
  loop
    -- Booth exclusivity guard: a booth is one physical space, and nothing
    -- upstream (cart reservation, checkout) is airtight against two buyers
    -- racing for the same one during a sales-open rush. This is the actual
    -- moment of truth — take an advisory lock scoped to this booth entity
    -- so two concurrent mint calls for the same booth serialize instead of
    -- both succeeding, then check no OTHER org already holds it. If it's
    -- already taken, skip this order item entirely (no purchase/balance/
    -- seat rows) so the rest of the order still completes — the buyer's
    -- payment went through, but they don't silently get a booth someone
    -- else already has. That case needs a human: refund or reassign.
    select ce.kind into v_item_kind from public.conference_entities ce where ce.id = r.offer_entity_id;

    if v_item_kind = 'booth' then
      perform pg_advisory_xact_lock(hashtext(r.offer_entity_id::text));

      select exists (
        select 1 from public.entity_balances eb
        where eb.entity_id = r.offer_entity_id and eb.organization_id <> v_org
      ) into v_booth_conflict;

      if v_booth_conflict then
        raise warning 'mint_v3_for_order: booth % already held by another org — skipping order_item % (order %)',
          r.offer_entity_id, r.item_id, p_order_id;
        continue;
      end if;
    end if;

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
    join public.conference_entities ce on ce.id = b.entity_id
    cross join lateral generate_series(1, greatest(b.quantity, 1)) gs(i)
    where b.purchase_id = v_purchase
      and ce.kind <> 'booth';

    -- Auto-pin a Connected booth's own suite as the buying org's single
    -- meeting-suite home — one meeting series per org, not one per booth.
    -- The scheduler (findDuplicateSuiteOrgAssignment) hard-errors if an org
    -- is ever pinned to more than one suite, so this only ever sets it on
    -- the FIRST Connected booth an org buys for this conference; any
    -- additional booth's own suite is deliberately left unassigned rather
    -- than pulled into the meeting rotation.
    select te.id,
      case when te.name ~ '^[0-9]+$' then te.name::int else null end
    into v_own_suite_id, v_own_suite_number
    from public.conference_entity_refs ref
    join public.conference_entities te on te.id = ref.to_entity_id
    where ref.from_entity_id = r.offer_entity_id
      and ref.role = 'includes'
      and ref.conference_id = v_conf
      and te.kind = 'suite'
    limit 1;

    if v_own_suite_id is not null then
      select exists (
        select 1 from public.conference_entities s
        where s.conference_id = v_conf and s.kind = 'suite' and s.attributes->>'organization_id' = v_org::text
      ) into v_org_already_has_suite;

      if not v_org_already_has_suite then
        update public.conference_entities
        set attributes = attributes || jsonb_build_object(
          'organization_id', v_org::text,
          'suite_number', coalesce(v_own_suite_number, (attributes->>'suite_number')::int)
        )
        where id = v_own_suite_id;
      end if;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;
