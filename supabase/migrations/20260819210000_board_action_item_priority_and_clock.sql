-- Checklist widget: priority, and the clock the countdown bar needs.
-- See docs/BOARD_ACTION_ITEM_MINT.md §11.

ALTER TABLE board_action_items
  ADD COLUMN IF NOT EXISTS priority text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS held_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz;

ALTER TABLE board_action_items DROP CONSTRAINT IF EXISTS board_action_items_priority_check;
ALTER TABLE board_action_items ADD CONSTRAINT board_action_items_priority_check
  CHECK (priority IS NULL OR priority IN ('high','medium','low'));

CREATE INDEX IF NOT EXISTS board_action_items_live_idx
  ON board_action_items (status, due_date)
  WHERE status IN ('open','in_progress','deferred','intention');

INSERT INTO app_settings (key, value) VALUES
  ('board_age_ceiling',           '0.5'),
  ('board_age_tau_days',          '60'),
  ('board_urgency_window_days',   '7'),
  ('board_escalation_meetings',   '3')
ON CONFLICT (key) DO NOTHING;
