-- Big Ideas Day: topics anyone proposes, members choose between.
--
-- One object, not two. A member proposing a table conversation and a partner
-- proposing a presentation produce the same artifact — a chip in the voting
-- area, under the same rules (Steve, 2026-10-06: "we run their chips in
-- parallel with the member ones in the voting area. Same rules"). What differs
-- is the submitter and whether money was attached: a partner buys Big Ideas
-- Presentations ($250, refunded if not selected) before they can put a chip in;
-- a member pays nothing.
--
-- ⛔ NOT folded into conference_bursary_applications despite the near-identical
-- columns. Same shape is not the same verb — "apply for a travel bursary" and
-- "propose a topic" are different things, and merging them would make every
-- reader filter by a kind that exists only because two tables looked alike.

create table if not exists conference_topics (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references conference_instances(id) on delete cascade,
  -- Who proposed it. Always an org: proposing requires signing in, and a
  -- partner's chip is paid for by their organisation.
  organization_id uuid not null references organizations(id) on delete cascade,
  submitted_by_user_id uuid,
  title text not null,
  body text,
  -- proposed -> scheduled (it got a table or a slot) | declined | withdrawn.
  -- Staff decide, informed by the votes but not bound to them: "We aren't
  -- picking just on votes, and we might combine topics."
  status text not null default 'proposed'
    check (status in ('proposed', 'scheduled', 'declined', 'withdrawn')),
  -- The $250 deposit, for a partner's chip. Null for members, who pay nothing.
  -- Kept as the purchase id rather than a boolean so the refund has something
  -- to point at in December.
  deposit_purchase_id uuid references entity_purchases(id) on delete set null,
  -- Set when staff place it: "we give them a table number and time on Thursday".
  table_label text,
  scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conference_topics_conference_idx
  on conference_topics (conference_id, status);
create index if not exists conference_topics_org_idx
  on conference_topics (organization_id);

comment on table conference_topics is
  'Topics proposed for Big Ideas Day — by members free, by partners with a $250 '
  'deposit (deposit_purchase_id). Members vote between them; staff place them.';

-- ─────────────────────────────────────────────────────────────────
-- Voting: a ballot is the ACT, selections are the choices.
-- ─────────────────────────────────────────────────────────────────
--
-- ⛔ Two tables, because "none of these" has to be recordable. Steve: "Choose
-- all the topics that appeal to you, or none." A member who reviewed every
-- topic and wanted none of them is telling us something, and a single votes
-- table cannot distinguish that from a member who never opened the page. A
-- ballot with zero selections says it out loud.
--
-- The shape deliberately mirrors election_ballots / election_ballot_selections,
-- which is the voting metaphor this codebase already has — but these are their
-- own tables: elections are sealed, token-authenticated and auditable because
-- they are governance, and none of that applies to picking table topics.
--
-- MEMBERS ONLY. Partners may propose a topic but may not vote on which ones
-- run — they are the ones being chosen between.

create table if not exists conference_topic_ballots (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references conference_instances(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null,
  submitted_at timestamptz not null default now(),
  -- One ballot per person per conference. Re-voting updates the selections
  -- underneath rather than stacking ballots.
  unique (conference_id, user_id)
);

create table if not exists conference_topic_ballot_selections (
  ballot_id uuid not null references conference_topic_ballots(id) on delete cascade,
  topic_id uuid not null references conference_topics(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (ballot_id, topic_id)
);

create index if not exists conference_topic_ballot_selections_topic_idx
  on conference_topic_ballot_selections (topic_id);

comment on table conference_topic_ballots is
  'One per member per conference. ZERO selections is a real answer — "none of '
  'these" — and is why this is separate from the selections table.';
