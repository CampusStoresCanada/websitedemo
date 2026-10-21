-- Check-in cards: a meeting is confirmed by scanning the booth's card.
--
-- A check-in event already records who was where (person_id, entity_id). A
-- scheduled meeting is not a catalogue entity, it is a `schedules` row, and
-- CANCOLL's bursary report needs to know WHICH meeting and WHO confirmed it:
-- the delegate scanning the booth card, the exhibitor confirming from their own
-- card, or both (two rows, one per side). Additive and nullable: every existing
-- row and writer is unchanged.

alter table public.conference_check_in_events
  add column if not exists schedule_id uuid references public.schedules(id) on delete set null,
  add column if not exists confirmed_by text
    check (confirmed_by is null or confirmed_by in ('attendee', 'exhibitor'));

comment on column public.conference_check_in_events.schedule_id is
  'The scheduled meeting this check-in confirms (booth check-in card). Null for door and badge check-ins.';
comment on column public.conference_check_in_events.confirmed_by is
  'Who scanned a check-in card: the attendee themselves, or the exhibitor confirming the meeting.';

create index if not exists conference_check_in_events_schedule_idx
  on public.conference_check_in_events (schedule_id)
  where schedule_id is not null;
