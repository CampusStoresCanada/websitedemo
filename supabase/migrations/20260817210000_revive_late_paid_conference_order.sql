-- A conference order gets a 60-minute pending window, after which the expiry
-- job cancels it. A buyer who sits in Stripe Checkout longer than that still
-- completes a real payment, and the webhook still calls this function — which
-- unconditionally minted their booth, seats and membership, but only moved
-- status/paid_at when the order was still 'pending'. So the order stayed
-- 'canceled' with paid_at NULL while the customer was charged and fulfilled.
--
-- Observed live 2026-08-17: Lago Apparel paid $7,458.00 at 19:10 on an order
-- that had expired at 18:43. Booth 704 and their membership were minted
-- correctly and the QuickBooks receipt posted, but the order read 'canceled'
-- in admin, to the customer, and to every paid-order report.
--
-- Fulfilment and status must not diverge: if the money actually arrived,
-- record it. A canceled-but-never-paid order is exactly the expiry case, so
-- it revives. An order canceled AFTER payment (the refund path) has paid_at
-- set and is left alone.

create or replace function public.process_conference_order_paid(
  p_order_id uuid,
  p_checkout_session_id text,
  p_payment_intent_id text default null::text
)
returns conference_orders
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  existing_order public.conference_orders%rowtype;
begin
  select * into existing_order from public.conference_orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND:%', p_order_id;
  end if;

  if existing_order.status = 'pending'
     or (existing_order.status = 'canceled' and existing_order.paid_at is null) then
    update public.conference_orders
    set
      status = 'paid',
      paid_at = coalesce(existing_order.paid_at, now()),
      stripe_checkout_session_id = coalesce(p_checkout_session_id, existing_order.stripe_checkout_session_id),
      stripe_payment_intent_id = coalesce(p_payment_intent_id, existing_order.stripe_payment_intent_id)
    where id = p_order_id;
  else
    update public.conference_orders
    set
      stripe_checkout_session_id = coalesce(p_checkout_session_id, stripe_checkout_session_id),
      stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
    where id = p_order_id;
  end if;

  -- v3: paid orders mint Offer purchases → balances → seats. Unchanged, and
  -- still unconditional — mint_v3_for_order is idempotent and carries its own
  -- booth-exclusivity guard, so a booth resold during the expiry gap raises
  -- BOOTH_ALREADY_SOLD here rather than silently double-selling.
  perform public.mint_v3_for_order(p_order_id);

  select * into existing_order from public.conference_orders where id = p_order_id;
  return existing_order;
end;
$function$;
