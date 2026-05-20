-- ---------------------------------------------------------------------------
-- Sponsorship Platform
-- Chunk 15: sponsor_tiers, sponsor_agreements, sponsor_placement_slots,
--           sponsor_placements + CANCOLL fields on organizations
--
-- Architecture: sponsorship is a platform, not a feature. The conference,
-- website, and Circle all consume it. Tiers, benefits, and placements are
-- fully admin-configurable via GUI — no deploys needed for content changes.
-- ---------------------------------------------------------------------------


-- ────────────────────────────────────────────────────────────────
-- 1. sponsor_tiers
-- What you're selling. Admin can create, rename, reprice, reorder.
-- Benefits are stored as a jsonb array: [{ key, label, config }]
-- ────────────────────────────────────────────────────────────────

create table if not exists public.sponsor_tiers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text not null unique,
  description     text,
  price_cents     integer,
  color           text,                          -- hex, for badges and UI chrome
  display_order   integer not null default 0,
  is_active       boolean not null default true,
  max_sponsors    integer,                       -- null = unlimited slots
  benefits        jsonb not null default '[]'::jsonb,
                                                 -- [{ key, label, config }]
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_sponsor_tiers_active
  on public.sponsor_tiers (display_order)
  where is_active = true;

alter table public.sponsor_tiers enable row level security;

-- Public: read active tiers (needed for /sponsors page, org profile badges)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sponsor_tiers'
    and policyname = 'sponsor_tiers_public_read'
  ) then
    create policy "sponsor_tiers_public_read" on public.sponsor_tiers
      for select using (is_active = true);
  end if;
end $$;

-- Admins: full management
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sponsor_tiers'
    and policyname = 'sponsor_tiers_admin_all'
  ) then
    create policy "sponsor_tiers_admin_all" on public.sponsor_tiers
      for all
      using (exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
      ))
      with check (exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
      ));
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────
-- 2. sponsor_agreements
-- Who bought what tier, when, and at what status.
-- custom_benefits allows per-agreement overrides/additions on top
-- of the tier defaults (e.g. extra AMA slots for a specific sponsor).
-- ────────────────────────────────────────────────────────────────

create table if not exists public.sponsor_agreements (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete restrict,
  tier_id                 uuid not null references public.sponsor_tiers(id) on delete restrict,
  status                  text not null default 'draft'
                            check (status in ('draft', 'active', 'expired', 'cancelled')),
  start_date              date not null,
  end_date                date not null,
  signed_at               timestamptz,
  signed_by_contact_id    uuid references public.contacts(id) on delete set null,
  signed_doc_url          text,                  -- link to executed agreement
  custom_benefits         jsonb default '[]'::jsonb,
                                                 -- overrides/additions to tier benefits
  notes                   text,
  created_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint sponsor_agreements_dates_check check (end_date > start_date)
);

-- Index for active agreement lookups (most common query path)
create index if not exists idx_sponsor_agreements_active
  on public.sponsor_agreements (organization_id, status, start_date, end_date)
  where status = 'active';

-- Index for date-range queries (conference page, homepage rendering)
create index if not exists idx_sponsor_agreements_dates
  on public.sponsor_agreements (start_date, end_date, status);

-- Index for tier-based queries
create index if not exists idx_sponsor_agreements_tier
  on public.sponsor_agreements (tier_id, status);

alter table public.sponsor_agreements enable row level security;

-- Admins: full management
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sponsor_agreements'
    and policyname = 'sponsor_agreements_admin_all'
  ) then
    create policy "sponsor_agreements_admin_all" on public.sponsor_agreements
      for all
      using (exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
      ))
      with check (exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
      ));
  end if;
end $$;

-- Org admins: read their own org's agreements
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sponsor_agreements'
    and policyname = 'sponsor_agreements_org_read'
  ) then
    create policy "sponsor_agreements_org_read" on public.sponsor_agreements
      for select
      using (exists (
        select 1 from public.user_organizations uo
        where uo.user_id = auth.uid()
        and uo.organization_id = sponsor_agreements.organization_id
        and uo.role in ('org_admin', 'admin')
        and uo.status = 'active'
      ));
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────
-- 3. sponsor_placement_slots
-- Registry of WHERE sponsors can appear across the platform.
-- Admin-extendable without a deploy — add a new slot key and it
-- becomes available in the placement editor immediately.
-- config_schema is a jsonb schema that drives what fields appear
-- in the placement editor for that slot type.
-- ────────────────────────────────────────────────────────────────

create table if not exists public.sponsor_placement_slots (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,          -- machine key, never changes
  label           text not null,                 -- human label in admin UI
  description     text,
  location        text not null
                    check (location in ('website', 'email', 'circle', 'conference')),
  config_schema   jsonb not null default '{}'::jsonb,
                                                 -- drives placement editor fields
  is_active       boolean not null default true,
  display_order   integer not null default 0,
  created_at      timestamptz not null default now()
);

alter table public.sponsor_placement_slots enable row level security;

-- Public: read active slots (renderers need to know what slots exist)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sponsor_placement_slots'
    and policyname = 'sponsor_placement_slots_public_read'
  ) then
    create policy "sponsor_placement_slots_public_read" on public.sponsor_placement_slots
      for select using (is_active = true);
  end if;
end $$;

-- Admins: full management
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sponsor_placement_slots'
    and policyname = 'sponsor_placement_slots_admin_all'
  ) then
    create policy "sponsor_placement_slots_admin_all" on public.sponsor_placement_slots
      for all
      using (exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
      ))
      with check (exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
      ));
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────
-- 4. sponsor_placements
-- Active placements per agreement. Admin configures logo, link,
-- order, and date range per slot. Can activate/deactivate a single
-- placement without touching the parent agreement.
-- ────────────────────────────────────────────────────────────────

create table if not exists public.sponsor_placements (
  id              uuid primary key default gen_random_uuid(),
  agreement_id    uuid not null references public.sponsor_agreements(id) on delete cascade,
  slot_id         uuid not null references public.sponsor_placement_slots(id) on delete restrict,
  logo_url        text,
  link_url        text,
  config_json     jsonb not null default '{}'::jsonb,
                                                 -- slot-specific config overrides
  display_order   integer not null default 0,
  start_date      date,                          -- null = inherits from agreement
  end_date        date,                          -- null = inherits from agreement
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Primary query path: "give me all active placements for slot X on date Y"
create index if not exists idx_sponsor_placements_slot_active
  on public.sponsor_placements (slot_id, is_active, display_order);

-- Secondary: all placements for an agreement (admin view)
create index if not exists idx_sponsor_placements_agreement
  on public.sponsor_placements (agreement_id);

alter table public.sponsor_placements enable row level security;

-- Public: read active placements (needed for rendering logos on public pages)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sponsor_placements'
    and policyname = 'sponsor_placements_public_read'
  ) then
    create policy "sponsor_placements_public_read" on public.sponsor_placements
      for select using (is_active = true);
  end if;
end $$;

-- Admins: full management
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sponsor_placements'
    and policyname = 'sponsor_placements_admin_all'
  ) then
    create policy "sponsor_placements_admin_all" on public.sponsor_placements
      for all
      using (exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
      ))
      with check (exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
        and p.global_role in ('admin', 'super_admin')
      ));
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────
-- 5. CANCOLL fields on organizations
-- Flag for buying group membership. Data imported from Notion.
-- ────────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists is_cancoll_member boolean not null default false,
  add column if not exists cancoll_tier text;    -- e.g. 'member', 'preferred', null

create index if not exists idx_organizations_cancoll
  on public.organizations (is_cancoll_member)
  where is_cancoll_member = true;


-- ────────────────────────────────────────────────────────────────
-- 6. Add 'sponsorships' to platform_features
-- ────────────────────────────────────────────────────────────────

-- Extend the feature_key check constraint to include 'sponsorships'
alter table public.platform_features
  drop constraint if exists platform_features_feature_key_check;

alter table public.platform_features
  add constraint platform_features_feature_key_check
  check (feature_key in (
    'membership', 'billing', 'visibility', 'calendar',
    'conference', 'circle', 'quickbooks', 'communications',
    'events', 'sponsorships'
  ));

insert into public.platform_features (feature_key, enabled, always_on)
  values ('sponsorships', false, false)
  on conflict (feature_key) do nothing;


-- ────────────────────────────────────────────────────────────────
-- 7. Seed: initial tiers
-- ────────────────────────────────────────────────────────────────

insert into public.sponsor_tiers (name, slug, description, price_cents, color, display_order, max_sponsors, benefits)
values
  (
    'Platinum',
    'platinum',
    'Premier sponsorship tier. Includes data intelligence tools, travel hosting, and full year-round platform presence.',
    3000000,  -- $30,000
    '#B5A642',
    1,
    1,        -- intentionally limited to 1
    '[
      { "key": "logo_homepage_featured",  "label": "Logo — Homepage (Featured)",      "config": {} },
      { "key": "logo_partners_page",      "label": "Logo — Partners Page",            "config": {} },
      { "key": "logo_conference_page",    "label": "Logo — Conference Page",          "config": {} },
      { "key": "sponsors_page",           "label": "Sponsors Page — Featured",        "config": {} },
      { "key": "cancoll_report_access",   "label": "Private CANCOLL Data Report",     "config": {} },
      { "key": "partner_report_access",   "label": "State of the Industry Report",    "config": {} },
      { "key": "circle_partner_space",    "label": "Circle — Dedicated Partner Space","config": {} },
      { "key": "circle_community_tag",    "label": "Circle — Community Partner Tag",  "config": {} },
      { "key": "circle_ama_slots",        "label": "Circle — AMA / Sponsored Events", "config": { "count": 4 } },
      { "key": "conference_exhibitor",    "label": "Conference — Exhibitor Booth",     "config": {} },
      { "key": "conference_travel_host",  "label": "Conference — Member Travel Host", "config": {} },
      { "key": "conference_speaking_slot","label": "Conference — Speaking Slot",       "config": {} },
      { "key": "email_broadcast_slots",   "label": "Email — Broadcast Slots",         "config": { "count": 4 } }
    ]'::jsonb
  ),
  (
    'Gold',
    'gold',
    'Offsite event host. Year-round community presence and partner recognition.',
    2000000,  -- $20,000
    '#B8860B',
    2,
    2,        -- two slots, one per offsite event
    '[
      { "key": "logo_homepage_featured",  "label": "Logo — Homepage",                 "config": {} },
      { "key": "logo_partners_page",      "label": "Logo — Partners Page",            "config": {} },
      { "key": "logo_conference_page",    "label": "Logo — Conference Page",          "config": {} },
      { "key": "sponsors_page",           "label": "Sponsors Page",                   "config": {} },
      { "key": "partner_report_access",   "label": "State of the Industry Report",    "config": {} },
      { "key": "circle_partner_space",    "label": "Circle — Dedicated Partner Space","config": {} },
      { "key": "circle_community_tag",    "label": "Circle — Community Partner Tag",  "config": {} },
      { "key": "circle_ama_slots",        "label": "Circle — AMA / Sponsored Events", "config": { "count": 1 } },
      { "key": "conference_exhibitor",    "label": "Conference — Exhibitor Booth",     "config": {} },
      { "key": "conference_offsite_host", "label": "Conference — Offsite Event Host",  "config": {} },
      { "key": "email_broadcast_slots",   "label": "Email — Broadcast Slots",         "config": { "count": 2 } }
    ]'::jsonb
  )
on conflict (slug) do nothing;


-- ────────────────────────────────────────────────────────────────
-- 8. Seed: initial placement slots
-- These are the registered WHERE points. Admin can add more via GUI.
-- config_schema drives what fields appear in the placement editor.
-- ────────────────────────────────────────────────────────────────

insert into public.sponsor_placement_slots (key, label, description, location, display_order, config_schema)
values
  (
    'homepage_featured',
    'Homepage — Featured Sponsor Section',
    'Above-the-fold featured section on the public homepage. Prominent logo, tagline, and optional CTA.',
    'website', 1,
    '{ "fields": ["logo_url", "link_url", "tagline", "cta_label"] }'::jsonb
  ),
  (
    'homepage_carousel',
    'Homepage — Logo Carousel',
    'Rotating logo carousel on the homepage alongside member and partner logos.',
    'website', 2,
    '{ "fields": ["logo_url", "link_url"] }'::jsonb
  ),
  (
    'partners_page_featured',
    'Partners Page — Featured Sponsor',
    'Featured sponsor callout at the top of the /partners directory.',
    'website', 3,
    '{ "fields": ["logo_url", "link_url", "tagline"] }'::jsonb
  ),
  (
    'partners_page_listing',
    'Partners Page — Directory Listing',
    'Tier-badged listing in the partner directory.',
    'website', 4,
    '{ "fields": ["logo_url", "link_url"] }'::jsonb
  ),
  (
    'sponsors_page',
    'Sponsors Page — /sponsors',
    'Dedicated sponsors page listing with tier display, description, and contact.',
    'website', 5,
    '{ "fields": ["logo_url", "link_url", "tagline", "description", "contact_name", "contact_email"] }'::jsonb
  ),
  (
    'conference_page',
    'Conference — Landing Page',
    'Sponsor logo and recognition on the conference landing page.',
    'conference', 10,
    '{ "fields": ["logo_url", "link_url", "tier_label"] }'::jsonb
  ),
  (
    'conference_schedule',
    'Conference — Schedule & Program',
    'Sponsor attribution on the published schedule.',
    'conference', 11,
    '{ "fields": ["logo_url", "link_url"] }'::jsonb
  ),
  (
    'conference_registration',
    'Conference — Registration Page',
    'Sponsor acknowledgment on the registration flow.',
    'conference', 12,
    '{ "fields": ["logo_url", "link_url", "tagline"] }'::jsonb
  ),
  (
    'conference_offsite',
    'Conference — Offsite Event',
    'Named host of a specific offsite event. Config references the offsite event id.',
    'conference', 13,
    '{ "fields": ["logo_url", "link_url", "event_name", "offsite_event_id"] }'::jsonb
  ),
  (
    'email_header',
    'Email — Newsletter Header',
    'Logo in the header of member email newsletters.',
    'email', 20,
    '{ "fields": ["logo_url", "link_url"] }'::jsonb
  ),
  (
    'email_footer',
    'Email — Newsletter Footer',
    'Logo and brief acknowledgment in the footer of member emails.',
    'email', 21,
    '{ "fields": ["logo_url", "link_url", "acknowledgment_text"] }'::jsonb
  ),
  (
    'circle_community_space',
    'Circle — Dedicated Community Space',
    'A branded space in the Circle community provisioned for the sponsor.',
    'circle', 30,
    '{ "fields": ["space_name", "space_description", "logo_url"] }'::jsonb
  )
on conflict (key) do nothing;
