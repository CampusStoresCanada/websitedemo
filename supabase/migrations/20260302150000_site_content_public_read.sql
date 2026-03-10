-- Chunk 15/Content hardening: ensure site_content exists and is publicly readable (active rows only)

create table if not exists public.site_content (
  id uuid primary key default gen_random_uuid(),
  section text not null,
  content_type text not null default 'person',
  title text null,
  subtitle text null,
  body text null,
  image_url text null,
  display_order integer not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  updated_by uuid null references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_site_content_section_active_order
  on public.site_content(section, is_active, display_order);

create index if not exists idx_site_content_section_order
  on public.site_content(section, display_order);

alter table public.site_content enable row level security;

grant select on public.site_content to anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'site_content'
      and policyname = 'site_content_public_read_active'
  ) then
    create policy site_content_public_read_active
      on public.site_content
      for select
      to anon, authenticated
      using (is_active = true);
  end if;
end $$;
