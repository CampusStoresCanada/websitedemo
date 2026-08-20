-- Queue of ghost-authored announcements awaiting human review and release.
--
-- Helpful Ghost drafts; a person edits and approves; the cron publishes at a
-- pace the posting policy allows. Nothing reaches a member unreviewed, and
-- approving several at once does not dump several posts on the same day —
-- the release rate is what spaces them out.
--
-- See ~/.claude/plans/helpful-ghost-new-partner-announcements.md

create table if not exists public.ghost_announcements (
  id                uuid primary key default gen_random_uuid(),

  -- Which pipeline produced this. Per-pipeline daily caps key off it, and it
  -- leaves room for later kinds without a second table.
  kind              text not null default 'new_partner'
                    check (kind in ('new_partner')),

  organization_id   uuid not null references public.organizations(id) on delete cascade,

  -- draft     -- Helpful has written it, nobody has looked
  -- approved  -- a human okayed it; waiting for a release slot
  -- published -- live in Circle
  -- skipped   -- deliberately never announcing this one
  status            text not null default 'draft'
                    check (status in ('draft','approved','published','skipped')),

  title             text,
  -- Helpful's draft body, human-editable before approval.
  body_tiptap       jsonb,

  circle_space_id   bigint,
  circle_post_id    bigint,
  circle_post_url   text,

  -- Set when the member-facing announcement email goes out, so a re-run can
  -- never send it twice.
  email_campaign_id uuid,

  -- Why this one is being handled outside the pipeline. Required reading for
  -- anyone wondering where an announcement went.
  skip_reason       text,

  created_at        timestamptz not null default now(),
  approved_at       timestamptz,
  approved_by       uuid references public.profiles(id),
  published_at      timestamptz,
  updated_at        timestamptz not null default now(),

  -- One announcement per org per pipeline, ever. This is what makes the whole
  -- thing idempotent: the cron can re-scan membership_state_log on every tick
  -- without any risk of announcing the same partner twice.
  unique (kind, organization_id)
);

create index if not exists ghost_announcements_status_created_idx
  on public.ghost_announcements(status, created_at);

create index if not exists ghost_announcements_published_at_idx
  on public.ghost_announcements(published_at)
  where published_at is not null;

comment on table public.ghost_announcements is
  'Ghost-authored announcements pending human review and paced release. The unique (kind, organization_id) constraint is the idempotency guarantee — the cron re-scans its source every tick and relies on the insert conflicting.';

comment on column public.ghost_announcements.status is
  'skipped means deliberately never announcing — e.g. a partner being introduced by hand instead. Carries skip_reason.';

alter table public.ghost_announcements enable row level security;

-- All access is server-side: the cron drafts and publishes, the admin review
-- screen reads and updates through server actions. No direct client access.
revoke all on public.ghost_announcements from anon, authenticated;
grant select, insert, update, delete on public.ghost_announcements to service_role;

-- Added same-day: the editable prose paragraph. Reviewers edit this and the
-- title, never the markup — body_tiptap is regenerated from them on save, so
-- the structure can only ever contain node types Circle is verified to render.
alter table public.ghost_announcements
  add column if not exists summary_text text;

comment on column public.ghost_announcements.summary_text is
  'The editable prose paragraph. Reviewers edit this (and title), never the markup — body_tiptap is regenerated from them on every save, so the structure can only ever contain node types Circle is verified to render.';
