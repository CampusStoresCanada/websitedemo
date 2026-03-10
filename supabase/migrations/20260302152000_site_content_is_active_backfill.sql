-- Backfill legacy site_content rows where is_active is null.
-- These rows should be treated as active unless explicitly disabled.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'site_content'
      and column_name = 'is_active'
  ) then
    update public.site_content
    set is_active = true
    where is_active is null;

    alter table public.site_content
      alter column is_active set default true;

    alter table public.site_content
      alter column is_active set not null;
  end if;
end $$;
