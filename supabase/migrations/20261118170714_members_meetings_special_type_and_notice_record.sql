-- Members' meetings: allow a SPECIAL meeting of the members, and give the
-- meeting itself somewhere to record notice, the proxy form and the package.
--
-- APPLIED to the shared database 2026-11-18 (version 20261118170714). This file
-- is the record, written after the fact — prod and local are one database here.
--
-- Why these four facts moved off `elections.config`, where they lived as
-- `agmNoticeSentAt`, `proxyFormSentAt`, `agmPackageSentAt` and
-- `agmPackageSendCount`: they are obligations of the MEETING under By-Law Part
-- VII, their deadlines derive from the day it sits (`resolveNoticeWindow` is
-- pure, taking only the date), and a special meeting of the members has no
-- election to hang them on. Keeping them on the election left such a meeting
-- unable to record that notice had been given at all, so its progress list said
-- "notice not given" for ever.
--
-- Nothing is backfilled because nothing existed: the only election row
-- (board-2027) had none of the four keys set, verified before this ran.
--
-- Additive. No existing row changes, and no existing row violates the widened
-- check constraint — `meeting_type` held only 'regular' and 'agm'.

alter table public.board_meetings
  add column if not exists notice_sent_at     timestamptz,
  add column if not exists proxy_form_sent_at timestamptz,
  add column if not exists package_sent_at    timestamptz,
  add column if not exists package_send_count integer not null default 0;

comment on column public.board_meetings.notice_sent_at is
  'By-Law Part VII S4(b). When notice of this members'' meeting was given. Set by sendAgmNotice, or recorded by hand for a meeting with no election.';
comment on column public.board_meetings.proxy_form_sent_at is
  'By-Law Part VII S7(b). When the proxy form went to members.';
comment on column public.board_meetings.package_sent_at is
  'When the members'' package was last sent.';
comment on column public.board_meetings.package_send_count is
  'How many times the package has been sent. A re-send is legitimate; a count makes it visible.';

-- 'special_members' is a special meeting OF THE MEMBERS. ⛔ Distinct from
-- 'special', which already means a special meeting of the BOARD and is created
-- from a different screen. Reading one value as two kinds of meeting is how the
-- AGM got lost in the board meeting list in the first place.
alter table public.board_meetings
  drop constraint if exists board_meetings_meeting_type_check;

alter table public.board_meetings
  add constraint board_meetings_meeting_type_check
  check (meeting_type = any (array['regular'::text, 'special'::text, 'agm'::text, 'special_members'::text]));

-- ⚠️ Not changed, but worth knowing when reading the above:
-- `board_meetings_meeting_date_key` makes meeting_date UNIQUE across the whole
-- table, so a members' meeting can never share a date with a board meeting.
-- `scheduleMembersMeetingAction` refuses such a collision by name.
