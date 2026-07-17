-- Conference v2 hardening: make grant authoring and seat allocation atomic,
-- and remove the dead per='attendee' path.
-- See docs/CONFERENCE_V2_BLUEPRINT.md (improvements #2, #3, #6).

-- ─────────────────────────────────────────────────────────────────────────────
-- #6: drop the unimplemented per='attendee' option (nothing mints or derives it)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.product_grants drop constraint if exists product_grants_per_check;
update public.product_grants set per = 'order' where per <> 'order';
alter table public.product_grants
  add constraint product_grants_per_check check (per in ('order'));

-- ─────────────────────────────────────────────────────────────────────────────
-- #2: set_product_grants — atomic replace-set for a product's grants.
-- Runs in the caller's transaction: any failure (bad FK, bad enum) rolls back
-- the delete too, so a product is never left half-granted. p_grants is a JSON
-- array; TS validates structure/scope membership before calling.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_product_grants(
  p_product_id uuid,
  p_grants jsonb
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  g            jsonb;
  v_grant_id   uuid;
  v_grant_ids  uuid[] := array[]::uuid[];
  d            jsonb;
  m            jsonb;
  s            jsonb;
begin
  if not exists (select 1 from public.conference_products where id = p_product_id) then
    raise exception 'PRODUCT_NOT_FOUND:%', p_product_id;
  end if;

  delete from public.product_grants where product_id = p_product_id;

  for g in select * from jsonb_array_elements(coalesce(p_grants, '[]'::jsonb))
  loop
    insert into public.product_grants (
      product_id, grant_type, quantity, per, scope_mode,
      scope_registration_type, scope_booth_id, scope_offsite_event_id, notes
    )
    values (
      p_product_id,
      g->>'grant_type',
      coalesce((g->>'quantity')::integer, 1),
      coalesce(g->>'per', 'order'),
      coalesce(g->>'scope_mode', 'all'),
      nullif(g->>'scope_registration_type', ''),
      nullif(g->>'scope_booth_id', '')::uuid,
      nullif(g->>'scope_offsite_event_id', '')::uuid,
      nullif(g->>'notes', '')
    )
    returning id into v_grant_id;

    v_grant_ids := v_grant_ids || v_grant_id;

    for d in select * from jsonb_array_elements(coalesce(g->'day_scopes', '[]'::jsonb))
    loop
      insert into public.product_grant_days (grant_id, day_id, access_kind)
      values (v_grant_id, (d->>'day_id')::uuid, coalesce(d->>'access_kind', 'floor'))
      on conflict (grant_id, day_id, access_kind) do nothing;
    end loop;

    for m in select * from jsonb_array_elements(coalesce(g->'meal_service_ids', '[]'::jsonb))
    loop
      insert into public.product_grant_meals (grant_id, meal_service_id)
      values (v_grant_id, (m #>> '{}')::uuid)
      on conflict do nothing;
    end loop;

    for s in select * from jsonb_array_elements(coalesce(g->'session_ids', '[]'::jsonb))
    loop
      insert into public.product_grant_sessions (grant_id, session_id)
      values (v_grant_id, (s #>> '{}')::uuid)
      on conflict do nothing;
    end loop;
  end loop;

  return v_grant_ids;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- #2/#3: assign_grant_seat — atomic seat upsert + qty_assigned maintenance.
-- TS resolves the user/person/invite first, then calls this with final values.
-- Reassignment is detected here (in-tx) so the status and counter never tear.
-- ─────────────────────────────────────────────────────────────────────────────

-- Nullable params (p_user_id/p_canonical_person_id/p_email) are last with
-- DEFAULT null so the generated TS types mark them optional (Postgres params
-- are always nullable, but the type generator can't know that).
create or replace function public.assign_grant_seat(
  p_conference_id uuid,
  p_organization_id uuid,
  p_balance_id uuid,
  p_seat_index integer,
  p_person_kind text,
  p_entitlement_type text,
  p_intended_status text,
  p_actor_id uuid,
  p_user_id uuid default null,
  p_canonical_person_id uuid default null,
  p_email text default null
)
returns table (person_id uuid, assignment_status text, previous_user_id uuid, previous_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance       public.grant_balances%rowtype;
  v_existing      public.conference_people%rowtype;
  v_next_status   text;
  v_person_id     uuid;
  v_prev_user     uuid;
  v_prev_status   text;
  v_active_count  integer;
begin
  select * into v_balance from public.grant_balances where id = p_balance_id for update;
  if not found then
    raise exception 'BALANCE_NOT_FOUND:%', p_balance_id;
  end if;
  if v_balance.conference_id <> p_conference_id or v_balance.organization_id is distinct from p_organization_id then
    raise exception 'BALANCE_ORG_MISMATCH:%', p_balance_id;
  end if;
  if v_balance.status <> 'active' then
    raise exception 'BALANCE_NOT_ACTIVE:%', v_balance.status;
  end if;
  if p_seat_index < 0 or p_seat_index >= v_balance.qty_total then
    raise exception 'SEAT_INDEX_OUT_OF_RANGE:%', p_seat_index;
  end if;

  select * into v_existing
  from public.conference_people cp
  where cp.grant_balance_id = p_balance_id and cp.seat_index = p_seat_index;

  v_prev_user := v_existing.user_id;
  v_prev_status := v_existing.assignment_status;

  v_next_status := case
    when p_intended_status = 'assigned'
         and v_prev_user is not null
         and p_user_id is not null
         and v_prev_user <> p_user_id
    then 'reassigned'
    else p_intended_status
  end;

  if v_existing.id is not null then
    update public.conference_people set
      organization_id = p_organization_id,
      user_id = p_user_id,
      canonical_person_id = p_canonical_person_id,
      person_kind = case when p_user_id is not null then p_person_kind else 'unassigned' end,
      conference_entitlement_id = v_balance.order_item_id,
      entitlement_type = p_entitlement_type,
      entitlement_status = 'active',
      assignment_status = v_next_status,
      assigned_email_snapshot = p_email,
      assigned_at = now(),
      assigned_by = p_actor_id,
      reassigned_from_user_id = v_prev_user,
      schedule_scope = case when p_user_id is not null then 'person' else 'organization' end,
      updated_at = now()
    where id = v_existing.id
    returning id into v_person_id;
  else
    insert into public.conference_people (
      conference_id, organization_id, user_id, canonical_person_id,
      registration_id, conference_staff_id, source_type, source_id,
      person_kind, conference_entitlement_id, entitlement_type, entitlement_status,
      grant_balance_id, seat_index, assignment_status, assigned_email_snapshot,
      assigned_at, assigned_by, reassigned_from_user_id, schedule_scope, updated_at
    )
    values (
      p_conference_id, p_organization_id, p_user_id, p_canonical_person_id,
      -- source_id is a synthetic per-seat uuid: the legacy unique
      -- (conference_id, source_type, source_id) constraint predates multi-seat
      -- balances, so each seat needs a distinct token. v2 seat identity is
      -- (grant_balance_id, seat_index).
      null, null, 'entitlement', gen_random_uuid(),
      case when p_user_id is not null then p_person_kind else 'unassigned' end,
      v_balance.order_item_id, p_entitlement_type, 'active',
      p_balance_id, p_seat_index, v_next_status, p_email,
      now(), p_actor_id, v_prev_user,
      case when p_user_id is not null then 'person' else 'organization' end, now()
    )
    returning id into v_person_id;
  end if;

  select count(*) into v_active_count
  from public.conference_people cp
  where cp.grant_balance_id = p_balance_id
    and cp.assignment_status in ('assigned', 'pending_user_activation', 'reassigned');

  update public.grant_balances
  set qty_assigned = v_active_count, updated_at = now()
  where id = p_balance_id;

  person_id := v_person_id;
  assignment_status := v_next_status;
  previous_user_id := v_prev_user;
  previous_status := v_prev_status;
  return next;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- #2/#3: unassign_grant_seat — atomic clear + qty_assigned maintenance.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.unassign_grant_seat(
  p_balance_id uuid,
  p_seat_index integer,
  p_actor_id uuid
)
returns table (person_id uuid, previous_user_id uuid, previous_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing      public.conference_people%rowtype;
  v_active_count  integer;
begin
  select * into v_existing
  from public.conference_people
  where grant_balance_id = p_balance_id and seat_index = p_seat_index;
  if v_existing.id is null then
    raise exception 'SEAT_NOT_FOUND:%:%', p_balance_id, p_seat_index;
  end if;

  update public.conference_people set
    user_id = null,
    canonical_person_id = null,
    person_kind = 'unassigned',
    assignment_status = 'unassigned',
    assigned_email_snapshot = null,
    assigned_at = now(),
    assigned_by = p_actor_id,
    reassigned_from_user_id = v_existing.user_id,
    schedule_scope = 'organization',
    updated_at = now()
  where id = v_existing.id;

  select count(*) into v_active_count
  from public.conference_people
  where grant_balance_id = p_balance_id
    and assignment_status in ('assigned', 'pending_user_activation', 'reassigned');

  update public.grant_balances
  set qty_assigned = v_active_count, updated_at = now()
  where id = p_balance_id;

  person_id := v_existing.id;
  previous_user_id := v_existing.user_id;
  previous_status := v_existing.assignment_status;
  return next;
end;
$$;
