-- Fork B · slice B2c — the order-creation RPC handles v3 Offer cart lines.
--
-- B2b lets an Offer into the cart; this RPC previously looked up EVERY cart row
-- in conference_products, so an offer line (null product_id) raised
-- PRODUCT_NOT_FOUND. Now offer rows are priced from p_offer_prices (the buyer's
-- tier price, computed in TS) or the Offer's base price, capacity-checked against
-- inventory, taxed at the conference rate, and inserted as offer order_items.
--
-- The two old overloads are dropped so the new 8-arg version is unambiguous
-- (the app calls it with 8 named params; p_offer_prices defaults null otherwise).

drop function if exists public.create_conference_order_from_cart(uuid, uuid, uuid, text, numeric, text);
drop function if exists public.create_conference_order_from_cart(uuid, uuid, uuid, text, numeric, text, jsonb);

create or replace function public.create_conference_order_from_cart(
  p_user_id uuid,
  p_organization_id uuid,
  p_conference_id uuid,
  p_checkout_idempotency_key text,
  p_tax_rate_pct numeric default 0,
  p_currency text default 'CAD',
  p_price_overrides jsonb default null,
  p_offer_prices jsonb default null
) returns conference_orders
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  existing_order public.conference_orders%rowtype;
  new_order public.conference_orders%rowtype;
  cart_row record;
  product_row public.conference_products%rowtype;
  offer_row public.conference_entities%rowtype;
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

  select * into existing_order
  from public.conference_orders
  where checkout_idempotency_key = p_checkout_idempotency_key
  limit 1;
  if found then
    return existing_order;
  end if;

  -- Validation pass: price, tax, capacity.
  for cart_row in
    select * from public.cart_items
    where user_id = p_user_id and organization_id = p_organization_id and conference_id = p_conference_id
    for update
  loop
    if cart_row.offer_entity_id is not null then
      select * into offer_row
      from public.conference_entities
      where id = cart_row.offer_entity_id and conference_id = p_conference_id
      for update;
      if not found then
        raise exception 'OFFER_NOT_FOUND:%', cart_row.offer_entity_id;
      end if;

      if offer_row.inventory is not null then
        select coalesce(sum(oi.quantity), 0) into reserved_qty
        from public.conference_order_items oi
        join public.conference_orders o on o.id = oi.order_id
        where oi.offer_entity_id = cart_row.offer_entity_id and o.status in ('pending', 'paid');
        if reserved_qty + cart_row.quantity > offer_row.inventory then
          raise exception 'CAPACITY_EXCEEDED:%', cart_row.offer_entity_id;
        end if;
      end if;

      effective_unit_price := coalesce(offer_row.price_cents, 0);
      if p_offer_prices is not null then
        override_value := p_offer_prices ->> cart_row.offer_entity_id::text;
        if override_value is not null and override_value ~ '^[0-9]+$' then
          effective_unit_price := greatest(0, override_value::integer);
        end if;
      end if;

      line_subtotal := cart_row.quantity * effective_unit_price;
      line_tax := round(line_subtotal * (coalesce(p_tax_rate_pct, 0) / 100.0))::integer;
      subtotal := subtotal + line_subtotal;
      tax_total := tax_total + line_tax;
      continue;
    end if;

    -- Legacy product line (unchanged).
    select * into product_row
    from public.conference_products
    where id = cart_row.product_id and conference_id = p_conference_id
    for update;
    if not found then
      raise exception 'PRODUCT_NOT_FOUND:%', cart_row.product_id;
    end if;

    if product_row.capacity is not null then
      select coalesce(sum(oi.quantity), 0) into reserved_qty
      from public.conference_order_items oi
      join public.conference_orders o on o.id = oi.order_id
      where oi.product_id = cart_row.product_id and o.status in ('pending', 'paid');
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
    conference_id, organization_id, user_id, status, checkout_idempotency_key,
    subtotal_cents, tax_cents, total_cents, currency
  ) values (
    p_conference_id, p_organization_id, p_user_id, 'pending', p_checkout_idempotency_key,
    subtotal, tax_total, total, p_currency
  ) returning * into new_order;

  -- Insert pass.
  for cart_row in
    select * from public.cart_items
    where user_id = p_user_id and organization_id = p_organization_id and conference_id = p_conference_id
  loop
    if cart_row.offer_entity_id is not null then
      select * into offer_row from public.conference_entities
      where id = cart_row.offer_entity_id and conference_id = p_conference_id;

      effective_unit_price := coalesce(offer_row.price_cents, 0);
      if p_offer_prices is not null then
        override_value := p_offer_prices ->> cart_row.offer_entity_id::text;
        if override_value is not null and override_value ~ '^[0-9]+$' then
          effective_unit_price := greatest(0, override_value::integer);
        end if;
      end if;

      line_subtotal := cart_row.quantity * effective_unit_price;
      line_tax := round(line_subtotal * (coalesce(p_tax_rate_pct, 0) / 100.0))::integer;
      insert into public.conference_order_items (
        order_id, offer_entity_id, quantity, unit_price_cents, tax_cents, total_cents, metadata
      ) values (
        new_order.id, cart_row.offer_entity_id, cart_row.quantity, effective_unit_price,
        line_tax, line_subtotal + line_tax, cart_row.metadata
      );
      continue;
    end if;

    select * into product_row from public.conference_products
    where id = cart_row.product_id and conference_id = p_conference_id;

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
      order_id, product_id, quantity, unit_price_cents, tax_cents, total_cents, metadata
    ) values (
      new_order.id, cart_row.product_id, cart_row.quantity, effective_unit_price,
      line_tax, line_subtotal + line_tax, cart_row.metadata
    );
  end loop;

  return new_order;
end;
$function$;
