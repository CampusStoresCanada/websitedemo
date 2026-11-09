-- Change one held registration to another of the same price: staff only.
--
-- York University bought a Tuesday Day Pass for a delegate who is coming on
-- Wednesday (2026-11-09). Nothing could fix that short of refunding and
-- buying again, and both passes are $199.
--
-- Same shape as convert_registration_to_funded: the registration seat is
-- RELABELLED, so the person on it stays exactly who they are (and anything
-- hanging off the seat id, a bursary application, a match score, stays with
-- them). What differs is what the two registrations include: a Tuesday pass
-- carries the Meet & Greet, a Wednesday pass carries the Tuesday Evening Trade
-- Show. So, as a booth move does, the included seats minted for the old
-- registration go, and the new registration's are minted the way
-- mint_v3_for_order mints them, onto a new purchase that says what happened.
--
-- ⛔ The order is never touched. Its line items are the record of what was
-- paid for; what the org holds lives in entity_balances. No money moves, which
-- is why the application only offers a registration at the price paid.
--
-- ⛔ A seat already on a meeting schedule is refused: the new registration may
-- not be in the meetings at all (no day pass but Tuesday's is), and quietly
-- dropping somebody from a published schedule is not a side effect.

create table if not exists public.conference_registration_changes (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  seat_id uuid not null references public.entity_balance_seats(id) on delete cascade,
  holder_person_id uuid references public.conference_people(id) on delete set null,
  from_entity_id uuid not null references public.conference_entities(id) on delete cascade,
  to_entity_id uuid not null references public.conference_entities(id) on delete cascade,
  -- The purchase the seat came from (whose order paid) and the one it sits on now.
  from_purchase_id uuid references public.entity_purchases(id) on delete set null,
  to_purchase_id uuid not null references public.entity_purchases(id) on delete cascade,
  actor_id uuid,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_conference_registration_changes_org
  on public.conference_registration_changes(organization_id);
create index if not exists idx_conference_registration_changes_conference
  on public.conference_registration_changes(conference_id);

alter table public.conference_registration_changes enable row level security;
revoke all on public.conference_registration_changes from public, anon, authenticated;

create or replace function public.change_registration_offer(
  p_conference_id uuid,
  p_seat_id uuid,
  p_to_entity_id uuid,
  p_actor_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_seat public.entity_balance_seats%rowtype;
  v_balance public.entity_balances%rowtype;
  v_from public.conference_entities%rowtype;
  v_to public.conference_entities%rowtype;
  v_old_purchase public.entity_purchases%rowtype;
  v_purchase_id uuid;
  v_registration_balance_id uuid;
  v_change_id uuid;
  v_units integer;
  r record;
  v_per_unit integer;
  v_drop uuid[];
begin
  select * into v_seat from public.entity_balance_seats
  where id = p_seat_id and conference_id = p_conference_id
  for update;
  if not found then
    raise exception 'SEAT_NOT_FOUND';
  end if;

  select * into v_from from public.conference_entities where id = v_seat.entity_id;
  select * into v_to from public.conference_entities
  where id = p_to_entity_id and conference_id = p_conference_id;
  if v_from.kind <> 'registration' then
    raise exception 'SEAT_IS_NOT_A_REGISTRATION';
  end if;
  if not found or v_to.kind <> 'registration' then
    raise exception 'TARGET_IS_NOT_A_REGISTRATION';
  end if;
  if v_to.id = v_from.id then
    raise exception 'ALREADY_THAT_REGISTRATION';
  end if;

  -- A CANCOLL-switched seat's included seats live on the purchase the school
  -- paid for, not the one the seat sits on; its own board undoes it.
  if exists (select 1 from public.conference_funded_conversions where seat_id = v_seat.id) then
    raise exception 'SEAT_WAS_SWITCHED_TO_CANCOLL';
  end if;

  if exists (
    select 1 from public.schedules sc
    join public.scheduler_runs sr on sr.id = sc.scheduler_run_id
    where sr.conference_id = p_conference_id and v_seat.id = any(sc.delegate_seat_ids)
  ) or exists (
    select 1 from public.schedules where exhibitor_seat_id = v_seat.id
  ) then
    raise exception 'SEAT_IS_ON_A_SCHEDULE';
  end if;

  select * into v_balance from public.entity_balances where id = v_seat.balance_id for update;
  if not found or v_balance.purchase_id is null then
    raise exception 'SEAT_HAS_NO_PURCHASE';
  end if;
  select * into v_old_purchase from public.entity_purchases where id = v_balance.purchase_id;
  -- How many registrations the purchase still holds: an earlier change took
  -- its share of the included seats with it, so the ratio still holds.
  v_units := greatest(v_balance.quantity, 1);

  insert into public.entity_purchases (conference_id, offer_entity_id, quantity, buyer, price_cents, buyer_tier)
  values (
    p_conference_id, p_to_entity_id, 1,
    'registration_change:' || v_old_purchase.id::text,
    v_old_purchase.price_cents, v_old_purchase.buyer_tier
  )
  returning id into v_purchase_id;

  -- The registration itself: relabel the seat, splitting it off its balance
  -- when the org bought several on one line.
  if v_balance.quantity <= 1 then
    update public.entity_balances
      set entity_id = p_to_entity_id, purchase_id = v_purchase_id
      where id = v_balance.id;
    v_registration_balance_id := v_balance.id;
    update public.entity_balance_seats set entity_id = p_to_entity_id where id = v_seat.id;
  else
    update public.entity_balances set quantity = quantity - 1 where id = v_balance.id;
    insert into public.entity_balances (conference_id, organization_id, purchase_id, entity_id, quantity)
    values (p_conference_id, v_seat.organization_id, v_purchase_id, p_to_entity_id, 1)
    returning id into v_registration_balance_id;
    update public.entity_balance_seats
      set balance_id = v_registration_balance_id, entity_id = p_to_entity_id, seat_index = 1
      where id = v_seat.id;
  end if;

  -- One registration's worth of what the old purchase included goes. The
  -- holder's own seats first, then empty ones; a seat somebody else holds is
  -- never taken.
  for r in
    select b.id, b.quantity, b.entity_id
    from public.entity_balances b
    where b.purchase_id = v_old_purchase.id
      and b.id <> v_balance.id
      and b.id <> v_registration_balance_id
      and b.organization_id is not distinct from v_seat.organization_id
    for update
  loop
    v_per_unit := r.quantity / v_units;
    if v_per_unit <= 0 then
      continue;
    end if;
    select array_agg(id) into v_drop from (
      select s.id from public.entity_balance_seats s
      where s.balance_id = r.id
        and (s.holder_person_id is null or s.holder_person_id = v_seat.holder_person_id)
      order by (s.holder_person_id is not distinct from v_seat.holder_person_id
                and v_seat.holder_person_id is not null) desc,
               s.seat_index desc
      limit v_per_unit
    ) picked;
    if coalesce(array_length(v_drop, 1), 0) < v_per_unit then
      raise exception 'INCLUDED_SEAT_HELD_BY_SOMEONE_ELSE:%', r.entity_id;
    end if;
    delete from public.entity_balance_seats where id = any(v_drop);
    if r.quantity - v_per_unit <= 0 then
      delete from public.entity_balances where id = r.id;
    else
      update public.entity_balances set quantity = quantity - v_per_unit where id = r.id;
    end if;
  end loop;

  -- What the new registration includes, expanded exactly as mint_v3_for_order
  -- expands a purchase (minus the registration, which is the relabelled seat).
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
    select p_to_entity_id, 1
    union all
    select ei.to_entity_id, exp.qty * coalesce(ei.quantity, 1)
    from exp
    join effective_includes ei on ei.from_entity_id = exp.entity_id
  )
  select p_conference_id, v_seat.organization_id, v_purchase_id, exp.entity_id, sum(exp.qty)
  from exp
  join public.conference_entities ce on ce.id = exp.entity_id
  where ce.kind not in ('day', 'item', 'meal', 'suite')
    and exp.entity_id <> p_to_entity_id
  group by exp.entity_id;

  insert into public.entity_balance_seats(conference_id, organization_id, balance_id, entity_id, seat_index)
  select b.conference_id, b.organization_id, b.id, b.entity_id, gs.i
  from public.entity_balances b
  join public.conference_entities ce on ce.id = b.entity_id
  cross join lateral generate_series(1, greatest(b.quantity, 1)) gs(i)
  where b.purchase_id = v_purchase_id
    and b.id <> v_registration_balance_id
    and ce.kind <> 'booth';

  insert into public.conference_registration_changes (
    conference_id, organization_id, seat_id, holder_person_id, from_entity_id, to_entity_id,
    from_purchase_id, to_purchase_id, actor_id, reason
  ) values (
    p_conference_id, v_seat.organization_id, v_seat.id, v_seat.holder_person_id, v_from.id, p_to_entity_id,
    v_old_purchase.id, v_purchase_id, p_actor_id, p_reason
  ) returning id into v_change_id;

  return jsonb_build_object(
    'change_id', v_change_id,
    'purchase_id', v_purchase_id,
    'holder_person_id', v_seat.holder_person_id
  );
end;
$$;

revoke execute on function public.change_registration_offer(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.change_registration_offer(uuid, uuid, uuid, uuid, text)
  to service_role;
