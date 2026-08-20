-- Recurring action items. See docs/BOARD_ACTION_ITEM_MINT.md §11.
--
-- Completion-triggered, never clock-triggered: the next instance is created
-- when the current one is ticked. A series therefore can never accumulate a
-- backlog, and if the work stops happening the series quietly stops — which
-- is itself the signal. The open instance just ages and escalation catches it.

ALTER TABLE board_action_items
  ADD COLUMN IF NOT EXISTS recurrence text,
  ADD COLUMN IF NOT EXISTS series_id uuid;

ALTER TABLE board_action_items DROP CONSTRAINT IF EXISTS board_action_items_recurrence_check;
ALTER TABLE board_action_items ADD CONSTRAINT board_action_items_recurrence_check
  CHECK (recurrence IS NULL OR recurrence IN ('each_meeting','monthly','quarterly'));

CREATE INDEX IF NOT EXISTS board_action_items_series_idx
  ON board_action_items (series_id) WHERE series_id IS NOT NULL;
