-- Backfill metadata.day_pattern for existing exhibitor booth products,
-- derived from each product's own conference start/end dates.
-- Connected: meeting space on day 1, floor access on remaining days.
-- Standard: floor access every day.
do $$
declare
  rec record;
  v_dates date[];
begin
  for rec in
    select p.id as product_id, p.slug, ci.start_date, ci.end_date
    from public.conference_products p
    join public.conference_instances ci on ci.id = p.conference_id
    where p.slug in ('exhibitor_booth_connected', 'exhibitor_booth_standard')
      and ci.start_date is not null
      and ci.end_date is not null
  loop
    select array_agg(d::date order by d) into v_dates
    from generate_series(rec.start_date, rec.end_date, interval '1 day') d;

    if rec.slug = 'exhibitor_booth_connected' then
      update public.conference_products
      set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'day_pattern',
        (
          select jsonb_object_agg(d, case when i = 1 then 'meeting' else 'floor' end)
          from unnest(v_dates) with ordinality as t(d, i)
        )
      )
      where id = rec.product_id;
    else
      update public.conference_products
      set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'day_pattern',
        (select jsonb_object_agg(d, 'floor') from unnest(v_dates) as d)
      )
      where id = rec.product_id;
    end if;
  end loop;
end $$;
