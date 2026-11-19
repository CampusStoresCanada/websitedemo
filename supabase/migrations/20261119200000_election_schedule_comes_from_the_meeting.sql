-- An election and a members' meeting are set up separately and then connected.
--
-- Steve 2026-11-19: "The Election module should set up the election, the AGM the
-- AGM. When an AGM is created then can 'Connect Election?' ... and the other way
-- around also works."
--
-- Today the coupling runs the opposite way from what the FK suggests:
-- `startElectionCycle` cannot be called without a meeting date, and it MINTS the
-- meeting and a draft members-only event itself. One press makes three objects.
-- The reason is that every election date is the meeting date minus N days --
-- `deriveSchedule` is four subtractions -- so the election had nowhere to get a
-- calendar except from a meeting it created.
--
-- Decoupled, an election in setup has NO calendar, and connecting a meeting is
-- the act that gives it one. That makes Connect load-bearing rather than
-- decorative: the deadlines arrive from a rule applied to a fact, not typed by
-- anyone. So the five date columns have to admit null.
--
-- `agm_date` stays what it has been since 20261118183000: the FROZEN snapshot of
-- the date the windows were derived FROM, not a duplicate of
-- `board_meetings.meeting_date`. That is what makes a meeting moving after the
-- fact detectable (`meetingDivergence`) instead of silently rewriting history.
--
-- Measured before applying: 1 election row, linked, all five dates present. The
-- invariant below therefore holds for all existing data.

alter table public.elections alter column agm_date drop not null;
alter table public.elections alter column nominations_open_at drop not null;
alter table public.elections alter column nominations_close_at drop not null;
alter table public.elections alter column ballots_open_at drop not null;
alter table public.elections alter column ballots_close_at drop not null;

-- ⛔ All five, or none. Five independent nullables would allow a half-scheduled
-- election -- nominations with no ballot close, say -- which is the shape of
-- thing that passes every type check and produces an election nobody can
-- finish. The windows exist exactly when a meeting is connected, because the
-- meeting is the only thing they can be derived from.
alter table public.elections
  add constraint elections_schedule_matches_meeting_link
  check (
    (
      meeting_id is null
      and agm_date is null
      and nominations_open_at is null
      and nominations_close_at is null
      and ballots_open_at is null
      and ballots_close_at is null
    )
    or (
      meeting_id is not null
      and agm_date is not null
      and nominations_open_at is not null
      and nominations_close_at is not null
      and ballots_open_at is not null
      and ballots_close_at is not null
    )
  );

comment on constraint elections_schedule_matches_meeting_link on public.elections is
  'An election in setup has no meeting and no calendar; a connected election has both. Connecting the meeting is what derives the windows, so a row can never be half-scheduled.';

comment on column public.elections.agm_date is
  'FROZEN snapshot of the meeting date the windows were derived from. Null until a meeting is connected. Never read this as "when the meeting is" -- that is board_meetings.meeting_date, and a divergence between the two is the signal that the meeting moved.';

comment on column public.elections.meeting_id is
  'The connected meeting of the members. Null while the election is in setup. One election per meeting (partial unique index).';
