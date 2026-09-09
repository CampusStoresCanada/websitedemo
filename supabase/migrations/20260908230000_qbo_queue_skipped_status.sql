-- Add a terminal 'skipped' status to all five QuickBooks worker queues.
--
-- Why this is needed now: the qbo_export_backlog ops rule was widened to watch
-- every queue, and made durable — it re-raises for as long as any queue holds a
-- `failed` row and cannot be silenced by resolving the alert. That is the point
-- (a resolved alert on a still-failed row is how $4,689.50 of collected money
-- went unflagged for a week in September 2026), but it exposes an existing
-- conflation: `failed` currently means BOTH "needs a human" and "a human
-- already looked and consciously parked it".
--
-- There is at least one row of the second kind in production — a conference
-- refund deliberately left unprocessed because retrying it would double-post a
-- $4,520 refund receipt, with the reasoning written into error_message. Without
-- a separate state, the new rule would nag about that row forever with no
-- honest way to clear it, and the usual response to an unsilenceable alert is
-- to stop reading the alerts.
--
-- `skipped` says what is actually true: closed on purpose, without posting to
-- QuickBooks. The workers never set it (their claim query only looks at
-- 'pending' and 'retrying'), so it is a human-only, terminal state. Rows in it
-- are excluded from the backlog rule and from the /admin/ops failed panel; the
-- reason stays in error_message.
--
-- Widening a CHECK is additive and backward-compatible: no existing row changes,
-- and code that never writes 'skipped' is unaffected.

ALTER TABLE public.qbo_export_queue
  DROP CONSTRAINT qbo_export_queue_status_check;
ALTER TABLE public.qbo_export_queue
  ADD CONSTRAINT qbo_export_queue_status_check
  CHECK (status = ANY (ARRAY['pending', 'processing', 'completed', 'failed', 'retrying', 'skipped']));

ALTER TABLE public.qbo_membership_refund_queue
  DROP CONSTRAINT qbo_membership_refund_queue_status_check;
ALTER TABLE public.qbo_membership_refund_queue
  ADD CONSTRAINT qbo_membership_refund_queue_status_check
  CHECK (status = ANY (ARRAY['pending', 'processing', 'completed', 'failed', 'retrying', 'skipped']));

ALTER TABLE public.qbo_conference_receipt_queue
  DROP CONSTRAINT qbo_conference_receipt_queue_status_check;
ALTER TABLE public.qbo_conference_receipt_queue
  ADD CONSTRAINT qbo_conference_receipt_queue_status_check
  CHECK (status = ANY (ARRAY['pending', 'processing', 'completed', 'failed', 'retrying', 'skipped']));

ALTER TABLE public.qbo_conference_refund_queue
  DROP CONSTRAINT qbo_conference_refund_queue_status_check;
ALTER TABLE public.qbo_conference_refund_queue
  ADD CONSTRAINT qbo_conference_refund_queue_status_check
  CHECK (status = ANY (ARRAY['pending', 'processing', 'completed', 'failed', 'retrying', 'skipped']));

ALTER TABLE public.qbo_misc_receipt_queue
  DROP CONSTRAINT qbo_misc_receipt_queue_status_check;
ALTER TABLE public.qbo_misc_receipt_queue
  ADD CONSTRAINT qbo_misc_receipt_queue_status_check
  CHECK (status = ANY (ARRAY['pending', 'processing', 'completed', 'failed', 'retrying', 'skipped']));
