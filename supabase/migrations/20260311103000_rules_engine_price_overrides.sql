-- Rules engine pricing outcomes: allow checkout to pass per-product unit price overrides.
-- Backward compatible: new arg defaults to null.

create or replace function public.create_conference_order_from_cart(
  p_user_id uuid,
  p_organization_id uuid,
  p_conference_id uuid,
  p_checkout_idempotency_key text,
  p_tax_rate_pct numeric default 0,
  p_currency text default 'CAD',
  p_price_overrides jsonb default null
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
  effective_unit_price integer;
  override_value text;
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

    effective_unit_price := product_row.price_cents;
    if p_price_overrides is not null then
      override_value := p_price_overrides ->> cart_row.product_id::text;
      if override_value is not null and override_value ~ '^[0-9]+$' then
        effective_unit_price := greatest(0, override_value::integer);
      end if;
    end if;

    line_subtotal := cart_row.quantity * effective_unit_price;
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

    effective_unit_price := product_row.price_cents;
    if p_price_overrides is not null then
      override_value := p_price_overrides ->> cart_row.product_id::text;
      if override_value is not null and override_value ~ '^[0-9]+$' then
        effective_unit_price := greatest(0, override_value::integer);
      end if;
    end if;

    line_subtotal := cart_row.quantity * effective_unit_price;
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
      effective_unit_price,
      line_tax,
      line_subtotal + line_tax,
      cart_row.metadata
    );
  end loop;

  return new_order;
end;
$$;
