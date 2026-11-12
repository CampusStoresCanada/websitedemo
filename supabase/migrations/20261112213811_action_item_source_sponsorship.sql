-- Board action items can come from a sponsorship: the quarterly sponsored
-- Circle post a sponsor is owed (lib/sponsorship/post-reminders.ts). The item's
-- source_excerpt carries "sponsor_post:<agreement id>:<quarter start>", which
-- keys it to one agreement and one quarter.
ALTER TABLE public.board_action_items DROP CONSTRAINT IF EXISTS board_action_items_source_check;
ALTER TABLE public.board_action_items
  ADD CONSTRAINT board_action_items_source_check
  CHECK (source = ANY (ARRAY['manual'::text, 'minutes'::text, 'backfill'::text, 'renewal'::text, 'sponsorship'::text]));
