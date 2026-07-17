-- v3 catalog proof — Audience inherits the website's people categories.
--
-- The website already defines who people are: Public → Partner → Member →
-- Org Admin → Admin → Super Admin (lib/auth/types.ts PERMISSION_LEVELS).
-- A conference INHERITS those as starting-point audiences (seeded), then can
-- define its own on top. source_role records which website tier an audience
-- was inherited from (null = conference-defined). This is the cross-system
-- backward reference — the same "pull from what we already know" as days.

alter table public.entity_audience
  add column if not exists source_role text;

comment on column public.entity_audience.source_role is
  'Website permission tier this audience inherits from (public/partner/member/org_admin/admin/super_admin); null = conference-defined.';
