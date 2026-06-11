-- 1. New nullable FK column
alter table public.conference_booths
  add column if not exists booth_product_id uuid references public.conference_products(id) on delete set null;

create index if not exists idx_conference_booths_product
  on public.conference_booths(booth_product_id);

-- 2. Backfill from existing zone -> slug, per conference
update public.conference_booths b
set booth_product_id = p.id
from public.conference_products p
where p.conference_id = b.conference_id
  and b.booth_product_id is null
  and (
    (b.zone = 'connected' and p.slug = 'exhibitor_booth_connected')
    or (b.zone = 'standard' and p.slug = 'exhibitor_booth_standard')
  );

-- 3. Backfill day_pattern metadata for the 2027/00 seed products,
--    using the conference's actual start/end dates (no hardcoded dates).
do $$
declare
  v_conf_id uuid;
  v_start date;
  v_end date;
  v_dates date[];
begin
  select id, start_date, end_date into v_conf_id, v_start, v_end
  from public.conference_instances
  where year = 2027 and edition_code = '00';

  if v_conf_id is null or v_start is null or v_end is null then
    raise notice 'Conference 2027/00 dates not set — skipping day_pattern backfill.';
    return;
  end if;

  select array_agg(d::date order by d) into v_dates
  from generate_series(v_start, v_end, interval '1 day') d;

  -- Connected: meeting space on day 1, floor access on remaining days
  update public.conference_products
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'day_pattern',
    (
      select jsonb_object_agg(d, case when i = 1 then 'meeting' else 'floor' end)
      from unnest(v_dates) with ordinality as t(d, i)
    )
  )
  where conference_id = v_conf_id and slug = 'exhibitor_booth_connected';

  -- Standard: floor access every day
  update public.conference_products
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'day_pattern',
    (select jsonb_object_agg(d, 'floor') from unnest(v_dates) as d)
  )
  where conference_id = v_conf_id and slug = 'exhibitor_booth_standard';
end $$;

-- 4. Drop the old enum column + its CHECK constraint
alter table public.conference_booths drop column if exists zone;
