-- Fork B · slice B4-seats — the assignable unit is a SEAT, not a balance.
--
-- A booth's 4 registrations mint as one balance of quantity 4; a single
-- holder_person_id can't split those across 4 different staff. Seats fix that:
-- each balance gets `quantity` seats, and each seat is assigned to one person.
-- The resolver + obligations + allocation now read seats (holder_person_id on a
-- balance becomes vestigial). Mirrors the legacy conference_people.seat_index.

create table if not exists public.entity_balance_seats (
  id               uuid        primary key default gen_random_uuid(),
  conference_id    uuid        not null references public.conference_instances(id) on delete cascade,
  organization_id  uuid        references public.organizations(id) on delete set null,
  balance_id       uuid        not null references public.entity_balances(id) on delete cascade,
  entity_id        uuid        not null references public.conference_entities(id) on delete cascade,
  seat_index       integer     not null,
  holder_person_id uuid        references public.conference_people(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (balance_id, seat_index)
);
create index if not exists idx_entity_balance_seats_org on public.entity_balance_seats(conference_id, organization_id);
create index if not exists idx_entity_balance_seats_holder on public.entity_balance_seats(holder_person_id);
create index if not exists idx_entity_balance_seats_entity on public.entity_balance_seats(entity_id);

alter table public.entity_balance_seats enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='entity_balance_seats' and policyname='entity_balance_seats_authenticated_read') then
    execute 'create policy entity_balance_seats_authenticated_read on public.entity_balance_seats for select to authenticated using (true)';
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='entity_balance_seats' and policyname='entity_balance_seats_admin_all') then
    execute 'create policy entity_balance_seats_admin_all on public.entity_balance_seats for all using (
        exists (select 1 from public.profiles where id=auth.uid() and global_role in (''admin'',''super_admin''))
      ) with check (
        exists (select 1 from public.profiles where id=auth.uid() and global_role in (''admin'',''super_admin''))
      )';
  end if;
end $$;

-- Backfill seats for any balances that predate this table.
insert into public.entity_balance_seats (conference_id, organization_id, balance_id, entity_id, seat_index)
select b.conference_id, b.organization_id, b.id, b.entity_id, gs.i
from public.entity_balances b
cross join lateral generate_series(1, greatest(b.quantity, 1)) gs(i)
where not exists (select 1 from public.entity_balance_seats s where s.balance_id = b.id);

-- Mint (direct/admin path): create seats after balances.
create or replace function public.mint_entity_offer_purchase(
  p_conference_id uuid, p_offer_id uuid, p_quantity integer, p_buyer text,
  p_unit_price integer default null, p_buyer_tier text default null
) returns uuid
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
  with recursive exp(entity_id, qty) as (
    select p_offer_id, v_qty
    union all
    select r.to_entity_id, exp.qty * coalesce(r.quantity, 1)
    from exp join public.conference_entity_refs r
      on r.from_entity_id = exp.entity_id and r.role = 'includes' and r.conference_id = p_conference_id
  )
  select p_conference_id, v_purchase, entity_id, sum(qty) from exp group by entity_id;

  insert into public.entity_balance_seats(conference_id, organization_id, balance_id, entity_id, seat_index)
  select b.conference_id, b.organization_id, b.id, b.entity_id, gs.i
  from public.entity_balances b
  cross join lateral generate_series(1, greatest(b.quantity, 1)) gs(i)
  where b.purchase_id = v_purchase;

  return v_purchase;
end;
$function$;

-- Mint (order path): create seats after balances.
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
    with recursive exp(entity_id, qty) as (
      select r.offer_entity_id, greatest(r.quantity, 1)
      union all
      select er.to_entity_id, exp.qty * coalesce(er.quantity, 1)
      from exp join public.conference_entity_refs er
        on er.from_entity_id = exp.entity_id and er.role = 'includes' and er.conference_id = v_conf
    )
    select v_conf, v_org, v_purchase, entity_id, sum(qty) from exp group by entity_id;

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

-- Resolver: a person's held things come from the SEATS they occupy.
create or replace function public.resolve_person_access(p_conference_id uuid, p_person_id uuid)
returns table (entity_id uuid)
language sql
as $$
  with recursive held as (
    select s.entity_id from public.entity_balance_seats s
    where s.conference_id = p_conference_id and s.holder_person_id = p_person_id
  ),
  acc(entity_id) as (
    select h.entity_id from held h
    union
    select r.to_entity_id
    from acc a
    join public.conference_entity_refs r
      on r.from_entity_id = a.entity_id and r.role in ('includes', 'involved_in') and r.conference_id = p_conference_id
  )
  select a.entity_id from acc a;
$$;
