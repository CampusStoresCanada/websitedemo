-- Conference v2 slice 2b: grant scoping moves onto faceted elements; the old
-- separate noun tables (offsite/meal/education) are removed. Safe to drop on
-- the clean slate (no data). Days stay as the time spine (product_grant_days).

alter table public.product_grants drop column if exists scope_offsite_event_id;
alter table public.product_grants
  add column if not exists scope_element_id uuid references public.conference_elements(id) on delete set null;

alter table public.grant_balances drop column if exists scope_offsite_event_id;
alter table public.grant_balances add column if not exists scope_element_id uuid;

create table if not exists public.product_grant_elements (
  grant_id   uuid not null references public.product_grants(id) on delete cascade,
  element_id uuid not null references public.conference_elements(id) on delete cascade,
  primary key (grant_id, element_id)
);
create index if not exists idx_product_grant_elements_element
  on public.product_grant_elements(element_id);

alter table public.product_grant_elements enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='product_grant_elements' and policyname='product_grant_elements_authenticated_read') then
    create policy "product_grant_elements_authenticated_read" on public.product_grant_elements for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='product_grant_elements' and policyname='product_grant_elements_admin_all') then
    create policy "product_grant_elements_admin_all" on public.product_grant_elements for all
      using (exists (select 1 from public.profiles where id=auth.uid() and global_role in ('admin','super_admin')))
      with check (exists (select 1 from public.profiles where id=auth.uid() and global_role in ('admin','super_admin')));
  end if;
end $$;

drop table if exists public.product_grant_meals;
drop table if exists public.product_grant_sessions;
drop table if exists public.conference_offsite_events;
drop table if exists public.conference_meal_services;
drop table if exists public.conference_education_sessions;

drop function if exists public.reconcile_conference_catalog(uuid);
drop function if exists public.trg_reconcile_catalog_from_module();
drop function if exists public.trg_reconcile_catalog_from_instance();

create or replace function public.set_product_grants(
  p_product_id uuid,
  p_grants jsonb
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  g            jsonb;
  v_grant_id   uuid;
  v_grant_ids  uuid[] := array[]::uuid[];
  d            jsonb;
  el           jsonb;
begin
  if not exists (select 1 from public.conference_products where id = p_product_id) then
    raise exception 'PRODUCT_NOT_FOUND:%', p_product_id;
  end if;

  delete from public.product_grants where product_id = p_product_id;

  for g in select * from jsonb_array_elements(coalesce(p_grants, '[]'::jsonb))
  loop
    insert into public.product_grants (
      product_id, grant_type, quantity, per, scope_mode,
      scope_registration_type, scope_booth_id, scope_element_id, notes
    )
    values (
      p_product_id,
      g->>'grant_type',
      coalesce((g->>'quantity')::integer, 1),
      coalesce(g->>'per', 'order'),
      coalesce(g->>'scope_mode', 'all'),
      nullif(g->>'scope_registration_type', ''),
      nullif(g->>'scope_booth_id', '')::uuid,
      nullif(g->>'scope_element_id', '')::uuid,
      nullif(g->>'notes', '')
    )
    returning id into v_grant_id;

    v_grant_ids := v_grant_ids || v_grant_id;

    for d in select * from jsonb_array_elements(coalesce(g->'day_scopes', '[]'::jsonb))
    loop
      insert into public.product_grant_days (grant_id, day_id, access_kind)
      values (v_grant_id, (d->>'day_id')::uuid, coalesce(d->>'access_kind', 'floor'))
      on conflict (grant_id, day_id, access_kind) do nothing;
    end loop;

    for el in select * from jsonb_array_elements(coalesce(g->'element_ids', '[]'::jsonb))
    loop
      insert into public.product_grant_elements (grant_id, element_id)
      values (v_grant_id, (el #>> '{}')::uuid)
      on conflict do nothing;
    end loop;
  end loop;

  return v_grant_ids;
end;
$$;

create or replace function public.mint_grant_balances_for_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  minted integer;
begin
  insert into public.grant_balances (
    order_id, order_item_id, grant_id, conference_id, organization_id,
    grant_type, per, scope_mode, scope_registration_type, scope_element_id,
    qty_total
  )
  select
    o.id, oi.id, g.id, o.conference_id, o.organization_id,
    g.grant_type, g.per, g.scope_mode, g.scope_registration_type, g.scope_element_id,
    g.quantity * oi.quantity
  from public.conference_orders o
  join public.conference_order_items oi on oi.order_id = o.id
  join public.product_grants g on g.product_id = oi.product_id
  where o.id = p_order_id
    and o.status = 'paid'
    and g.per = 'order'
    and not exists (
      select 1 from public.grant_balances b
      where b.order_item_id = oi.id and b.grant_id = g.id
    );

  get diagnostics minted = row_count;
  return minted;
end;
$$;
