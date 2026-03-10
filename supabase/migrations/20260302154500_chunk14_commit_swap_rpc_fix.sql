-- Chunk 14: Fix ambiguous variable reference in commit_swap_request RPC

create or replace function public.commit_swap_request(
  p_swap_request_id uuid,
  p_replacement_schedule_id uuid,
  p_group_min integer,
  p_group_max integer,
  p_actor_id uuid default null
)
returns public.swap_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.swap_requests%rowtype;
  run_row public.scheduler_runs%rowtype;
  drop_schedule_row public.schedules%rowtype;
  replacement_schedule_row public.schedules%rowtype;
  replacement_exhibitor_org_id uuid;
  delegate_org_id uuid;
  v_linked_registration_id uuid;
  delegate_blackout_list uuid[];
  exhibitor_blackout_list uuid[];
  remaining_delegate_ids uuid[];
  current_delegate_count integer;
  existing_duplicate_count integer;
  slot_conflict_count integer;
  linked_slot_conflict_count integer;
begin
  select *
  into request_row
  from public.swap_requests
  where id = p_swap_request_id
  for update;

  if not found then
    raise exception 'SWAP_REQUEST_NOT_FOUND';
  end if;

  if request_row.status <> 'options_generated' then
    raise exception 'SWAP_REQUEST_NOT_READY';
  end if;

  select *
  into run_row
  from public.scheduler_runs
  where id = request_row.scheduler_run_id
  for update;

  if not found then
    raise exception 'SCHEDULER_RUN_NOT_FOUND';
  end if;

  if run_row.run_mode <> 'active' or run_row.status <> 'completed' then
    raise exception 'SWAP_RUN_NOT_ACTIVE';
  end if;

  select *
  into drop_schedule_row
  from public.schedules
  where id = request_row.drop_schedule_id
    and scheduler_run_id = request_row.scheduler_run_id
  for update;

  if not found then
    raise exception 'DROP_SCHEDULE_NOT_FOUND';
  end if;

  if not (request_row.delegate_registration_id = any(drop_schedule_row.delegate_registration_ids)) then
    raise exception 'DELEGATE_NOT_IN_DROP_SCHEDULE';
  end if;

  select *
  into replacement_schedule_row
  from public.schedules
  where id = p_replacement_schedule_id
    and scheduler_run_id = request_row.scheduler_run_id
  for update;

  if not found then
    raise exception 'REPLACEMENT_SCHEDULE_NOT_FOUND';
  end if;

  if replacement_schedule_row.id = drop_schedule_row.id then
    raise exception 'REPLACEMENT_EQUALS_DROPPED';
  end if;

  if replacement_schedule_row.conference_id <> request_row.conference_id then
    raise exception 'REPLACEMENT_CONFERENCE_MISMATCH';
  end if;

  if replacement_schedule_row.status = 'canceled' then
    raise exception 'REPLACEMENT_SCHEDULE_CANCELED';
  end if;

  if request_row.delegate_registration_id = any(replacement_schedule_row.delegate_registration_ids) then
    raise exception 'DELEGATE_ALREADY_IN_REPLACEMENT';
  end if;

  current_delegate_count := coalesce(array_length(replacement_schedule_row.delegate_registration_ids, 1), 0);
  if current_delegate_count + 1 > p_group_max then
    raise exception 'REPLACEMENT_GROUP_MAX_EXCEEDED';
  end if;

  remaining_delegate_ids := array_remove(drop_schedule_row.delegate_registration_ids, request_row.delegate_registration_id);
  if coalesce(array_length(remaining_delegate_ids, 1), 0) > 0
    and coalesce(array_length(remaining_delegate_ids, 1), 0) < p_group_min then
    raise exception 'DROP_GROUP_MIN_VIOLATION';
  end if;

  select organization_id, linked_registration_id, coalesce(blackout_list, '{}')
  into delegate_org_id, v_linked_registration_id, delegate_blackout_list
  from public.conference_registrations
  where id = request_row.delegate_registration_id;

  select organization_id, coalesce(blackout_list, '{}')
  into replacement_exhibitor_org_id, exhibitor_blackout_list
  from public.conference_registrations
  where id = replacement_schedule_row.exhibitor_registration_id;

  if replacement_exhibitor_org_id = any(delegate_blackout_list)
    or delegate_org_id = any(exhibitor_blackout_list) then
    raise exception 'BLACKOUT_VIOLATION';
  end if;

  select count(*)
  into existing_duplicate_count
  from public.schedules s
  join public.conference_registrations r
    on r.id = s.exhibitor_registration_id
  where s.scheduler_run_id = request_row.scheduler_run_id
    and s.status <> 'canceled'
    and s.id <> drop_schedule_row.id
    and request_row.delegate_registration_id = any(s.delegate_registration_ids)
    and r.organization_id = replacement_exhibitor_org_id;

  if existing_duplicate_count > 0 then
    raise exception 'DUPLICATE_EXHIBITOR_ORG_VIOLATION';
  end if;

  select count(*)
  into slot_conflict_count
  from public.schedules s
  where s.scheduler_run_id = request_row.scheduler_run_id
    and s.status <> 'canceled'
    and s.id <> drop_schedule_row.id
    and s.id <> replacement_schedule_row.id
    and s.meeting_slot_id = replacement_schedule_row.meeting_slot_id
    and request_row.delegate_registration_id = any(s.delegate_registration_ids);

  if slot_conflict_count > 0 then
    raise exception 'DELEGATE_SLOT_CONFLICT';
  end if;

  if v_linked_registration_id is not null then
    select count(*)
    into linked_slot_conflict_count
    from public.schedules s
    where s.scheduler_run_id = request_row.scheduler_run_id
      and s.status <> 'canceled'
      and s.id <> drop_schedule_row.id
      and s.id <> replacement_schedule_row.id
      and s.meeting_slot_id = replacement_schedule_row.meeting_slot_id
      and v_linked_registration_id = any(s.delegate_registration_ids);

    if linked_slot_conflict_count > 0 then
      raise exception 'LINKED_REGISTRATION_SLOT_CONFLICT';
    end if;
  end if;

  update public.schedules
  set delegate_registration_ids = remaining_delegate_ids,
      status = case
        when coalesce(array_length(remaining_delegate_ids, 1), 0) = 0 then 'canceled'
        else 'swapped'
      end
  where id = drop_schedule_row.id;

  update public.schedules
  set delegate_registration_ids = array_append(delegate_registration_ids, request_row.delegate_registration_id),
      status = 'swapped'
  where id = replacement_schedule_row.id;

  update public.swap_requests
  set replacement_schedule_id = replacement_schedule_row.id,
      replacement_exhibitor_id = replacement_schedule_row.exhibitor_registration_id,
      status = 'approved_committed',
      resolved_at = now(),
      constraint_check_result = jsonb_build_object(
        'ok', true,
        'actor_id', p_actor_id,
        'checked_at', now(),
        'group_min', p_group_min,
        'group_max', p_group_max
      )
  where id = request_row.id
  returning * into request_row;

  return request_row;
end;
$$;
