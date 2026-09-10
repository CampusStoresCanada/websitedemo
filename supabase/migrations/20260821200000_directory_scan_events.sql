-- Did anyone actually use the printed QR codes?
--
-- A printed directory is otherwise unmeasurable: you find out whether it was
-- worth the money by asking people at the next conference. A scan is the one
-- honest signal a listing did something, and that is worth knowing before
-- committing to another print run.
--
-- Not `activities`: that table requires person_id NOT NULL — it is a
-- per-person engagement log fed by Circle. These scans are anonymous hits on a
-- public page, so forcing them into it would mean inventing a person for every
-- scan, or not recording the anonymous ones at all.
--
-- ── What is deliberately NOT stored ────────────────────────────────────────
-- No IP address, no raw user-agent, no user id — even when the scanner is
-- signed in and we could. The question is "does this get used", and counts
-- answer it. Logging which named member looked at which supplier builds a
-- surveillance trail out of a public page that nobody asked for and that would
-- be hard to justify to the person scanning. If per-member lead data is ever
-- genuinely wanted, that is a deliberate product decision with its own privacy
-- notice — not a column quietly added here.

create table if not exists public.directory_scan_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Denormalised on purpose: a code must remain attributable in the log even if
  -- the org is later renamed or its code is (wrongly) changed.
  public_code text not null,
  -- 'print' comes from the ?s=p the printed QR encodes; anything else is a
  -- shared link. That distinction is the whole question when judging the paper.
  source text not null default 'link' check (source in ('print', 'link')),
  device text not null default 'unknown' check (device in ('mobile', 'desktop', 'unknown')),
  occurred_at timestamptz not null default now()
);

create index if not exists directory_scan_events_org_idx
  on public.directory_scan_events (organization_id, occurred_at desc);

alter table public.directory_scan_events enable row level security;

comment on table public.directory_scan_events is
  'Anonymous scan/visit counts for /e/<code> printed QR codes. No IP, user-agent or user id by design.';
