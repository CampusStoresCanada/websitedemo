-- Add per-contact visibility flag.
-- When hidden = true, the contact is excluded from all non-privileged views
-- (public, authenticated, partner, member). Org admins and global admins
-- always see all contacts regardless of this flag.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN contacts.hidden IS
  'When true, this contact is hidden from all non-privileged viewers. '
  'Org admins and global admins can still see it.';
