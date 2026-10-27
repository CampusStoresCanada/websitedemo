-- A cart holding only $0 lines is a real order, not an empty cart.
--
-- The CANCOLL-funded registration (CSC/CANCOLL MOU, 2027) is a $0 line: the
-- school pays nothing and CANCOLL is invoiced separately. A school registering
-- only its funded delegate has a subtotal of 0, and `if subtotal <= 0` refused
-- that as EMPTY_CART, so the one registration the program exists to issue could
-- never be checked out. EMPTY_CART now means what it says: no Offer lines.
--
-- Nothing else changes. Same signature, so CREATE OR REPLACE keeps the
-- service_role-only ACL; the grants are restated anyway so this file stands on
-- its own. The function body is otherwise 20260817200000 verbatim.

create or replace function public.create_conference_order_from_cart(
  p_user_id uuid,
  p_organization_id uuid,
  p_conference_id uuid,
  p_checkout_idempotency_key text,
  p_tax_rate_pct numeric default 0,
  p_currency text default 'CAD'::text,
  p_price_overrides jsonb default null::jsonb,
  p_offer_prices jsonb default null::jsonb,
  p_membership_tax_rate_pct numeric default null::numeric
)
returns conference_orders
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
  line_rate numeric;
  subtotal integer := 0;
  tax_total integer := 0;
  total integer := 0;
  effective_unit_price integer;
  override_value text;
  line_count integer := 0;
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

    line_rate := case
      when offer_row.kind = 'membership_renewal'
        then coalesce(p_membership_tax_rate_pct, p_tax_rate_pct)
      else p_tax_rate_pct
    end;

    line_subtotal := cart_row.quantity * effective_unit_price;
    line_tax := round(line_subtotal * (coalesce(line_rate, 0) / 100.0))::integer;
    subtotal := subtotal + line_subtotal;
    line_count := line_count + 1;
    tax_total := tax_total + line_tax;
  end loop;

  if line_count = 0 then
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

  -- Order-item insert pass (Offer lines only). Must repeat the SAME per-line
  -- rate branch as the pricing pass above — if these two ever disagree the
  -- order header and its line items silently stop reconciling.
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

    line_rate := case
      when offer_row.kind = 'membership_renewal'
        then coalesce(p_membership_tax_rate_pct, p_tax_rate_pct)
      else p_tax_rate_pct
    end;

    line_subtotal := cart_row.quantity * effective_unit_price;
    line_tax := round(line_subtotal * (coalesce(line_rate, 0) / 100.0))::integer;
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

revoke execute on function public.create_conference_order_from_cart(
  uuid, uuid, uuid, text, numeric, text, jsonb, jsonb, numeric
) from public;

grant execute on function public.create_conference_order_from_cart(
  uuid, uuid, uuid, text, numeric, text, jsonb, jsonb, numeric
) to service_role;
