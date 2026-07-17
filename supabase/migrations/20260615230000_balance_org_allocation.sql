-- Fork B · slice B4 — org-scoped allocation of v3 balances.
--
-- The old grant_balances carried organization_id directly; v3 entity_balances
-- only linked org via purchase→order. Denormalize organization_id onto the
-- balance (set at mint from the order's org) so an org admin can list and
-- allocate their minted grants to attendees in one hop — exactly how
-- listOrganizationGrantBalances works for the legacy model.

alter table public.entity_balances
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

create index if not exists idx_entity_balances_org
  on public.entity_balances(conference_id, organization_id);

-- mint_v3_for_order now stamps the order's org onto every balance it mints.
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
  select conference_id, organization_id into v_conf, v_org
  from public.conference_orders where id = p_order_id;
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

    insert into public.entity_balances(conference_id, organization_id, purchase_id, entity_id, quantity)
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
    select v_conf, v_org, v_purchase, entity_id, sum(qty)
    from exp
    group by entity_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
