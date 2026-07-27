-- Closes public_bucket_allows_listing (2 buckets) from the advisor sweep.
-- "event-content" and "organization-images" each had a SELECT policy on
-- storage.objects scoped only to bucket_id (no folder/path restriction),
-- which governs the list() API — anyone could enumerate every filename in
-- either bucket, not just fetch a file whose URL they already have.
--
-- Verified safe to drop entirely, not just narrow:
--   - Both buckets have public=true, so direct GET-by-known-path
--     (the /storage/v1/object/public/... URLs used in every <img> tag)
--     bypasses storage RLS regardless of any policy on storage.objects —
--     dropping these policies doesn't affect how images are displayed.
--   - The only real list() call (lib/actions/conference-floor-plan.ts,
--     clearing old floor-plan images) uses createAdminClient(), which
--     bypasses storage RLS entirely.
--   - The only other writes (upload-organization-image.ts's .remove())
--     also already use createAdminClient() (fixed earlier this session).
--   - contact-photos and organization-logos — also public=true buckets —
--     already have zero SELECT policy on storage.objects and work fine,
--     confirming this is the correct end state, not a special case.

DROP POLICY IF EXISTS "Public read for event content images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view organization images" ON storage.objects;
