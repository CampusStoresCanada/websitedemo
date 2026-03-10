-- Security hardening: replace permissive RLS policies and lock sensitive RPC execute grants.

-- ============================================================
-- Chunk 12 commerce tables: remove broad authenticated read
-- ============================================================

drop policy if exists cart_items_select_authenticated on public.cart_items;
drop policy if exists conference_orders_select_authenticated on public.conference_orders;
drop policy if exists conference_order_items_select_authenticated on public.conference_order_items;
drop policy if exists wishlist_intents_select_authenticated on public.wishlist_intents;
drop policy if exists billing_runs_select_authenticated on public.billing_runs;
drop policy if exists conference_webhook_events_select_authenticated on public.conference_webhook_events;

drop policy if exists cart_items_select_scoped on public.cart_items;
create policy cart_items_select_scoped
  on public.cart_items
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.user_organizations uo
      where uo.user_id = auth.uid()
        and uo.organization_id = cart_items.organization_id
        and uo.role = 'org_admin'
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

drop policy if exists conference_orders_select_scoped on public.conference_orders;
create policy conference_orders_select_scoped
  on public.conference_orders
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.user_organizations uo
      where uo.user_id = auth.uid()
        and uo.organization_id = conference_orders.organization_id
        and uo.role = 'org_admin'
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

drop policy if exists conference_order_items_select_scoped on public.conference_order_items;
create policy conference_order_items_select_scoped
  on public.conference_order_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.conference_orders o
      where o.id = conference_order_items.order_id
        and (
          o.user_id = auth.uid()
          or exists (
            select 1 from public.user_organizations uo
            where uo.user_id = auth.uid()
              and uo.organization_id = o.organization_id
              and uo.role = 'org_admin'
          )
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.global_role in ('admin', 'super_admin')
          )
        )
    )
  );

drop policy if exists wishlist_intents_select_scoped on public.wishlist_intents;
create policy wishlist_intents_select_scoped
  on public.wishlist_intents
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.user_organizations uo
      where uo.user_id = auth.uid()
        and uo.organization_id = wishlist_intents.organization_id
        and uo.role = 'org_admin'
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

drop policy if exists billing_runs_select_admin on public.billing_runs;
create policy billing_runs_select_admin
  on public.billing_runs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

drop policy if exists conference_webhook_events_select_admin on public.conference_webhook_events;
create policy conference_webhook_events_select_admin
  on public.conference_webhook_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

-- ============================================================
-- Chunk 12 wishlist billing attempts: remove broad authenticated read
-- ============================================================

drop policy if exists wishlist_billing_attempts_select_authenticated on public.wishlist_billing_attempts;

drop policy if exists wishlist_billing_attempts_select_scoped on public.wishlist_billing_attempts;
create policy wishlist_billing_attempts_select_scoped
  on public.wishlist_billing_attempts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.wishlist_intents wi
      where wi.id = wishlist_billing_attempts.wishlist_intent_id
        and wi.user_id = auth.uid()
    )
    or exists (
      select 1 from public.user_organizations uo
      where uo.user_id = auth.uid()
        and uo.organization_id = wishlist_billing_attempts.organization_id
        and uo.role = 'org_admin'
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

-- ============================================================
-- Chunk 13 scheduler infrastructure tables: remove broad authenticated read
-- ============================================================

drop policy if exists conference_suites_read_authenticated on public.conference_suites;
drop policy if exists meeting_slots_read_authenticated on public.meeting_slots;

drop policy if exists conference_suites_read_authorized on public.conference_suites;
create policy conference_suites_read_authorized
  on public.conference_suites
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
    or exists (
      select 1 from public.conference_registrations cr
      where cr.conference_id = conference_suites.conference_id
        and cr.user_id = auth.uid()
    )
  );

drop policy if exists meeting_slots_read_authorized on public.meeting_slots;
create policy meeting_slots_read_authorized
  on public.meeting_slots
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
    or exists (
      select 1 from public.conference_registrations cr
      where cr.conference_id = meeting_slots.conference_id
        and cr.user_id = auth.uid()
    )
  );

-- ============================================================
-- Sensitive RPC execute grants: lock to service role
-- ============================================================

revoke execute on function public.create_conference_order_from_cart(uuid, uuid, uuid, text, numeric, text) from public, anon, authenticated;
revoke execute on function public.process_conference_order_paid(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.process_conference_order_refund(uuid, integer) from public, anon, authenticated;
revoke execute on function public.promote_scheduler_run(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.commit_swap_request(uuid, uuid, integer, integer, uuid) from public, anon, authenticated;
revoke execute on function public.run_travel_retention_purge(uuid, uuid, timestamptz, text[]) from public, anon, authenticated;
revoke execute on function public.ensure_conference_badge_token_for_person(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.create_conference_order_from_cart(uuid, uuid, uuid, text, numeric, text) to service_role;
grant execute on function public.process_conference_order_paid(uuid, text, text) to service_role;
grant execute on function public.process_conference_order_refund(uuid, integer) to service_role;
grant execute on function public.promote_scheduler_run(uuid, uuid, uuid) to service_role;
grant execute on function public.commit_swap_request(uuid, uuid, integer, integer, uuid) to service_role;
grant execute on function public.run_travel_retention_purge(uuid, uuid, timestamptz, text[]) to service_role;
grant execute on function public.ensure_conference_badge_token_for_person(uuid, uuid, uuid) to service_role;
