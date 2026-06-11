-- Convert metadata.day_pattern values from single role strings to role arrays,
-- so each conference day can carry multiple roles (e.g. floor + move-out).
-- "floor_and_meeting" (the old combo value) becomes ["floor","meeting"].
-- Idempotent: array values are left as-is.
update public.conference_products
set metadata = jsonb_set(
  metadata,
  '{day_pattern}',
  coalesce(
    (
      select jsonb_object_agg(
        key,
        case
          when jsonb_typeof(value) = 'array' then value
          when value = '"floor_and_meeting"'::jsonb then '["floor","meeting"]'::jsonb
          else jsonb_build_array(value #>> '{}')
        end
      )
      from jsonb_each(metadata->'day_pattern')
    ),
    '{}'::jsonb
  )
)
where metadata ? 'day_pattern'
  and jsonb_typeof(metadata->'day_pattern') = 'object';
