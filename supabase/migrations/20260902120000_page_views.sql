-- Where signed-in people go on the site.
--
-- The one behavioural signal the platform does not capture at all. Everything
-- else — posts, replies, RSVPs, registrations — is a deliberate act someone
-- chose to publish. This is the quiet half: what a person looked at, how long
-- they kept looking, what they went back to. A member who opens the same
-- partner's page four times has told us something no form ever will.
--
-- ⛔ NOT available from Google Analytics or Vercel Analytics. Those are
-- anonymous and aggregated BY DESIGN, not by configuration: they can say a page
-- got forty views and can never say which forty people. The identity is the
-- entire value here, and it is the exact thing they strip. Sending signed-in
-- member behaviour to a third party is also not something an association should
-- do with its members' data.
--
-- ⚠️ Signed-in traffic only. An anonymous visitor has no person to attach to,
-- so nothing is written and the public site is untouched.

create table if not exists public.page_views (
  id uuid primary key default gen_random_uuid(),

  -- ⛔ The person, not the login. `contacts` is per (person, org) and one login
  -- can hold several rows, so the org is stored alongside rather than derived
  -- later from a contact that may not be the one that was acting.
  contact_id uuid not null references public.contacts (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete set null,

  -- The path only. Never the full URL, never a query string wholesale —
  -- see `lib/signals/page-view.ts`, which decides what is worth keeping and
  -- drops the rest before this table ever sees it.
  path text not null,
  -- One allow-listed, meaning-bearing parameter (a category filter, a search
  -- term). Null when the request carried nothing worth keeping.
  facet text,

  -- Where they came from, INSIDE the site. A journey is more informative than a
  -- destination: arriving at a partner from a category listing is a different
  -- act from arriving at it from a link in a post.
  referrer_path text,

  occurred_at timestamptz not null default now()
);

-- The read this table exists for: everything one person did, newest first.
create index if not exists page_views_contact_idx
  on public.page_views (contact_id, occurred_at desc);

-- The other read: who has been looking at a given thing.
create index if not exists page_views_path_idx
  on public.page_views (path, occurred_at desc);

-- ⛔ RLS on with NO policy — service-role only, the same shape as the signal
-- spine. This is behavioural data about named individuals; nothing reaches it
-- through a session client, and there is deliberately no policy to widen. A
-- GRANT without a policy returns zero rows and no error, which is the intended
-- outcome for anyone who reaches for it from the wrong client.
alter table public.page_views enable row level security;

comment on table public.page_views is
  'Signed-in page views. Service-role only. Feeds the match embedding space; admin paths are never recorded.';
