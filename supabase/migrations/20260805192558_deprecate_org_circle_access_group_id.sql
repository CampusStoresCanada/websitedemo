-- Mark organizations.circle_access_group_id as legacy/unread.
-- Dedicated per-partner Circle access groups were rolled back 2026-08-05:
-- partners are no longer marketed one, and the sync pipeline
-- (lib/circle/sync.ts) no longer reads this column at all — every active
-- partner/member now resolves to the shared "Partners"/"CSC Members" group
-- instead. Existing values are inert history from the old per-org-group
-- model (some point at groups already archived in Circle) and are left as
-- vestigial data rather than backfilled/cleared. One-off dedicated groups a
-- partner specifically asks for are handled manually via
-- /api/admin/circle/access-groups, not through this column.

COMMENT ON COLUMN organizations.circle_access_group_id IS
  'Legacy per-org Circle access group, no longer provisioned or read by '
  'the sync pipeline (see lib/circle/sync.ts). Do not reintroduce reads '
  'of this column without confirming the group still exists/is current — '
  'many stored values point at groups since archived in Circle.';
