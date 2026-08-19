-- Mint board action items from minutes. See docs/BOARD_ACTION_ITEM_MINT.md.

-- An item that fails the rubric is recorded as an "intention": visible and
-- counted, but never notified. Implemented as a status value rather than a
-- separate flag because every reminder query whitelists open/in_progress,
-- so a new status outside that set is silent by construction and no future
-- query can forget to exclude it.
ALTER TABLE board_action_items DROP CONSTRAINT IF EXISTS board_action_items_status_check;
ALTER TABLE board_action_items ADD CONSTRAINT board_action_items_status_check
  CHECK (status IN ('open','in_progress','complete','deferred','intention'));

ALTER TABLE board_action_items
  -- Which rubric tests failed: no_owner, owner_unresolved, uncompletable_verb, no_finish_line
  ADD COLUMN IF NOT EXISTS quality_flags text[] NOT NULL DEFAULT '{}',
  -- minutes | manual | backfill
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  -- Verbatim ACTION line. Traceability back to the minutes, and the dedupe
  -- key that makes re-minting the same meeting idempotent.
  ADD COLUMN IF NOT EXISTS source_excerpt text,
  -- Set once, on first mint. Revising due_date no longer erases the original
  -- commitment (the spreadsheet kept this as a separate REVISED DATE column).
  ADD COLUMN IF NOT EXISTS due_date_original date;

ALTER TABLE board_action_items DROP CONSTRAINT IF EXISTS board_action_items_source_check;
ALTER TABLE board_action_items ADD CONSTRAINT board_action_items_source_check
  CHECK (source IN ('manual','minutes','backfill'));

-- Re-minting a meeting must not duplicate items already minted from the same
-- ACTION line.
CREATE UNIQUE INDEX IF NOT EXISTS board_action_items_meeting_excerpt_idx
  ON board_action_items (meeting_id, md5(source_excerpt))
  WHERE source_excerpt IS NOT NULL;

-- Where the spreadsheet's Update narrative lands: append-only, timestamped,
-- attributed. Previously this overwrote `description` on every edit.
CREATE TABLE IF NOT EXISTS board_action_item_updates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid NOT NULL REFERENCES board_action_items(id) ON DELETE CASCADE,
  note        text NOT NULL,
  author_id   uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS board_action_item_updates_item_idx
  ON board_action_item_updates (item_id, created_at DESC);

ALTER TABLE board_action_item_updates ENABLE ROW LEVEL SECURITY;
