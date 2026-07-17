-- Booth package colors are now admin-picked arbitrary hex values (color picker +
-- hex input) instead of a curated palette key. Convert the two seeded string
-- color keys to their equivalent hex codes so existing packages keep their look.
update public.conference_products
set metadata = metadata || jsonb_build_object('color', '#3b82f6')
where (metadata->>'booth_system')::boolean is true
  and metadata->>'color' = 'blue';

update public.conference_products
set metadata = metadata || jsonb_build_object('color', '#a855f7')
where (metadata->>'booth_system')::boolean is true
  and metadata->>'color' = 'purple';
