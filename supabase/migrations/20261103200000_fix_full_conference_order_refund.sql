-- A FULL conference refund has failed every time since the v3 cutover.
--
-- process_conference_order_refund still decremented conference_products and
-- marked grant_balances refunded on a full refund. Both tables (and
-- conference_order_items.product_id) were dropped in
-- 20260618153204_conference_v3_cutover_drop_product_engine, so the moment a
-- refund reached the order's total the function raised 42P01 and nothing was
-- recorded. A partial refund never reached that branch, which is why the two
-- partially_refunded orders exist and no conference order has ever been
-- 'refunded'.
--
-- Callers: the Stripe charge.refunded webhook, the admin manual refund, booth
-- moves (execute_booth_move) and the CANCOLL switch
-- (convert_registration_to_funded), where a one-registration school's refund
-- is the whole order: Stripe refunded, then the switch rolled back.
--
-- Found 2026-11-03 testing the CANCOLL switch on a scratch org. Holdings are
-- unaffected either way: what an org holds lives in entity_balances, which a
-- refund has never touched.

create or replace function public.process_conference_order_refund(p_order_id uuid, p_refund_amount_cents integer)
 returns conference_orders
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
$function$;
