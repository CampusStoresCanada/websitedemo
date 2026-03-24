-- Platform provisioning: client identity + feature toggles
-- Supports bootstrap wizard and post-bootstrap feature management

-- ────────────────────────────────────────────────────────────────
-- 1. Platform config (singleton per tenant)
-- ────────────────────────────────────────────────────────────────

create table if not exists public.platform_config (
  id uuid primary key default gen_random_uuid(),
  client_name text not null default '',
  client_short_name text not null default '',
  client_domain text not null default '',
  support_email text not null default '',
  logo_url text,
  primary_color text not null default '#1e3a5f',
  bootstrapped_at timestamptz,
  bootstrapped_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure only one row can ever exist
create unique index if not exists idx_platform_config_singleton
  on public.platform_config ((true));

alter table public.platform_config enable row level security;

-- Super admins can read and write
create policy "platform_config_super_admin_all"
  on public.platform_config
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role = 'super_admin'
    )
  );

-- Admins can read
create policy "platform_config_admin_read"
  on public.platform_config
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

-- ────────────────────────────────────────────────────────────────
-- 2. Platform features (one row per feature key)
-- ────────────────────────────────────────────────────────────────

create table if not exists public.platform_features (
  id uuid primary key default gen_random_uuid(),
  feature_key text not null unique
    check (feature_key in (
      'membership', 'billing', 'visibility', 'calendar',
      'conference', 'circle', 'quickbooks', 'communications', 'events'
    )),
  enabled boolean not null default false,
  always_on boolean not null default false,
  config_json jsonb not null default '{}'::jsonb,
  enabled_at timestamptz,
  enabled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_features enable row level security;

-- Super admins can read and write
create policy "platform_features_super_admin_all"
  on public.platform_features
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role = 'super_admin'
    )
  );

-- Admins can read
create policy "platform_features_admin_read"
  on public.platform_features
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
    )
  );

-- ────────────────────────────────────────────────────────────────
-- 3. Seed all feature rows (disabled by default, always_on for core)
-- ────────────────────────────────────────────────────────────────

insert into public.platform_features (feature_key, enabled, always_on) values
  ('membership',     true,  true),
  ('billing',        true,  true),
  ('visibility',     true,  true),
  ('calendar',       true,  true),
  ('conference',     false, false),
  ('circle',         false, false),
  ('quickbooks',     false, false),
  ('communications', false, false),
  ('events',         false, false)
on conflict (feature_key) do nothing;
