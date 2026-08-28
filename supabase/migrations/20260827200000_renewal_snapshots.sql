-- Renewal standing, frozen to a board meeting.
--
-- The Renewals tab has been live-computed since it shipped, which is right for
-- the meeting that is happening and wrong for every meeting afterwards. A
-- figure cited in the October minutes has to still reproduce in two years, and
-- a live query cannot promise that — by December the cycle has moved and the
-- number in the minutes matches nothing on the page.
--
-- Deliberately a sibling of board_qbo_snapshots rather than a row in it. That
-- table has the right shape and the wrong readers: getMeetingFinancialReport()
-- at lib/quickbooks/reports.ts:659 selects the newest snapshot for a meeting
-- with NO report_type filter, so a renewal row there would surface as the
-- financial report. Sharing the table would have meant renaming it and fixing
-- that query; the freeze semantics are copied instead, which is the part worth
-- reusing.
--
-- ⚠️ That unfiltered query is already latent without us: a meeting carrying
-- both a 'pl' and a 'balance_sheet' row hits the same path today.

create table if not exists public.renewal_snapshots (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references public.board_meetings(id) on delete cascade,
  -- Cycle-start year PLUS ONE, matching renewal_events.renewal_year,
  -- lib/renewal/season.ts and resolveBoardRenewalWindow().
  renewal_year integer not null,
  -- The whole BoardRenewalReport as returned at pull time, named orgs and all.
  -- Stored rather than recomputed on purpose: the population itself moves as
  -- organizations are archived or cancelled, so even a correct recomputation
  -- against a past cycle would not reproduce the figure the board saw.
  data_json    jsonb not null,
  pulled_at    timestamptz not null default now(),
  pulled_by    uuid references public.profiles(id) on delete set null,
  -- Set when a human has accepted this as the figure of record for the meeting.
  -- Until then a re-pull may replace it; see the upsert in lib/renewal/snapshot.ts.
  approved_by  uuid references public.profiles(id) on delete set null,
  approved_at  timestamptz,
  -- One snapshot per meeting. Re-pulling before approval replaces it rather
  -- than accumulating drafts nobody can tell apart.
  unique (meeting_id)
);

create index if not exists renewal_snapshots_year_idx
  on public.renewal_snapshots(renewal_year, pulled_at desc);

comment on table public.renewal_snapshots is
  'Renewal standing frozen to a board meeting, so a figure cited in the minutes still reproduces after the cycle has moved on. Mirrors the board_qbo_snapshots freeze pattern; kept separate because that table has a reader that ignores report_type.';

alter table public.renewal_snapshots enable row level security;

-- Server-side only, matching renewal_assignments and board_votes. A grant to
-- `authenticated` without a matching policy returns zero rows with a null
-- error — a write that reports success and does nothing — so it is withheld.
revoke all on public.renewal_snapshots from anon, authenticated;
grant select, insert, update, delete on public.renewal_snapshots to service_role;
