-- Add partner_links JSONB column to organizations.
-- Stores typed link entries with per-link visibility controls.
-- Schema:
--   id:           uuid (client-generated)
--   type:         "catalogue" | "price_list" | "order_portal" | "line_sheet" | "custom"
--   label:        human-readable name
--   visibility:   "public" | "member" | "org_admin"
--   url:          external URL (mutually exclusive with storage_path)
--   storage_path: Supabase Storage path in partner-documents bucket

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS partner_links JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Private storage bucket for partner documents (PDFs, etc.)
-- Bucket is created with no public access; all reads go through signed URLs.
-- NOTE: The bucket itself must be created via dashboard or storage API since
-- Supabase Storage buckets aren't created via SQL migrations.
-- Run this after migration:
--   supabase storage create-bucket partner-documents --private
