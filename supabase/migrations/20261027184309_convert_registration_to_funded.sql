-- Turn one paid registration into the CANCOLL-funded one, keeping its delegate.
--
-- CSC/CANCOLL MOU (2027) 5.5 and 5.6: a school that paid for a registration
-- and then qualifies for CANCOLL funding has the fee refunded by CSC, and that
-- registration becomes the Supported Registration from the date of the refund.
-- The same switch clears through the schools that paid before the program
-- existed, once the board and CANCOLL approve it.
--
-- This is the DB-only middle step, the same shape as execute_booth_move: the
-- application issues the Stripe refund first (it cannot run inside a
-- transaction), then calls this to record that refund and swap the seat
-- atomically.
--
-- ⛔ The seat is RELABELLED, not torn down and re-minted. A booth move releases
-- everything provisioned from the old booth; here the delegate stays exactly
-- who they were, with the same days, meals and meetings, because the funded
-- offer includes the same things. Only which registration they hold changes.
-- The included balances (offsite seat, reception) stay on the original
-- purchase, which is still the record of what the school paid.
--
-- One funded registration per school, enforced here as well as in the app.

create table if not exists public.conference_funded_conversions (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  seat_id uuid not null references public.entity_balance_seats(id) on delete cascade,
  holder_person_id uuid references public.conference_people(id) on delete set null,
  from_entity_id uuid not null references public.conference_entities(id) on delete cascade,
  to_entity_id uuid not null references public.conference_entities(id) on delete cascade,
  funded_purchase_id uuid not null references public.entity_purchases(id) on delete cascade,
  source_order_id uuid references public.conference_orders(id) on delete set null,
  -- Refund issued to the school. Null when it is owed but was not issued
  -- through Stripe (no payment intent on the order: paid out of band).
  refund_id text,
  refund_cents integer,
  actor_id uuid,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_conference_funded_conversions_org
  on public.conference_funded_conversions(organization_id);
create index if not exists idx_conference_funded_conversions_conference
  on public.conference_funded_conversions(conference_id);

revoke all on public.conference_funded_conversions from public, anon, authenticated;

create or replace function public.convert_registration_to_funded(
  p_conference_id uuid,
  p_organization_id uuid,
  p_seat_id uuid,
  p_funded_entity_id uuid,
  p_source_order_id uuid,
  p_cumulative_refund_cents integer,  -- the order's total refunded after this one; null = no Stripe refund
  p_refund_id text,
  p_refund_cents integer,
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
  v_funded public.conference_entities%rowtype;
  v_purchase_id uuid;
  v_new_balance_id uuid;
  v_conversion_id uuid;
begin
  -- One school at a time, so two clicks cannot both pass the one-per-school check.
  perform pg_advisory_xact_lock(hashtext('funded_conversion:' || p_organization_id::text));

  select * into v_funded from public.conference_entities
  where id = p_funded_entity_id and conference_id = p_conference_id;
  if not found or (v_funded.attributes->>'funds_offer_id') is null then
    raise exception 'NOT_A_FUNDED_OFFER';
  end if;

  select * into v_seat from public.entity_balance_seats
  where id = p_seat_id and conference_id = p_conference_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'SEAT_NOT_FOUND';
  end if;
  if v_seat.entity_id <> (v_funded.attributes->>'funds_offer_id')::uuid then
    raise exception 'SEAT_IS_NOT_THE_FUNDED_REGISTRATION';
  end if;

  if exists (
    select 1 from public.entity_balances
    where conference_id = p_conference_id and organization_id = p_organization_id
      and entity_id = p_funded_entity_id and quantity > 0
  ) then
    raise exception 'ALREADY_HAS_FUNDED_REGISTRATION';
  end if;

  select * into v_balance from public.entity_balances where id = v_seat.balance_id for update;

  -- The refund the application already issued in Stripe.
  if p_cumulative_refund_cents is not null then
    perform public.process_conference_order_refund(p_source_order_id, p_cumulative_refund_cents);
  end if;

  insert into public.entity_purchases (conference_id, offer_entity_id, quantity, buyer, price_cents)
  values (p_conference_id, p_funded_entity_id, 1, 'cancoll_conversion:' || coalesce(p_source_order_id::text, 'none'), 0)
  returning id into v_purchase_id;

  if v_balance.quantity <= 1 then
    update public.entity_balances
      set entity_id = p_funded_entity_id, purchase_id = v_purchase_id
      where id = v_balance.id;
    update public.entity_balance_seats
      set entity_id = p_funded_entity_id
      where id = v_seat.id;
  else
    update public.entity_balances set quantity = quantity - 1 where id = v_balance.id;
    insert into public.entity_balances (conference_id, organization_id, purchase_id, entity_id, quantity)
    values (p_conference_id, p_organization_id, v_purchase_id, p_funded_entity_id, 1)
    returning id into v_new_balance_id;
    update public.entity_balance_seats
      set balance_id = v_new_balance_id, entity_id = p_funded_entity_id, seat_index = 1
      where id = v_seat.id;
  end if;

  insert into public.conference_funded_conversions (
    conference_id, organization_id, seat_id, holder_person_id, from_entity_id, to_entity_id,
    funded_purchase_id, source_order_id, refund_id, refund_cents, actor_id, reason
  ) values (
    p_conference_id, p_organization_id, v_seat.id, v_seat.holder_person_id, v_seat.entity_id, p_funded_entity_id,
    v_purchase_id, p_source_order_id, p_refund_id, p_refund_cents, p_actor_id, p_reason
  ) returning id into v_conversion_id;

  return jsonb_build_object('conversion_id', v_conversion_id, 'funded_purchase_id', v_purchase_id);
end;
$$;

revoke execute on function public.convert_registration_to_funded(
  uuid, uuid, uuid, uuid, uuid, integer, text, integer, uuid, text
) from public, anon, authenticated;

grant execute on function public.convert_registration_to_funded(
  uuid, uuid, uuid, uuid, uuid, integer, text, integer, uuid, text
) to service_role;
