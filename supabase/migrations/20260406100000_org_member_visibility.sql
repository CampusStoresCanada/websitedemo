-- Org member visibility flag
-- Allows org admins (and global admins) to hide a person from all public/peer views
-- without deleting or deactivating their account.
-- Hidden members remain fully functional: they can log in, hold their role,
-- and appear in admin-facing tools. They are simply invisible to everyone else.

ALTER TABLE user_organizations
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN user_organizations.hidden IS
  'When true, this member is hidden from all public and peer-member-facing views. '
  'Only visible to: the org_admin of their org, global admin, and super_admin. '
  'Does not affect authentication, role, or data access — purely a visibility flag.';

-- Partial index: fast filtering for the common case (non-hidden active members)
CREATE INDEX IF NOT EXISTS idx_user_organizations_visible
  ON user_organizations (organization_id, status)
  WHERE hidden = false;
