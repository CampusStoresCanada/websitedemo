-- Conference v2 Phase 3: grant balances — layer 2 of the commerce model.
-- When a conference order is paid, each order item's product grants mint a
-- quantity-aware balance ("3 badge seats, 0 assigned"). Org admins then
-- allocate seats (conference_people rows) against balances — layer 3.
-- See docs/CONFERENCE_V2_BLUEPRINT.md.
--
-- This replaces the fatal one-seat-per-order-item limitation of the legacy
-- entitlement model (conference_entitlement_id → conference_order_items with
-- a single conference_people row per item).

-- ─────────────────────────────────────────────────────────────────────────────
-- grant_balances
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.grant_balances (
  id                       uuid        primary key default gen_random_uuid(),
  order_id                 uuid        not null references public.conference_orders(id) on delete cascade,
  order_item_id            uuid        not null references public.conference_order_items(id) on delete cascade,
  -- The grant definition this was minted from. SET NULL on delete: the sold
  -- promise outlives the definition. grant_type/quantity/scopes below are
  -- snapshots taken at mint time for exactly that reason.
  grant_id                 uuid        references public.product_grants(id) on delete set null,
  conference_id            uuid        not null references public.conference_instances(id) on delete cascade,
  organization_id          uuid        references public.organizations(id) on delete set null,

  grant_type               text        not null,
  per                      text        not null default 'order',
  scope_mode               text        not null default 'all',
  scope_registration_type  text,
  scope_offsite_event_id   uuid        references public.conference_offsite_events(id) on delete set null,

  qty_total                integer     not null check (qty_total > 0),
  qty_assigned             integer     not null default 0
                             check (qty_assigned >= 0 and qty_assigned <= qty_total),
  status                   text        not null default 'active'
                             check (status in ('active', 'refunded', 'voided')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.grant_balances is
  'Minted on payment: one row per (order item x product grant). qty_assigned tracks seat allocation by org admins.';

create unique index if not exists uniq_grant_balances_item_grant
  on public.grant_balances(order_item_id, grant_id)
  where grant_id is not null;

create index if not exists idx_grant_balances_conference_org
  on public.grant_balances(conference_id, organization_id);

create index if not exists idx_grant_balances_order
  on public.grant_balances(order_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- conference_people gains balance-based seat keys (legacy columns untouched)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.conference_people
  add column if not exists grant_balance_id uuid references public.grant_balances(id) on delete cascade,
  add column if not exists seat_index integer;

create unique index if not exists uniq_conference_people_balance_seat
  on public.conference_people(grant_balance_id, seat_index)
  where grant_balance_id is not null;

comment on column public.conference_people.grant_balance_id is
  'v2 seat allocation: which grant balance this person row occupies (with seat_index). Legacy rows keep conference_entitlement_id.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.grant_balances enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'grant_balances'
      and policyname = 'grant_balances_authenticated_read'
  ) then
    create policy "grant_balances_authenticated_read"
      on public.grant_balances for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'grant_balances'
      and policyname = 'grant_balances_admin_all'
  ) then
    create policy "grant_balances_admin_all"
      on public.grant_balances for all
      using (
        exists (
          select 1 from public.profiles
          where id = auth.uid() and global_role in ('admin', 'super_admin')
        )
      )
      with check (
        exists (
          select 1 from public.profiles
          where id = auth.uid() and global_role in ('admin', 'super_admin')
        )
      );
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Minting helper — idempotent; used by the paid RPC and the backfill below
-- ─────────────────────────────────────────────────────────────────────────────

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
    grant_type, per, scope_mode, scope_registration_type, scope_offsite_event_id,
    qty_total
  )
  select
    o.id, oi.id, g.id, o.conference_id, o.organization_id,
    g.grant_type, g.per, g.scope_mode, g.scope_registration_type, g.scope_offsite_event_id,
    g.quantity * oi.quantity
  from public.conference_orders o
  join public.conference_order_items oi on oi.order_id = o.id
  join public.product_grants g on g.product_id = oi.product_id
  where o.id = p_order_id
    and o.status = 'paid'
    -- per='attendee' grants multiply per assigned attendee; they are derived
    -- at allocation time, not minted as order-level balances
    and g.per = 'order'
    and not exists (
      select 1 from public.grant_balances b
      where b.order_item_id = oi.id and b.grant_id = g.id
    );

  get diagnostics minted = row_count;
  return minted;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- process_conference_order_paid: existing behavior + balance minting
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.process_conference_order_paid(
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text default null
)
returns public.conference_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_order public.conference_orders%rowtype;
begin
  select *
  into existing_order
  from public.conference_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND:%', p_order_id;
  end if;

  if existing_order.status = 'pending' then
    update public.conference_orders
    set
      status = 'paid',
      paid_at = coalesce(existing_order.paid_at, now()),
      stripe_checkout_session_id = coalesce(p_checkout_session_id, existing_order.stripe_checkout_session_id),
      stripe_payment_intent_id = coalesce(p_payment_intent_id, existing_order.stripe_payment_intent_id)
    where id = p_order_id;

    update public.conference_products cp
    set current_sold = cp.current_sold + oi.quantity
    from public.conference_order_items oi
    where oi.order_id = p_order_id
      and oi.product_id = cp.id;
  else
    update public.conference_orders
    set
      stripe_checkout_session_id = coalesce(p_checkout_session_id, stripe_checkout_session_id),
      stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
    where id = p_order_id;
  end if;

  -- v2: mint grant balances once the order is paid (idempotent; also fills in
  -- balances on webhook retries for orders paid before grants existed)
  perform public.mint_grant_balances_for_order(p_order_id);

  select *
  into existing_order
  from public.conference_orders
  where id = p_order_id;

  return existing_order;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- process_conference_order_refund: existing behavior + balance status update
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.process_conference_order_refund(
  p_order_id uuid,
  p_refund_amount_cents integer
)
returns public.conference_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_order public.conference_orders%rowtype;
  next_status text;
  next_refund integer;
begin
  select *
  into existing_order
  from public.conference_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND:%', p_order_id;
  end if;

  if existing_order.status not in ('paid', 'partially_refunded', 'refunded') then
    return existing_order;
  end if;

  next_refund := greatest(0, coalesce(p_refund_amount_cents, 0));
  next_status := case
    when next_refund >= existing_order.total_cents then 'refunded'
    when next_refund > 0 then 'partially_refunded'
    else existing_order.status
  end;

  if next_status = 'refunded' and existing_order.status <> 'refunded' then
    update public.conference_products cp
    set current_sold = greatest(0, cp.current_sold - oi.quantity)
    from public.conference_order_items oi
    where oi.order_id = p_order_id
      and oi.product_id = cp.id;

    -- v2: a full refund voids the order's grant balances. Partial refunds are
    -- item-level decisions and stay with the admin (balances untouched).
    update public.grant_balances
    set status = 'refunded', updated_at = now()
    where order_id = p_order_id
      and status = 'active';
  end if;

  update public.conference_orders
  set
    status = next_status,
    refund_amount_cents = next_refund,
    refunded_at = case when next_refund > 0 then now() else refunded_at end
  where id = p_order_id;

  select *
  into existing_order
  from public.conference_orders
  where id = p_order_id;

  return existing_order;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: mint balances for already-paid orders
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  o record;
begin
  for o in select id from public.conference_orders where status = 'paid'
  loop
    perform public.mint_grant_balances_for_order(o.id);
  end loop;
end $$;
