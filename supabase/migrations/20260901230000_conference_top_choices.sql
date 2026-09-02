-- Top choices: "of the people who will be there, these are the ones we want to meet."
--
-- The counterpart to org_meeting_refusals. A refusal is a standing relationship
-- fact — it outlives any one conference and is reaffirmed annually. A top choice
-- is the opposite: you pick from WHO IS PRESENT THIS YEAR, so it is scoped to a
-- conference and expires with it.
--
-- ⛔ An expression of interest, NOT a guarantee. The ED: "Top 5 isn't a
-- guarantee, it is an expression of interest we should attempt to accommodate."
-- Nothing here promises a meeting; the scheduler weighs it and may not manage it.
--
-- Two-sided on purpose. A member picks vendors and a vendor picks stores, and a
-- MUTUAL choice is a far stronger signal than a one-way one — which the engine
-- can only see if both directions live in the same table. Hence declaring/chosen
-- rather than member/partner.
--
-- The rank is optional. Being in someone's five is the signal; ordering them is
-- a bonus we accept if offered and never require.

create table if not exists conference_top_choices (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references conference_instances(id) on delete cascade,

  declaring_org_id uuid not null references organizations(id) on delete cascade,
  chosen_org_id uuid not null references organizations(id) on delete cascade,

  -- Who actually said it. Same shape as org_meeting_refusals: the org holds the
  -- preference, a person is accountable for it.
  declared_by_contact_id uuid references contacts(id) on delete set null,

  -- 1..5 when they bothered to order them; null when it is just a set.
  rank smallint check (rank is null or (rank >= 1 and rank <= 5)),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One choice per pair per conference. Re-picking updates rather than stacking.
  constraint conference_top_choices_unique unique (conference_id, declaring_org_id, chosen_org_id),
  -- ⛔ Nobody chooses themselves.
  constraint conference_top_choices_not_self check (declaring_org_id <> chosen_org_id)
);

create index if not exists conference_top_choices_by_declaring
  on conference_top_choices (conference_id, declaring_org_id);

create index if not exists conference_top_choices_by_chosen
  on conference_top_choices (conference_id, chosen_org_id);

-- ⚠️ RLS enabled with no policies, exactly as org_meeting_refusals is: reads and
-- writes go through the admin client behind a server action that checks who is
-- asking. A session client sees zero rows and a null error, which would read as
-- "nobody chose anybody" rather than as a failure — so never read this with one.
alter table conference_top_choices enable row level security;

comment on table conference_top_choices is
  'Per-conference expressions of interest: who an org wants to meet, from those present. Not a guarantee. Counterpart to org_meeting_refusals, which is standing rather than per-conference.';
