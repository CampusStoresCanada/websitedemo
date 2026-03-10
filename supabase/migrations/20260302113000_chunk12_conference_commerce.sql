-- Chunk 12: Conference Commerce (backend-first)
-- Forward-only, idempotent-safe DDL + transactional order creation helper.

create extension if not exists pgcrypto;

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  product_id uuid not null references public.conference_products(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, organization_id, conference_id, product_id)
);

create index if not exists idx_cart_items_user_conf
  on public.cart_items(user_id, conference_id);
create index if not exists idx_cart_items_org_conf
  on public.cart_items(organization_id, conference_id);

create table if not exists public.conference_orders (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','paid','partially_refunded','refunded','canceled')),
  checkout_idempotency_key text unique,
  subtotal_cents integer not null,
  tax_cents integer not null,
  total_cents integer not null,
  currency text not null default 'CAD',
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  invoice_id uuid references public.invoices(id),
  paid_at timestamptz,
  refunded_at timestamptz,
  refund_amount_cents integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_conference_orders_conf
  on public.conference_orders(conference_id);
create index if not exists idx_conference_orders_org
  on public.conference_orders(organization_id);
create unique index if not exists idx_conference_orders_checkout_session
  on public.conference_orders(stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create table if not exists public.conference_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.conference_orders(id) on delete cascade,
  product_id uuid not null references public.conference_products(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null,
  tax_cents integer not null,
  total_cents integer not null,
  metadata jsonb
);

create index if not exists idx_conference_order_items_order
  on public.conference_order_items(order_id);
create index if not exists idx_conference_order_items_product
  on public.conference_order_items(product_id);

create table if not exists public.wishlist_intents (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.conference_products(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  status text not null default 'wishlisted'
    check (status in (
      'wishlisted','board_pending','board_approved','board_declined',
      'billing_pending','billing_paid','billing_failed_retryable',
      'billing_failed_final','reservation_expired','registered'
    )),
  stripe_setup_intent_id text,
  stripe_payment_method_id text,
  queue_position integer,
  wishlisted_at timestamptz not null default now(),
  board_decided_at timestamptz,
  billing_attempted_at timestamptz,
  billing_paid_at timestamptz,
  expires_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_wishlist_fifo
  on public.wishlist_intents(conference_id, product_id, wishlisted_at);
create index if not exists idx_wishlist_fifo_stable
  on public.wishlist_intents(conference_id, product_id, wishlisted_at, id);

create table if not exists public.billing_runs (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','running','completed','failed')),
  total_items integer default 0,
  successful_items integer default 0,
  failed_items integer default 0,
  started_at timestamptz,
  completed_at timestamptz,
  triggered_by uuid references public.profiles(id),
  metadata jsonb
);

create table if not exists public.conference_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  conference_order_id uuid references public.conference_orders(id) on delete set null,
  processed_at timestamptz not null default now(),
  success boolean not null default true,
  error_message text
);

alter table public.cart_items enable row level security;
alter table public.conference_orders enable row level security;
alter table public.conference_order_items enable row level security;
alter table public.wishlist_intents enable row level security;
alter table public.billing_runs enable row level security;
alter table public.conference_webhook_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'cart_items' and policyname = 'cart_items_select_authenticated'
  ) then
    create policy cart_items_select_authenticated
      on public.cart_items for select to authenticated using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conference_orders' and policyname = 'conference_orders_select_authenticated'
  ) then
    create policy conference_orders_select_authenticated
      on public.conference_orders for select to authenticated using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conference_order_items' and policyname = 'conference_order_items_select_authenticated'
  ) then
    create policy conference_order_items_select_authenticated
      on public.conference_order_items for select to authenticated using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'wishlist_intents' and policyname = 'wishlist_intents_select_authenticated'
  ) then
    create policy wishlist_intents_select_authenticated
      on public.wishlist_intents for select to authenticated using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'billing_runs' and policyname = 'billing_runs_select_authenticated'
  ) then
    create policy billing_runs_select_authenticated
      on public.billing_runs for select to authenticated using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conference_webhook_events' and policyname = 'conference_webhook_events_select_authenticated'
  ) then
    create policy conference_webhook_events_select_authenticated
      on public.conference_webhook_events for select to authenticated using (true);
  end if;
end
$$;

create or replace function public.create_conference_order_from_cart(
  p_user_id uuid,
  p_organization_id uuid,
  p_conference_id uuid,
  p_checkout_idempotency_key text,
  p_tax_rate_pct numeric default 0,
  p_currency text default 'CAD'
)
returns public.conference_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_order public.conference_orders%rowtype;
  new_order public.conference_orders%rowtype;
  cart_row record;
  product_row record;
  reserved_qty integer;
  line_subtotal integer;
  line_tax integer;
  subtotal integer := 0;
  tax_total integer := 0;
  total integer := 0;
begin
  if p_checkout_idempotency_key is null or length(trim(p_checkout_idempotency_key)) = 0 then
    raise exception 'CHECKOUT_IDEMPOTENCY_KEY_REQUIRED';
  end if;

  select *
  into existing_order
  from public.conference_orders
  where checkout_idempotency_key = p_checkout_idempotency_key
  limit 1;

  if found then
    return existing_order;
  end if;

  for cart_row in
    select *
    from public.cart_items
    where user_id = p_user_id
      and organization_id = p_organization_id
      and conference_id = p_conference_id
    for update
  loop
    select *
    into product_row
    from public.conference_products
    where id = cart_row.product_id
      and conference_id = p_conference_id
    for update;

    if not found then
      raise exception 'PRODUCT_NOT_FOUND:%', cart_row.product_id;
    end if;

    if product_row.capacity is not null then
      select coalesce(sum(oi.quantity), 0)
      into reserved_qty
      from public.conference_order_items oi
      join public.conference_orders o on o.id = oi.order_id
      where oi.product_id = cart_row.product_id
        and o.status in ('pending', 'paid');

      if reserved_qty + cart_row.quantity > product_row.capacity then
        raise exception 'CAPACITY_EXCEEDED:%', cart_row.product_id;
      end if;
    end if;

    line_subtotal := cart_row.quantity * product_row.price_cents;
    line_tax := case
      when product_row.is_tax_exempt = true then 0
      when product_row.is_taxable = false then 0
      else round(line_subtotal * (coalesce(p_tax_rate_pct, 0) / 100.0))::integer
    end;

    subtotal := subtotal + line_subtotal;
    tax_total := tax_total + line_tax;
  end loop;

  if subtotal <= 0 then
    raise exception 'EMPTY_CART';
  end if;

  total := subtotal + tax_total;

  insert into public.conference_orders (
    conference_id,
    organization_id,
    user_id,
    status,
    checkout_idempotency_key,
    subtotal_cents,
    tax_cents,
    total_cents,
    currency
  )
  values (
    p_conference_id,
    p_organization_id,
    p_user_id,
    'pending',
    p_checkout_idempotency_key,
    subtotal,
    tax_total,
    total,
    p_currency
  )
  returning * into new_order;

  for cart_row in
    select *
    from public.cart_items
    where user_id = p_user_id
      and organization_id = p_organization_id
      and conference_id = p_conference_id
  loop
    select *
    into product_row
    from public.conference_products
    where id = cart_row.product_id
      and conference_id = p_conference_id;

    line_subtotal := cart_row.quantity * product_row.price_cents;
    line_tax := case
      when product_row.is_tax_exempt = true then 0
      when product_row.is_taxable = false then 0
      else round(line_subtotal * (coalesce(p_tax_rate_pct, 0) / 100.0))::integer
    end;

    insert into public.conference_order_items (
      order_id,
      product_id,
      quantity,
      unit_price_cents,
      tax_cents,
      total_cents,
      metadata
    )
    values (
      new_order.id,
      cart_row.product_id,
      cart_row.quantity,
      product_row.price_cents,
      line_tax,
      line_subtotal + line_tax,
      cart_row.metadata
    );
  end loop;

  return new_order;
end;
$$;
