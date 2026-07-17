-- Conference v2 hardening #5: link legacy entitlement seats to grant balances.
--
-- Pre-v2, an "entitlement" was one conference_people row per order item
-- (source_type='entitlement', conference_entitlement_id = order_item_id, one
-- person per item). v2 allocation is seats against grant_balances. This linker
-- attaches each unlinked legacy entitlement person to seat_index 0 of a
-- badge_seat balance minted from the same order item.
--
-- IMPORTANT GATE: a legacy seat can only be linked once its order item's
-- product carries a badge_seat grant. Booth/offsite products were converted in
-- Phase 2, but REGISTRATION products are not granted until the Phase 5 composer.
-- So this links little/nothing today by design; it is re-run during the Phase 5
-- cutover after registration-option entitlements become grants. Until a legacy
-- seat is linked, it keeps working via conference_entitlement_id (badges/
-- check-in read that path until the consumer cutover). The resolver only sees
-- linked seats — so cutover is gated on this backfill reaching 0 unlinked.
-- See docs/CONFERENCE_V2_BLUEPRINT.md.

create or replace function public.link_legacy_entitlement_seats(p_conference_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r            record;
  v_balance_id uuid;
  v_seat_index integer;
  v_linked     integer := 0;
begin
  for r in
    select cp.id as person_id, cp.conference_entitlement_id as order_item_id, cp.conference_id
    from public.conference_people cp
    where cp.source_type = 'entitlement'
      and cp.grant_balance_id is null
      and cp.conference_entitlement_id is not null
      and (p_conference_id is null or cp.conference_id = p_conference_id)
  loop
    -- Prefer a badge_seat balance for this order item; fall back to any active
    -- balance for the item if the product models seats differently.
    select b.id into v_balance_id
    from public.grant_balances b
    where b.order_item_id = r.order_item_id
      and b.status = 'active'
    order by (b.grant_type = 'badge_seat') desc, b.created_at
    limit 1;

    if v_balance_id is null then
      continue; -- no balance yet (product ungranted) — leave for Phase 5 re-run
    end if;

    -- Next free seat index on that balance.
    select coalesce(max(seat_index) + 1, 0) into v_seat_index
    from public.conference_people
    where grant_balance_id = v_balance_id;

    -- Respect capacity: skip if the balance is already full.
    if v_seat_index >= (select qty_total from public.grant_balances where id = v_balance_id) then
      continue;
    end if;

    update public.conference_people
    set grant_balance_id = v_balance_id,
        seat_index = v_seat_index,
        updated_at = now()
    where id = r.person_id;

    update public.grant_balances b
    set qty_assigned = (
      select count(*) from public.conference_people cp
      where cp.grant_balance_id = b.id
        and cp.assignment_status in ('assigned', 'pending_user_activation', 'reassigned')
    ),
    updated_at = now()
    where b.id = v_balance_id;

    v_linked := v_linked + 1;
  end loop;

  return v_linked;
end;
$$;

comment on function public.link_legacy_entitlement_seats(uuid) is
  'Links pre-v2 entitlement conference_people rows to badge_seat grant balances by order item. Re-run during Phase 5 cutover after registration products are granted. Cutover gate: 0 unlinked entitlement seats.';

-- Run once now (links only where products already carry grants).
select public.link_legacy_entitlement_seats();
