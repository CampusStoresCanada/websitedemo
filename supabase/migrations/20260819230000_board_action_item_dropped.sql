-- A fourth ending: closed without being done.
--
-- "Still real?" was a question the system could not accept a no to. Ticking a
-- dead item complete is a lie that inflates the completion rate the Stats tab
-- exists to make credible; on hold promises a return; delete erases the record.
-- Dropped is an honest close, counted separately so the board can see how much
-- of what it raises never mattered.
--
-- Silent by construction, like `intention`: every reminder query whitelists
-- open/in_progress, so nothing needs to learn about this status.

ALTER TABLE board_action_items DROP CONSTRAINT IF EXISTS board_action_items_status_check;
ALTER TABLE board_action_items ADD CONSTRAINT board_action_items_status_check
  CHECK (status IN ('open','in_progress','complete','deferred','intention','dropped'));

ALTER TABLE board_action_items
  ADD COLUMN IF NOT EXISTS dropped_reason text,
  ADD COLUMN IF NOT EXISTS dropped_at timestamptz;
