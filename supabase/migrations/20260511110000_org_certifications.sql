-- Add certifications array to organizations.
-- Stores social/ethical designations for partner orgs (Canadian Made, Women Owned, etc.)
-- Values are a known set managed at the application layer.
-- Public display, no RLS gating needed — certifications are a positive marketing signal.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS certifications text[] NOT NULL DEFAULT '{}';

-- GIN index for efficient @> (contains) queries when filtering by certification.
CREATE INDEX IF NOT EXISTS organizations_certifications_gin
  ON organizations USING GIN (certifications);
