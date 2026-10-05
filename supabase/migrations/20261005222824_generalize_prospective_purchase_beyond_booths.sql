-- Let a pay-first prospect buy something that isn't a booth.
--
-- Conference in a Box is sold to any partner with no booth and no conference
-- registration, and a non-partner must be able to buy it outright and be
-- charged for the partnership in the same checkout. That is exactly what this
-- function already did for booths; two lines stopped it working for anything
-- else.
--
-- 1. The balance insert filtered `ce.kind not in ('day','item','meal','suite')`.
--    Right for what a booth EXPANDS INTO — nobody wants a balance row per
--    folding chair or per breakfast — but Conference in a Box IS kind 'item'.
--    A prospect would have paid and received nothing. The purchased thing
--    itself is now always inserted; the filter applies only to its children.
--
-- 2. The exclusivity guard raised BOOTH_ALREADY_SOLD whenever ANY other org
--    held a balance in the entity. Correct for a booth, which is one physical
--    space; wrong for an unlimited item, where it refuses every buyer after
--    the first. Now scoped to kind = 'booth'.
--
-- Parameter name stays p_booth_entity_id and the column stays
-- booth_entity_id: the FK is to conference_entities with no kind restriction,
-- so both already accept any entity, and renaming would touch eight call sites
-- for no behavioural gain. Misleading names, flagged rather than churned.

create or replace function public.mint_prospective_booth_purchase(
  p_conference_id uuid,
  p_organization_id uuid,
  p_booth_entity_id uuid,
  p_price_cents integer,
  p_buyer text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_purchase uuid;
  v_booth_conflict boolean;
  v_is_booth boolean;
  v_own_suite_id uuid;
  v_own_suite_number int;
  v_org_already_has_suite boolean;
begin
  select ce.kind = 'booth' into v_is_booth
  from public.conference_entities ce where ce.id = p_booth_entity_id;

  -- Exclusivity is a property of booths, not of everything sold this way.
  if coalesce(v_is_booth, false) then
    perform pg_advisory_xact_lock(hashtext(p_booth_entity_id::text));

    select exists (
      select 1 from public.entity_balances eb
      where eb.entity_id = p_booth_entity_id and eb.organization_id <> p_organization_id
    ) into v_booth_conflict;

    if v_booth_conflict then
      raise exception 'BOOTH_ALREADY_SOLD:%', p_booth_entity_id;
    end if;
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
  -- The thing actually bought always lands, whatever its kind. The filter is
  -- about what it EXPANDS INTO: no balance row per folding chair or breakfast.
  where exp.entity_id = p_booth_entity_id
     or ce.kind not in ('day', 'item', 'meal', 'suite')
  group by exp.entity_id;

  insert into public.entity_balance_seats(conference_id, organization_id, balance_id, entity_id, seat_index)
  select b.conference_id, b.organization_id, b.id, b.entity_id, gs.i
  from public.entity_balances b
  join public.conference_entities ce on ce.id = b.entity_id
  cross join lateral generate_series(1, greatest(b.quantity, 1)) gs(i)
  where b.purchase_id = v_purchase
    and ce.kind <> 'booth';

  -- Connected-booth suite auto-pin. Finds nothing for a non-booth purchase.
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
