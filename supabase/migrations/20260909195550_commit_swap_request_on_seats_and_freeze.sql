-- Port commit_swap_request to the seat shape, and close swaps at the freeze.
--
-- ⛔ THE OLD FUNCTION COULD NOT RUN. It read schedules.delegate_registration_ids
-- and schedules.exhibitor_registration_id — both retired when the meeting system
-- moved onto seats — and swap_requests.delegate_registration_id, which is not on
-- the current table either. plpgsql resolves record fields at execution, so it
-- sat there compiling fine and would have thrown on the first real swap.
--
-- Nobody noticed because zero swap requests have ever been made. The app layer
-- is fully ported (11 seat references, 0 registration ones), so TypeScript was
-- clean, the UI existed, and the failure lived one layer below the type system.
--
-- ⛔ THE LOCKING IS UNCHANGED AND DELIBERATE. Every row the decision depends on
-- is taken FOR UPDATE, and every legality check is re-run INSIDE the lock rather
-- than trusted from the alternatives list the caller was shown. That is what
-- makes concurrent swaps safe: the options a delegate sees may be stale, but the
-- commit is authoritative. Two people taking the last seat in a room — the
-- second blocks, re-reads the now-full room, and fails REPLACEMENT_GROUP_MAX.
--
-- ⛔ FREEZE GATE. Swaps close when the schedule freezes, the same date and the
-- same argument as late-add: after it, people have been told where to be, and a
-- swap moves somebody. Checked here and NOT only in the action, because the
-- action is one caller and this is the only place that cannot be bypassed.
--
-- ⚠️ Filename version matches the applied ledger entry (20260909195550). A
-- hand-picked timestamp drifts from what the database recorded and leaves a
-- future `supabase db push` believing the migration is unapplied.
create or replace function public.commit_swap_request(
  p_swap_request_id uuid,
  p_replacement_schedule_id uuid,
  p_group_min integer,
  p_group_max integer,
  p_actor_id uuid default null::uuid
)
returns swap_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  request_row public.swap_requests%rowtype;
  run_row public.scheduler_runs%rowtype;
  drop_schedule_row public.schedules%rowtype;
  replacement_schedule_row public.schedules%rowtype;
  v_freeze_at timestamptz;
  delegate_org_id uuid;
  delegate_person_id uuid;
  delegate_contact_id uuid;
  replacement_exhibitor_org_id uuid;
  replacement_holder_contact_id uuid;
  sibling_seat_ids uuid[];
  remaining_seat_ids uuid[];
  current_delegate_count integer;
  blackout_count integer;
  existing_duplicate_count integer;
  slot_conflict_count integer;
  sibling_conflict_count integer;
begin
  select * into request_row
  from public.swap_requests where id = p_swap_request_id for update;
  if not found then raise exception 'SWAP_REQUEST_NOT_FOUND'; end if;

  if request_row.status <> 'options_generated' then
    raise exception 'SWAP_REQUEST_NOT_READY';
  end if;

  -- ⛔ Frozen means frozen. Before any other work, so a delegate cannot burn a
  -- swap against a schedule that is closed.
  select schedule_freeze_at into v_freeze_at
  from public.conference_instances where id = request_row.conference_id;

  if v_freeze_at is not null and now() >= v_freeze_at then
    raise exception 'SCHEDULE_FROZEN';
  end if;

  select * into run_row
  from public.scheduler_runs where id = request_row.scheduler_run_id for update;
  if not found then raise exception 'SCHEDULER_RUN_NOT_FOUND'; end if;

  if run_row.run_mode <> 'active' or run_row.status <> 'completed' then
    raise exception 'SWAP_RUN_NOT_ACTIVE';
  end if;

  select * into drop_schedule_row
  from public.schedules
  where id = request_row.drop_schedule_id
    and scheduler_run_id = request_row.scheduler_run_id
  for update;
  if not found then raise exception 'DROP_SCHEDULE_NOT_FOUND'; end if;

  if not (request_row.delegate_seat_id = any(drop_schedule_row.delegate_seat_ids)) then
    raise exception 'DELEGATE_NOT_IN_DROP_SCHEDULE';
  end if;

  select * into replacement_schedule_row
  from public.schedules
  where id = p_replacement_schedule_id
    and scheduler_run_id = request_row.scheduler_run_id
  for update;
  if not found then raise exception 'REPLACEMENT_SCHEDULE_NOT_FOUND'; end if;

  if replacement_schedule_row.id = drop_schedule_row.id then
    raise exception 'REPLACEMENT_EQUALS_DROPPED';
  end if;
  if replacement_schedule_row.conference_id <> request_row.conference_id then
    raise exception 'REPLACEMENT_CONFERENCE_MISMATCH';
  end if;
  if replacement_schedule_row.status = 'canceled' then
    raise exception 'REPLACEMENT_SCHEDULE_CANCELED';
  end if;
  if request_row.delegate_seat_id = any(replacement_schedule_row.delegate_seat_ids) then
    raise exception 'DELEGATE_ALREADY_IN_REPLACEMENT';
  end if;

  current_delegate_count := coalesce(array_length(replacement_schedule_row.delegate_seat_ids, 1), 0);
  if current_delegate_count + 1 > p_group_max then
    raise exception 'REPLACEMENT_GROUP_MAX_EXCEEDED';
  end if;

  remaining_seat_ids := array_remove(drop_schedule_row.delegate_seat_ids, request_row.delegate_seat_id);
  if coalesce(array_length(remaining_seat_ids, 1), 0) > 0
     and coalesce(array_length(remaining_seat_ids, 1), 0) < p_group_min then
    raise exception 'DROP_GROUP_MIN_VIOLATION';
  end if;

  -- Seat -> org and holder. contact_id is the FK'd column and the join key the
  -- match engine and refusals both use; canonical_person_id has no FK and on
  -- CSC 2027 one row already points at a contact that does not exist.
  select s.organization_id, s.holder_person_id, cp.contact_id
    into delegate_org_id, delegate_person_id, delegate_contact_id
  from public.entity_balance_seats s
  left join public.conference_people cp on cp.id = s.holder_person_id
  where s.id = request_row.delegate_seat_id;

  select s.organization_id, cp.contact_id
    into replacement_exhibitor_org_id, replacement_holder_contact_id
  from public.entity_balance_seats s
  left join public.conference_people cp on cp.id = s.holder_person_id
  where s.id = replacement_schedule_row.exhibitor_seat_id;

  -- ⛔ TWO GRAINS, ONE TABLE. declaring_contact_id NULL is the ORG refusing, and
  -- that is symmetrical — either side may fire the other. Set means ONE PERSON
  -- is refusing, and it binds only their own seat: their colleague may still
  -- want the meeting and their company has refused nothing.
  select count(*) into blackout_count
  from public.org_meeting_refusals r
  where r.retired_at is null
    and (
      (r.declaring_contact_id is null and (
         (r.declaring_org_id = delegate_org_id and r.refused_org_id = replacement_exhibitor_org_id)
      or (r.declaring_org_id = replacement_exhibitor_org_id and r.refused_org_id = delegate_org_id)))
      or (delegate_contact_id is not null
          and r.declaring_contact_id = delegate_contact_id
          and r.refused_org_id = replacement_exhibitor_org_id)
      or (replacement_holder_contact_id is not null
          and r.declaring_contact_id = replacement_holder_contact_id
          and r.refused_org_id = delegate_org_id)
    );

  if blackout_count > 0 then raise exception 'BLACKOUT_VIOLATION'; end if;

  -- No delegate meets the same exhibitor ORG twice, whatever seat or suite.
  select count(*) into existing_duplicate_count
  from public.schedules s
  join public.entity_balance_seats es on es.id = s.exhibitor_seat_id
  where s.scheduler_run_id = request_row.scheduler_run_id
    and s.status <> 'canceled'
    and s.id <> drop_schedule_row.id
    and request_row.delegate_seat_id = any(s.delegate_seat_ids)
    and es.organization_id = replacement_exhibitor_org_id;

  if existing_duplicate_count > 0 then
    raise exception 'DUPLICATE_EXHIBITOR_ORG_VIOLATION';
  end if;

  select count(*) into slot_conflict_count
  from public.schedules s
  where s.scheduler_run_id = request_row.scheduler_run_id
    and s.status <> 'canceled'
    and s.id <> drop_schedule_row.id
    and s.id <> replacement_schedule_row.id
    and s.meeting_slot_id = replacement_schedule_row.meeting_slot_id
    and request_row.delegate_seat_id = any(s.delegate_seat_ids);

  if slot_conflict_count > 0 then raise exception 'DELEGATE_SLOT_CONFLICT'; end if;

  -- ⚠️ The linked-registration rule, in the shape that replaced it: one PERSON
  -- may hold several seats, and they are still one body. A seat cannot be moved
  -- into a minute where another of that person's seats already sits.
  if delegate_person_id is not null then
    select coalesce(array_agg(s2.id), '{}') into sibling_seat_ids
    from public.entity_balance_seats s2
    where s2.holder_person_id = delegate_person_id
      and s2.id <> request_row.delegate_seat_id
      and s2.conference_id = request_row.conference_id;

    if coalesce(array_length(sibling_seat_ids, 1), 0) > 0 then
      select count(*) into sibling_conflict_count
      from public.schedules s
      where s.scheduler_run_id = request_row.scheduler_run_id
        and s.status <> 'canceled'
        and s.id <> drop_schedule_row.id
        and s.id <> replacement_schedule_row.id
        and s.meeting_slot_id = replacement_schedule_row.meeting_slot_id
        and s.delegate_seat_ids && sibling_seat_ids;

      if sibling_conflict_count > 0 then
        raise exception 'LINKED_SEAT_SLOT_CONFLICT';
      end if;
    end if;
  end if;

  update public.schedules
  set delegate_seat_ids = remaining_seat_ids,
      status = case
        when coalesce(array_length(remaining_seat_ids, 1), 0) = 0 then 'canceled'
        else 'swapped'
      end
  where id = drop_schedule_row.id;

  update public.schedules
  set delegate_seat_ids = array_append(delegate_seat_ids, request_row.delegate_seat_id),
      status = 'swapped'
  where id = replacement_schedule_row.id;

  update public.swap_requests
  set replacement_schedule_id = replacement_schedule_row.id,
      replacement_exhibitor_seat_id = replacement_schedule_row.exhibitor_seat_id,
      status = 'approved_committed',
      resolved_at = now(),
      constraint_check_result = jsonb_build_object(
        'ok', true,
        'actor_id', p_actor_id,
        'checked_at', now(),
        'group_min', p_group_min,
        'group_max', p_group_max,
        'shape', 'seats'
      )
  where id = request_row.id
  returning * into request_row;

  return request_row;
end;
$function$;
