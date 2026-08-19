-- Board voting on Vendor Partner applications.
--
-- Butler Ghost posts each application to the Board Stuff Circle space with
-- Yes / No / Abstain CTA buttons. Those buttons link back here; this is the
-- governance record, and Circle is only the surface it is displayed on.
--
-- Circle cannot hold the record itself: polls cannot be created or read
-- through any Circle API (proven 2026-08-19 -- every write returns HTTP 200
-- and does nothing). See lib/board/vote-post.ts.

create table if not exists public.board_votes (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references public.signup_applications(id) on delete cascade,

  -- Unguessable id for the vote URL, so the post never exposes a database id.
  -- Follows the board_action_items.complete_token pattern. Note the URL is
  -- shared by all directors -- a Circle post is one document everyone sees, so
  -- the voter is identified by their website session, not by the link.
  public_token      text not null unique,

  circle_post_id    bigint,
  circle_post_url   text,

  opened_at         timestamptz not null default now(),
  closes_at         timestamptz not null,
  reminder_sent_at  timestamptz,

  -- Snapshotted, never computed at read time. If the bylaws change or the
  -- board grows, a past decision must still re-tally under the rule that was
  -- actually in force when it was taken.
  board_size        integer not null default 9,
  threshold         integer not null default 5,

  -- open      -- still accepting ballots
  -- carried   -- reached the threshold in favour
  -- rejected  -- enough No votes that the threshold became unreachable
  -- lapsed    -- deadline passed without resolution; NOT a rejection, rolls to
  --              the next board meeting. An applicant must never be turned away
  --              because directors were travelling.
  -- withdrawn -- application pulled or superseded while the vote was open
  status            text not null default 'open'
                    check (status in ('open','carried','rejected','lapsed','withdrawn')),

  decided_at        timestamptz,
  executed_at       timestamptz,
  executed_by       uuid references public.profiles(id),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- At most one live vote per application; historical votes stay for the record.
create unique index if not exists board_votes_one_open_per_application
  on public.board_votes(application_id)
  where status = 'open';

create index if not exists board_votes_status_closes_at_idx
  on public.board_votes(status, closes_at);

create index if not exists board_votes_application_id_idx
  on public.board_votes(application_id);

comment on table public.board_votes is
  'One board vote on one Vendor Partner application. The DB is the source of truth; the Circle post is a display surface. board_size and threshold are snapshotted per vote so historical decisions re-tally under the rule in force at the time.';

comment on column public.board_votes.status is
  'lapsed is distinct from rejected: the deadline passed without the threshold being reached either way, so it rolls to the next board meeting rather than turning the applicant away.';


create table if not exists public.board_vote_ballots (
  id                  uuid primary key default gen_random_uuid(),
  vote_id             uuid not null references public.board_votes(id) on delete cascade,

  -- profiles.global_role = 'admin' is the director roster (exactly 9).
  -- super_admin accounts are CSC staff and do not vote.
  director_profile_id uuid not null references public.profiles(id),

  -- A recusal is recorded as an abstention. Note that under a fixed
  -- denominator an abstention is arithmetically identical to a No.
  choice              text not null check (choice in ('yes','no','abstain')),

  cast_at             timestamptz not null default now(),
  -- Set when a director changes their mind before the deadline. Changes are
  -- recorded silently -- Butler does not announce them in the Circle thread.
  changed_at          timestamptz,

  source              text not null default 'circle_button'
                      check (source in ('circle_button','admin_ui')),

  -- One ballot per director per vote; a change updates the row in place.
  unique (vote_id, director_profile_id)
);

create index if not exists board_vote_ballots_vote_id_idx
  on public.board_vote_ballots(vote_id);

comment on table public.board_vote_ballots is
  'One ballot per director per vote. Changing a vote updates the row and stamps changed_at rather than inserting a second ballot.';


alter table public.board_votes enable row level security;
alter table public.board_vote_ballots enable row level security;

-- All access is server-side: Butler's cron opens and tallies votes, and the
-- vote route records ballots only after resolving the director from their
-- session. No direct client access.
revoke all on public.board_votes from anon, authenticated;
revoke all on public.board_vote_ballots from anon, authenticated;
grant select, insert, update, delete on public.board_votes to service_role;
grant select, insert, update, delete on public.board_vote_ballots to service_role;
