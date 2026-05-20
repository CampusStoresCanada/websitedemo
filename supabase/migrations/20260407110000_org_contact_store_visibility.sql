-- Per-section visibility flags for Primary Contact and Store Information
-- Extends the org-level profile visibility controls introduced in 20260407100000.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS show_primary_contact boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_store_information boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN organizations.show_primary_contact IS 'When false, the Primary Contact section (org email, phone, website) is hidden from public/partner/member viewers.';
COMMENT ON COLUMN organizations.show_store_information IS 'When false, the Store Information section (square footage, FTE, location count, etc.) is hidden from public/partner/member viewers.';
