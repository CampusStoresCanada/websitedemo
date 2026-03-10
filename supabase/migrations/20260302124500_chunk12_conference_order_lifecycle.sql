-- Chunk 12 follow-up: conference order lifecycle helpers for webhook-safe updates.

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

  select *
  into existing_order
  from public.conference_orders
  where id = p_order_id;

  return existing_order;
end;
$$;

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
