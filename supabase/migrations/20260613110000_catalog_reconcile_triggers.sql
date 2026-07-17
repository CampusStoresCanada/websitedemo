-- Conference v2 hardening #1: kill catalog drift between the legacy wizard's
-- config_json (still authoritative until Phase 5) and the new catalog tables.
--
-- reconcile_conference_catalog() re-projects config_json → tables by UPSERT on
-- natural keys, PRESERVING row ids so grant FKs survive. It is additive-merge:
-- it adds and updates, but never deletes rows (a removed-in-wizard noun becomes
-- a harmless orphan rather than a broken grant FK — orphans are surfaced for
-- human cleanup in Phase 5). Triggers re-run it on every relevant wizard save
-- AND on instance date changes, and SWALLOW errors so a projection bug can
-- never abort the authoritative wizard transaction.
-- See docs/CONFERENCE_V2_BLUEPRINT.md.

create or replace function public.reconcile_conference_catalog(p_conference_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start    date;
  v_end      date;
  v_profiles jsonb := '{}'::jsonb;
  s          record;
  b          jsonb;
  dd         record;
  v_day_id   uuid;
begin
  select start_date, end_date into v_start, v_end
  from public.conference_instances where id = p_conference_id;
  if v_start is null or v_end is null or v_end < v_start then
    return; -- cannot project a calendar without a valid range
  end if;

  select coalesce(config_json->'conference_day_profiles', '{}'::jsonb)
  into v_profiles
  from public.conference_schedule_modules
  where conference_id = p_conference_id and module_key = 'registration_ops';
  v_profiles := coalesce(v_profiles, '{}'::jsonb);

  -- DAYS — upsert by (conference_id, date); refresh profile + sort
  insert into public.conference_days (conference_id, date, day_profile, sort)
  select
    p_conference_id,
    d.day::date,
    case
      when v_profiles->>(d.day::date)::text in ('full_day', 'half_day', 'travel', 'other')
      then v_profiles->>(d.day::date)::text
      else 'full_day'
    end,
    (row_number() over (order by d.day))::integer - 1
  from generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') as d(day)
  on conflict (conference_id, date) do update
    set day_profile = excluded.day_profile,
        sort = excluded.sort,
        updated_at = now();

  -- OFFSITE EVENTS — upsert by (conference_id, legacy_key)
  insert into public.conference_offsite_events (
    conference_id, legacy_key, title, date, start_time, end_time,
    google_place_id, venue_name, venue_address,
    travel_mode, travel_time_minutes, departure_time, return_time, meeting_point,
    includes_meal, meal_type, meal_custom_label,
    audience_registration_types, capacity, waitlist_enabled,
    is_sponsored, sponsor_name, sponsor_tier, sponsorship_activation_notes,
    waiver_required, accessibility_notes, emergency_contact, contingency_plan,
    linked_product_id
  )
  select
    p_conference_id,
    coalesce(nullif(e.value->>'id', ''), gen_random_uuid()::text),
    coalesce(nullif(e.value->>'title', ''), 'Untitled offsite event'),
    nullif(e.value->>'date', '')::date,
    nullif(e.value->>'start_time', '')::time,
    nullif(e.value->>'end_time', '')::time,
    nullif(e.value->>'google_place_id', ''),
    nullif(e.value->>'venue_name', ''),
    nullif(e.value->>'venue_address', ''),
    case when e.value->>'travel_mode' in ('walk', 'shuttle', 'bus', 'own_transport')
         then e.value->>'travel_mode' end,
    nullif(e.value->>'travel_time_minutes', '')::integer,
    nullif(e.value->>'departure_time', '')::time,
    nullif(e.value->>'return_time', '')::time,
    nullif(e.value->>'meeting_point', ''),
    coalesce((e.value->>'includes_meal')::boolean, false),
    case when e.value->>'meal_type' in ('breakfast', 'lunch', 'dinner', 'snack', 'custom')
         then e.value->>'meal_type' end,
    nullif(e.value->>'meal_custom_label', ''),
    coalesce((select array_agg(t) from jsonb_array_elements_text(e.value->'audience_registration_types') t), '{}'),
    nullif(e.value->>'capacity', '')::integer,
    coalesce((e.value->>'waitlist_enabled')::boolean, false),
    coalesce((e.value->>'is_sponsored')::boolean, false),
    nullif(e.value->>'sponsor_name', ''),
    nullif(e.value->>'sponsor_tier', ''),
    nullif(e.value->>'sponsorship_activation_notes', ''),
    coalesce((e.value->>'waiver_required')::boolean, false),
    nullif(e.value->>'accessibility_notes', ''),
    nullif(e.value->>'emergency_contact', ''),
    nullif(e.value->>'contingency_plan', ''),
    p.id
  from public.conference_schedule_modules m
  cross join lateral jsonb_array_elements(coalesce(m.config_json->'offsite_events', '[]'::jsonb)) as e(value)
  left join public.conference_products p
    on p.conference_id = p_conference_id
   and p.id::text = nullif(e.value->>'linked_product_id', '')
  where m.conference_id = p_conference_id and m.module_key = 'offsite'
  on conflict (conference_id, legacy_key) do update
    set title = excluded.title,
        date = excluded.date,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        google_place_id = excluded.google_place_id,
        venue_name = excluded.venue_name,
        venue_address = excluded.venue_address,
        travel_mode = excluded.travel_mode,
        travel_time_minutes = excluded.travel_time_minutes,
        departure_time = excluded.departure_time,
        return_time = excluded.return_time,
        meeting_point = excluded.meeting_point,
        includes_meal = excluded.includes_meal,
        meal_type = excluded.meal_type,
        meal_custom_label = excluded.meal_custom_label,
        audience_registration_types = excluded.audience_registration_types,
        capacity = excluded.capacity,
        waitlist_enabled = excluded.waitlist_enabled,
        is_sponsored = excluded.is_sponsored,
        sponsor_name = excluded.sponsor_name,
        sponsor_tier = excluded.sponsor_tier,
        sponsorship_activation_notes = excluded.sponsorship_activation_notes,
        waiver_required = excluded.waiver_required,
        accessibility_notes = excluded.accessibility_notes,
        emergency_contact = excluded.emergency_contact,
        contingency_plan = excluded.contingency_plan,
        linked_product_id = coalesce(excluded.linked_product_id, public.conference_offsite_events.linked_product_id),
        updated_at = now();

  -- MEAL SERVICES (breakfast/lunch/dinner singletons) — upsert by (day_id, service)
  insert into public.conference_meal_services
    (conference_id, day_id, service, start_time, duration_minutes)
  select
    p_conference_id, d.id, svc.name,
    nullif(ms.value->>(svc.name || '_time'), '')::time,
    nullif(ms.value->>(svc.name || '_duration_minutes'), '')::integer
  from public.conference_schedule_modules m
  cross join lateral jsonb_each(coalesce(m.config_json->'meal_day_settings', '{}'::jsonb)) as ms(date_key, value)
  join public.conference_days d on d.conference_id = p_conference_id and d.date = ms.date_key::date
  cross join lateral (values ('breakfast'), ('lunch'), ('dinner')) as svc(name)
  where m.conference_id = p_conference_id and m.module_key = 'meals'
    and coalesce((ms.value->>svc.name)::boolean, false)
  on conflict (day_id, service) where service <> 'snack' do update
    set start_time = excluded.start_time,
        duration_minutes = excluded.duration_minutes,
        updated_at = now();

  -- MEAL SERVICES (custom singleton) — upsert by (day_id, service)
  insert into public.conference_meal_services
    (conference_id, day_id, service, label, start_time, duration_minutes)
  select
    p_conference_id, d.id, 'custom',
    nullif(ms.value->>'custom_label', ''),
    nullif(ms.value->>'custom_time', '')::time,
    nullif(ms.value->>'custom_duration_minutes', '')::integer
  from public.conference_schedule_modules m
  cross join lateral jsonb_each(coalesce(m.config_json->'meal_day_settings', '{}'::jsonb)) as ms(date_key, value)
  join public.conference_days d on d.conference_id = p_conference_id and d.date = ms.date_key::date
  where m.conference_id = p_conference_id and m.module_key = 'meals'
    and coalesce((ms.value->>'custom_enabled')::boolean, false)
  on conflict (day_id, service) where service <> 'snack' do update
    set label = excluded.label,
        start_time = excluded.start_time,
        duration_minutes = excluded.duration_minutes,
        updated_at = now();

  -- MEAL SERVICES (snacks) — match by (day_id, service='snack', start_time);
  -- insert missing only (snacks have no partial unique index; never delete).
  for s in
    select d.id as day_id, b.value as snack
    from public.conference_schedule_modules m
    cross join lateral jsonb_each(coalesce(m.config_json->'meal_day_settings', '{}'::jsonb)) as ms(date_key, value)
    join public.conference_days d on d.conference_id = p_conference_id and d.date = ms.date_key::date
    cross join lateral jsonb_array_elements(coalesce(ms.value->'snack_breaks', '[]'::jsonb)) as b(value)
    where m.conference_id = p_conference_id and m.module_key = 'meals'
  loop
    if not exists (
      select 1 from public.conference_meal_services
      where day_id = s.day_id and service = 'snack'
        and start_time is not distinct from nullif(s.snack->>'start_time', '')::time
    ) then
      insert into public.conference_meal_services
        (conference_id, day_id, service, start_time, duration_minutes)
      values (
        p_conference_id, s.day_id, 'snack',
        nullif(s.snack->>'start_time', '')::time,
        nullif(s.snack->>'duration_minutes', '')::integer
      );
    end if;
  end loop;

  -- EDUCATION — ensure a tbd block per education day with no session yet
  for dd in
    select d.id as day_id,
           nullif(m.config_json->'education_day_settings'->(d.date::text)->>'start_time', '')::time as start_time,
           nullif(m.config_json->'education_day_settings'->(d.date::text)->>'end_time', '')::time as end_time
    from public.conference_schedule_modules m
    cross join lateral jsonb_array_elements_text(coalesce(m.config_json->'education_days', '[]'::jsonb)) as ed(value)
    join public.conference_days d on d.conference_id = p_conference_id and d.date = ed.value::date
    where m.conference_id = p_conference_id and m.module_key = 'education'
  loop
    if not exists (
      select 1 from public.conference_education_sessions
      where conference_id = p_conference_id and day_id = dd.day_id
    ) then
      insert into public.conference_education_sessions
        (conference_id, day_id, title, start_time, end_time, status)
      values (p_conference_id, dd.day_id, 'Education block', dd.start_time, dd.end_time, 'tbd');
    end if;
  end loop;
end;
$$;

comment on function public.reconcile_conference_catalog(uuid) is
  'Additive-merge re-projection of config_json into catalog tables (id-preserving). Safe to call anytime; never deletes rows that grants may reference.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers — keep the projection fresh; swallow errors so a projection bug can
-- never abort the authoritative wizard save.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.trg_reconcile_catalog_from_module()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.reconcile_conference_catalog(new.conference_id);
  exception when others then
    raise warning 'reconcile_conference_catalog failed for conference %: %', new.conference_id, sqlerrm;
  end;
  return null;
end;
$$;

create or replace function public.trg_reconcile_catalog_from_instance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.reconcile_conference_catalog(new.id);
  exception when others then
    raise warning 'reconcile_conference_catalog failed for conference %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists reconcile_catalog_on_module_change on public.conference_schedule_modules;
create trigger reconcile_catalog_on_module_change
  after insert or update of config_json on public.conference_schedule_modules
  for each row
  when (new.module_key in ('registration_ops', 'offsite', 'meals', 'education'))
  execute function public.trg_reconcile_catalog_from_module();

drop trigger if exists reconcile_catalog_on_instance_dates on public.conference_instances;
create trigger reconcile_catalog_on_instance_dates
  after update of start_date, end_date on public.conference_instances
  for each row
  when (new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date)
  execute function public.trg_reconcile_catalog_from_instance();

-- Prove idempotency immediately: re-project every conference once.
do $$
declare c record;
begin
  for c in select id from public.conference_instances loop
    perform public.reconcile_conference_catalog(c.id);
  end loop;
end $$;
