-- v3 catalog proof — close the loop: sell an Offer, mint what it includes,
-- resolve what a holder can get into. ISOLATED from the live product/grant
-- engine (adopt-or-discard). The whole point: access + money ride on the
-- reference graph (includes / involved_in), not on bespoke product tables.

create table if not exists public.entity_purchases (
  id              uuid        primary key default gen_random_uuid(),
  conference_id   uuid        not null references public.conference_instances(id) on delete cascade,
  offer_entity_id uuid        not null references public.conference_entities(id) on delete cascade,
  quantity        integer     not null default 1,
  buyer           text,
  created_at      timestamptz not null default now()
);

-- A minted grant: the buyer (later: a person) holds `quantity` of `entity_id`.
create table if not exists public.entity_balances (
  id             uuid        primary key default gen_random_uuid(),
  conference_id  uuid        not null references public.conference_instances(id) on delete cascade,
  purchase_id    uuid        not null references public.entity_purchases(id) on delete cascade,
  entity_id      uuid        not null references public.conference_entities(id) on delete cascade,
  quantity       integer     not null default 1,
  holder         text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_entity_balances_holder on public.entity_balances(conference_id, holder);

-- Mint: expand an Offer's `includes` graph (quantity multiplies down each edge,
-- sums across paths) and record one balance per granted entity. Returns the
-- purchase id. Buying 1 Booth that includes 4× Registration that each include a
-- Day → 4 Day balances. Cycles are prevented on write, so the recursion is safe.
create or replace function public.mint_entity_offer_purchase(
  p_conference_id uuid,
  p_offer_id      uuid,
  p_quantity      integer,
  p_buyer         text
) returns uuid
language plpgsql
as $$
declare
  v_purchase uuid;
begin
  insert into public.entity_purchases(conference_id, offer_entity_id, quantity, buyer)
  values (p_conference_id, p_offer_id, greatest(coalesce(p_quantity, 1), 1), p_buyer)
  returning id into v_purchase;

  insert into public.entity_balances(conference_id, purchase_id, entity_id, quantity)
  with recursive exp(entity_id, qty) as (
    select p_offer_id, greatest(coalesce(p_quantity, 1), 1)
    union all
    select r.to_entity_id, exp.qty * coalesce(r.quantity, 1)
    from exp
    join public.conference_entity_refs r
      on r.from_entity_id = exp.entity_id
     and r.role = 'includes'
     and r.conference_id = p_conference_id
  )
  select p_conference_id, v_purchase, entity_id, sum(qty)
  from exp
  group by entity_id;

  return v_purchase;
end;
$$;

-- Resolve: from everything a holder holds, what can they get into — following
-- `includes` and `involved_in`. This is the bundling rule, generalized: a
-- non-member who holds an Exhibitor Registration that is involved_in the Trade
-- Show can attend the Trade Show, with no special-casing.
create or replace function public.resolve_holder_access(
  p_conference_id uuid,
  p_holder        text
) returns table (entity_id uuid)
language sql
as $$
  with recursive held as (
    select b.entity_id from public.entity_balances b
    where b.conference_id = p_conference_id and b.holder = p_holder
  ),
  acc(entity_id) as (
    select h.entity_id from held h
    union
    select r.to_entity_id
    from acc a
    join public.conference_entity_refs r
      on r.from_entity_id = a.entity_id
     and r.role in ('includes', 'involved_in')
     and r.conference_id = p_conference_id
  )
  select a.entity_id from acc a;
$$;

-- RLS (house pattern: authenticated read, admin write)
alter table public.entity_purchases enable row level security;
alter table public.entity_balances enable row level security;

do $$
declare t text;
begin
  foreach t in array array['entity_purchases', 'entity_balances']
  loop
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_authenticated_read') then
      execute format('create policy %I on public.%I for select to authenticated using (true)', t||'_authenticated_read', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_admin_all') then
      execute format(
        'create policy %I on public.%I for all using (
           exists (select 1 from public.profiles where id=auth.uid() and global_role in (''admin'',''super_admin''))
         ) with check (
           exists (select 1 from public.profiles where id=auth.uid() and global_role in (''admin'',''super_admin''))
         )', t||'_admin_all', t);
    end if;
  end loop;
end $$;
