-- Admin tool: move an org's booth(s) to different booth(s) at the same
-- conference. Full teardown of old-booth provisioning + fresh grant of new
-- booths, as one atomic DB step — the Stripe refund/checkout-session calls
-- that bracket this happen in the application layer (lib/actions/
-- conference-booth-moves.ts), since Stripe calls can't run inside a
-- Postgres transaction. This function is the DB-only middle step:
-- release old booths' entire provisioning cascade, record refund
-- bookkeeping already issued in Stripe, grant the new booths (minting
-- immediately if no additional payment is owed), and log an audit row.

create table if not exists public.conference_booth_moves (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  old_booth_entity_ids uuid[] not null,
  new_booth_entity_ids uuid[] not null,
  old_total_cents integer not null,
  new_total_cents integer not null,
  delta_cents integer not null,
  refund_ids text[] not null default '{}',
  new_order_id uuid references public.conference_orders(id) on delete set null,
  actor_id uuid,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_conference_booth_moves_org on public.conference_booth_moves(organization_id);
create index if not exists idx_conference_booth_moves_conference on public.conference_booth_moves(conference_id);

revoke all on public.conference_booth_moves from public, anon, authenticated;

create or replace function public.execute_booth_move(
  p_organization_id uuid,
  p_conference_id uuid,
  p_old_booth_entity_ids uuid[],
  p_new_booth_entity_ids uuid[],
  p_old_total_cents integer,
  p_new_total_cents integer,
  p_refund_updates jsonb,        -- [{"order_id": uuid, "cumulative_refund_cents": int}]
  p_refund_ids text[],
  p_new_order_subtotal_cents integer,
  p_new_order_tax_cents integer,
  p_new_order_total_cents integer,
  p_stripe_checkout_session_id text,
  p_should_mint_immediately boolean,
  p_actor_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_new_booth_id uuid;
  v_booth_conflict boolean;
  v_refund_update jsonb;
  v_old_purchase_ids uuid[];
  v_person_ids uuid[];
  v_new_order_id uuid;
begin
  -- Re-validate the new booths are still free, right before granting them —
  -- same exclusivity guard mint_v3_for_order uses, so a race between
  -- "admin opened this modal" and "admin clicked confirm" can't double-sell.
  foreach v_new_booth_id in array p_new_booth_entity_ids loop
    perform pg_advisory_xact_lock(hashtext(v_new_booth_id::text));
    select exists (
      select 1 from public.entity_balances eb
      where eb.entity_id = v_new_booth_id and eb.organization_id <> p_organization_id
    ) into v_booth_conflict;
    if v_booth_conflict then
      raise exception 'BOOTH_NO_LONGER_AVAILABLE:%', v_new_booth_id;
    end if;
  end loop;

  -- Record the refund(s) already issued in Stripe (app layer calls Stripe
  -- first, then passes the resulting cumulative amounts in here).
  for v_refund_update in select * from jsonb_array_elements(p_refund_updates) loop
    perform public.process_conference_order_refund(
      (v_refund_update->>'order_id')::uuid,
      (v_refund_update->>'cumulative_refund_cents')::integer
    );
  end loop;

  -- Find every entity_purchases row for the old booths, scoped to this org.
  select array_agg(ep.id) into v_old_purchase_ids
  from public.entity_purchases ep
  join public.entity_balances eb on eb.purchase_id = ep.id and eb.entity_id = ep.offer_entity_id
  where ep.offer_entity_id = any(p_old_booth_entity_ids)
    and eb.organization_id = p_organization_id;

  if v_old_purchase_ids is not null then
    -- Capture real registrants tied to these booths' bundle BEFORE the
    -- cascade wipes the seat rows that link to them (entity_balance_seats
    -- only SETS NULL on a person delete, not the reverse — so we delete
    -- people explicitly here for a genuine full teardown).
    select array_agg(distinct ebs.holder_person_id) into v_person_ids
    from public.entity_balance_seats ebs
    join public.entity_balances eb on eb.id = ebs.balance_id
    where eb.purchase_id = any(v_old_purchase_ids)
      and ebs.holder_person_id is not null;

    if v_person_ids is not null then
      delete from public.conference_people where id = any(v_person_ids);
    end if;

    -- Release the suite auto-pin if one of the old booths owns it.
    update public.conference_entities te
    set attributes = (te.attributes - 'organization_id' - 'suite_number')
    where te.kind = 'suite'
      and te.attributes->>'organization_id' = p_organization_id::text
      and exists (
        select 1 from public.conference_entity_refs ref
        where ref.to_entity_id = te.id
          and ref.role = 'includes'
          and ref.conference_id = p_conference_id
          and ref.from_entity_id = any(p_old_booth_entity_ids)
      );

    -- entity_balances (CASCADE from purchase) → entity_balance_seats
    -- (CASCADE from balance) both go automatically with this one delete.
    delete from public.entity_purchases where id = any(v_old_purchase_ids);
  end if;

  -- Grant the new booths: a new order, immediately paid + minted if no
  -- additional payment is owed (delta <= 0, already covered by the
  -- refund), otherwise left pending until the app layer's Stripe Checkout
  -- Session for the difference completes via the normal webhook path.
  insert into public.conference_orders (
    conference_id, organization_id, user_id, status,
    subtotal_cents, tax_cents, total_cents, currency,
    stripe_checkout_session_id
  ) values (
    p_conference_id, p_organization_id, p_actor_id,
    case when p_should_mint_immediately then 'paid' else 'pending' end,
    p_new_order_subtotal_cents, p_new_order_tax_cents, p_new_order_total_cents, 'CAD',
    p_stripe_checkout_session_id
  ) returning id into v_new_order_id;

  insert into public.conference_order_items (order_id, offer_entity_id, quantity, unit_price_cents, tax_cents, total_cents, metadata)
  select
    v_new_order_id, ce.id, 1, ce.price_cents,
    round(ce.price_cents * p_new_order_tax_cents::numeric / nullif(p_new_order_subtotal_cents, 0))::integer,
    ce.price_cents + round(ce.price_cents * p_new_order_tax_cents::numeric / nullif(p_new_order_subtotal_cents, 0))::integer,
    jsonb_build_object('booth_move', true)
  from public.conference_entities ce
  where ce.id = any(p_new_booth_entity_ids);

  if p_should_mint_immediately then
    perform public.process_conference_order_paid(v_new_order_id, p_stripe_checkout_session_id, null);
  end if;

  insert into public.conference_booth_moves (
    organization_id, conference_id, old_booth_entity_ids, new_booth_entity_ids,
    old_total_cents, new_total_cents, delta_cents, refund_ids, new_order_id, actor_id, reason
  ) values (
    p_organization_id, p_conference_id, p_old_booth_entity_ids, p_new_booth_entity_ids,
    p_old_total_cents, p_new_total_cents, p_new_total_cents - p_old_total_cents, coalesce(p_refund_ids, '{}'),
    v_new_order_id, p_actor_id, p_reason
  );

  return jsonb_build_object('new_order_id', v_new_order_id, 'minted', p_should_mint_immediately);
end;
$$;

revoke all on function public.execute_booth_move from public, anon, authenticated;
