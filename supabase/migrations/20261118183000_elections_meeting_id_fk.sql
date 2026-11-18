-- An election is held AT a meeting. Make that a relation instead of two dates
-- that happen to be equal.
--
-- APPLIED to the shared database 2026-11-18. This file is the record.
--
-- Before this, the ONLY link between an election and its meeting was
-- `elections.agm_date = board_meetings.meeting_date`. Every other
-- meeting-scoped table already carries a real `meeting_id` (board_documents,
-- board_action_items, board_minutes_drafts, meeting_proxies); elections was the
-- exception.
--
-- ⚠️ The two columns are NOT the same fact, which is why `agm_date` stays:
--   board_meetings.meeting_date — when the meeting IS. The board can move it.
--   elections.agm_date          — the date the election's windows were DERIVED
--                                 from. Written once at kickoff and never
--                                 updated, on purpose: moving the AGM must
--                                 never retroactively reopen a window that has
--                                 already closed. See the comment at
--                                 getElection's mapper.
--
-- So the real defect was never the duplication. It was that equality of those
-- two values was the only link, so a moved meeting made the join find nothing —
-- and "no election is bound to this meeting" was indistinguishable from "the
-- election is out of step with its meeting". The system went quiet exactly when
-- it should have been shouting. With the FK, divergence is detectable, and
-- `meetingDivergence()` in lib/governance/members-meetings.ts reports it.
--
-- `on delete set null`, matching board_meetings.event_id: deleting a meeting
-- must not take the election's record with it.

alter table public.elections
  add column if not exists meeting_id uuid
  references public.board_meetings(id) on delete set null;

-- One election per meeting. Partial so the many pre-link NULLs stay legal.
create unique index if not exists elections_meeting_id_key
  on public.elections (meeting_id)
  where meeting_id is not null;

comment on column public.elections.meeting_id is
  'The members'' meeting these directors are elected at. This is the relation; agm_date is the frozen date the windows were derived from, which may diverge if the meeting moves.';

-- Backfill from the date match that has been standing in for this relation.
-- One row at the time this ran (board-2027), linked to the 2027-01-21 AGM.
update public.elections e
   set meeting_id = m.id
  from public.board_meetings m
 where e.meeting_id is null
   and m.meeting_date = e.agm_date
   and m.meeting_type in ('agm', 'special_members');
