-- Org profile section visibility flags
-- Allows org admins to control which sections are visible to external viewers.
-- Defaults to true (fully visible) to preserve existing behavior.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS show_contacts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_brand_colors boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_in_benchmarking boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN organizations.show_contacts IS 'When false, the contacts section is hidden from public/partner/member viewers. Org admins and global admins always see contacts.';
COMMENT ON COLUMN organizations.show_brand_colors IS 'When false, brand colors are hidden from public/partner/member viewers. Org admins and global admins always see them.';
COMMENT ON COLUMN organizations.show_in_benchmarking IS 'When false, this org is excluded from benchmarking comparison data visible to other orgs, and their own benchmarking section is hidden from non-admin viewers.';
