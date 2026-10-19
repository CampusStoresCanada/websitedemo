-- Let a person's link to an organisation be switched OFF.
--
-- ⛔ Fixes a live bug. deactivateOrgUser (the Deactivate button in an
-- organisation's user table, shipped 2026-08-17) sets status = 'inactive', but
-- this rule only allowed active / pending / rejected, so the database refused
-- every deactivation: zero have ever succeeded. The nightly link expiry uses
-- the same off switch.
--
-- Widening only: every existing row still satisfies the new rule.
alter table public.user_organizations
  drop constraint if exists user_organizations_status_check;

alter table public.user_organizations
  add constraint user_organizations_status_check
  check (status = any (array['active'::text, 'pending'::text, 'rejected'::text, 'inactive'::text]));
