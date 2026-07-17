-- Seed admin-editable color and "what's included" features for existing booth packages.
update public.conference_products
set metadata = metadata || jsonb_build_object(
  'color', case slug when 'exhibitor_booth_connected' then 'purple' else 'blue' end,
  'features', jsonb_build_array(
    '8''x10'' booth space with 6''x2'' table and two chairs',
    'Meals during trade show hours (including breakfast)',
    'One networking session pass (additional passes $200/person)',
    'First 2 staff members included free'
  )
)
where (metadata->>'booth_system')::boolean is true
  and metadata->'day_pattern' is not null;
