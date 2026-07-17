-- A pending conference_order (created the moment checkout starts, before Stripe
-- redirect) currently counts against inventory forever if the buyer abandons
-- checkout — nothing ever frees that capacity back up. Give pending orders a
-- TTL: the capacity check in create_conference_order_from_cart stops counting
-- a pending order once it's past expires_at, and a cron flips it to 'canceled'
-- once stale so it stops needing special-casing everywhere else.

alter table public.conference_orders
  add column if not exists expires_at timestamptz;

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

  -- Pricing + capacity pass (Offer lines only).
  for cart_row in
    select * from public.cart_items
    where user_id = p_user_id and organization_id = p_organization_id and conference_id = p_conference_id
      and offer_entity_id is not null
    for update
  loop
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
      where oi.offer_entity_id = cart_row.offer_entity_id
        and (o.status = 'paid' or (o.status = 'pending' and (o.expires_at is null or o.expires_at > now())));
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
  end loop;

  if subtotal <= 0 then
    raise exception 'EMPTY_CART';
  end if;

  total := subtotal + tax_total;

  insert into public.conference_orders (
    conference_id, organization_id, user_id, status, checkout_idempotency_key,
    subtotal_cents, tax_cents, total_cents, currency, expires_at
  ) values (
    p_conference_id, p_organization_id, p_user_id, 'pending', p_checkout_idempotency_key,
    subtotal, tax_total, total, p_currency, now() + interval '60 minutes'
  ) returning * into new_order;

  -- Order-item insert pass (Offer lines only).
  for cart_row in
    select * from public.cart_items
    where user_id = p_user_id and organization_id = p_organization_id and conference_id = p_conference_id
      and offer_entity_id is not null
  loop
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
  end loop;

  return new_order;
end;
$function$;
