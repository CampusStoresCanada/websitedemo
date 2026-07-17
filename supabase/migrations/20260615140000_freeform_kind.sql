-- v3 catalog proof — kind becomes a free label, not a fixed enum.
--
-- The point isn't a closed set of types; it's "add a thing, call it what it is,
-- and plug it into other things." A user must be able to coin "meeting",
-- "booth", "tour" without a migration. The engine reasons over the reference
-- ROLES (includes / involved_in / when / where / who / instance_of) and the
-- for-sale flag — never over the kind label. So we drop the kind CHECK.

do $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'public.conference_entities'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%kind%';
  if c is not null then
    execute format('alter table public.conference_entities drop constraint %I', c);
  end if;
end $$;
