-- Link site_content person slots to a contact record.
-- This means board/staff slots on the About page are backed by the same
-- contact record as everywhere else on the site — one source of truth.
--
-- contact_id is nullable: slots without a linked contact fall back to
-- the existing title/subtitle/body/image_url columns.
-- ON DELETE SET NULL: removing a contact un-assigns the slot but doesn't
-- delete the slot itself.

ALTER TABLE site_content
  ADD COLUMN contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX idx_site_content_contact_id
  ON site_content (contact_id)
  WHERE contact_id IS NOT NULL;

COMMENT ON COLUMN site_content.contact_id IS
  'Links this slot to a contact record. When set, the slot renders the contact''s name/photo/role rather than the local title/subtitle/image_url columns.';
