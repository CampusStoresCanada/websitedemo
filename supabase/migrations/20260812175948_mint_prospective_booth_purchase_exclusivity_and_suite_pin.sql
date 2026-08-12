CREATE OR REPLACE FUNCTION public.mint_prospective_booth_purchase(
  p_conference_id uuid,
  p_organization_id uuid,
  p_booth_entity_id uuid,
  p_price_cents integer,
  p_buyer text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_purchase uuid;
  v_booth_conflict boolean;
  v_own_suite_id uuid;
  v_own_suite_number int;
  v_org_already_has_suite boolean;
begin
  -- Same exclusivity guard as mint_v3_for_order: a pay-first prospect's
  -- booth doesn't get reserved at payment time (no org exists yet), only at
  -- application-approval time here — so it's entirely possible someone else
  -- bought the same booth in the gap between payment and approval. Advisory
  -- lock + check before minting, so approval never double-sells a booth;
  -- if it's already gone, the admin needs to know and reconcile (refund or
  -- reassign) rather than silently creating a second owner.
  perform pg_advisory_xact_lock(hashtext(p_booth_entity_id::text));

  select exists (
    select 1 from public.entity_balances eb
    where eb.entity_id = p_booth_entity_id and eb.organization_id <> p_organization_id
  ) into v_booth_conflict;

  if v_booth_conflict then
    raise exception 'BOOTH_ALREADY_SOLD:%', p_booth_entity_id;
  end if;

  insert into public.entity_purchases(conference_id, offer_entity_id, quantity, buyer, price_cents)
  values (p_conference_id, p_booth_entity_id, 1, p_buyer, p_price_cents)
  returning id into v_purchase;

  insert into public.entity_balances(conference_id, organization_id, purchase_id, entity_id, quantity)
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
    select p_booth_entity_id, 1
    union all
    select ei.to_entity_id, exp.qty * coalesce(ei.quantity, 1)
    from exp
    join effective_includes ei on ei.from_entity_id = exp.entity_id
  )
  select p_conference_id, p_organization_id, v_purchase, exp.entity_id, sum(exp.qty)
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

  -- Same Connected-booth suite auto-pin as mint_v3_for_order — a
  -- pay-first prospect buying a Connected booth was never getting a
  -- meeting suite assigned at all, since this function predates that fix
  -- and was never updated alongside it.
  select te.id,
    case when te.name ~ '^[0-9]+$' then te.name::int else null end
  into v_own_suite_id, v_own_suite_number
  from public.conference_entity_refs ref
  join public.conference_entities te on te.id = ref.to_entity_id
  where ref.from_entity_id = p_booth_entity_id
    and ref.role = 'includes'
    and ref.conference_id = p_conference_id
    and te.kind = 'suite'
  limit 1;

  if v_own_suite_id is not null then
    select exists (
      select 1 from public.conference_entities s
      where s.conference_id = p_conference_id and s.kind = 'suite' and s.attributes->>'organization_id' = p_organization_id::text
    ) into v_org_already_has_suite;

    if not v_org_already_has_suite then
      update public.conference_entities
      set attributes = attributes || jsonb_build_object(
        'organization_id', p_organization_id::text,
        'suite_number', coalesce(v_own_suite_number, (attributes->>'suite_number')::int)
      )
      where id = v_own_suite_id;
    end if;
  end if;

  return v_purchase;
end;
$function$;
