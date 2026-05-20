-- Add batch_id to pending_content_changes so that multiple fields
-- submitted in one save (e.g. title + subtitle + body from ContentEntryForm)
-- can be grouped, reviewed, and approved/rejected atomically.
--
-- NULL batch_id means a single-field change (backward-compatible).

ALTER TABLE pending_content_changes
  ADD COLUMN batch_id uuid DEFAULT NULL;

CREATE INDEX idx_pcc_batch_id
  ON pending_content_changes (batch_id)
  WHERE batch_id IS NOT NULL;

COMMENT ON COLUMN pending_content_changes.batch_id IS
  'Groups related field changes from the same save operation. NULL for single-field changes.';
