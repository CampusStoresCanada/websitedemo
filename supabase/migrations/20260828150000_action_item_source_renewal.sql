-- A fourth provenance for board action items: 'renewal'.
--
-- Renewal call assignments are generated from renewal_assignments, one item
-- per director per meeting ("Contact your N assigned stores"). They are not
-- 'manual' — nobody typed them — and not 'minutes', which means extracted from
-- a minutes document by the mint pipeline. Recording them as either would make
-- the provenance column lie, and it is the column the checklist uses to explain
-- where an obligation came from.
--
-- It also gives the generator a reliable key: an item is re-synced by matching
-- (meeting_id, source='renewal', assignee) rather than by parsing its title.
--
-- Widening a CHECK, not adding a mechanism. Everything else about these items —
-- reminders, the emailed complete_token, ICS export, escalation — is the
-- existing board_action_items machinery, deliberately reused rather than
-- rebuilt beside it.

alter table public.board_action_items
  drop constraint if exists board_action_items_source_check;

alter table public.board_action_items
  add constraint board_action_items_source_check
  check (source = any (array['manual'::text, 'minutes'::text, 'backfill'::text, 'renewal'::text]));
