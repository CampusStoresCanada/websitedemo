-- The business of a members' meeting.
--
-- APPLIED to the shared database 2026-11-18. This file is the record.
--
-- By-Law Part VII: only the business set out in the NOTICE may be transacted at
-- a special meeting of the members. So a special meeting cannot be properly
-- called until someone has said what it is for — and until now there was
-- nowhere to say it. `board_meetings.notes` is the board's internal note on a
-- meeting (written by POST /api/admin/board/meetings); this is the statement
-- members are entitled to read, which is a different thing with a different
-- audience.
--
-- Nullable, and left null for an annual general meeting: the AGM's business is
-- fixed by the by-law — directors are elected, the financial statements are
-- presented, the previous minutes are approved — so there is nothing for a
-- person to supply. `membersMeetingGaps` asks for it only when the meeting is a
-- special one.
--
-- ⛔ Stored here and rendered from here. NOT copied into `events.body_html`:
-- that body is editable in EventForm's rich-text editor, so writing a derived
-- copy into it would be clobbered by the next person who edits the page, and
-- two statements of the meeting's business could then disagree about what may
-- lawfully be transacted. The public event page reads this through
-- `board_meetings.event_id`.

alter table public.board_meetings
  add column if not exists purpose text;

comment on column public.board_meetings.purpose is
  'The business to be transacted, as stated in the notice (By-Law Part VII). Required in practice for a special meeting of the members; null for an AGM, whose business the by-law fixes. Shown to members on the event page.';
