-- Background drafting of board minutes from a Notion transcript.
--
-- The drafting call is a multi-minute model request on a full board transcript,
-- which is past what a serverless function should hold open — and a cron worker
-- would be the same function with the same ceiling. So the work is handed to
-- the Anthropic Batch API: the request is submitted, Anthropic holds it, and a
-- cron collects the result. Half price, and it cannot time out.
--
-- One row per meeting: the unique constraint IS the idempotency guarantee, the
-- same way ghost_announcements works. Pressing the button twice cannot queue
-- two jobs.
--
-- See docs/BOARD_MINUTES_DRAFT_FROM_TRANSCRIPT.md.

create table if not exists public.board_minutes_drafts (
  id            uuid primary key default gen_random_uuid(),

  meeting_id    uuid not null unique
                references public.board_meetings(id) on delete cascade,

  -- Anthropic's batch id. Null only in the brief window before submission.
  batch_id      text,

  -- submitted -- handed to Anthropic, waiting
  -- ready     -- data.json is stored and a human can load it
  -- failed    -- carries `error`; the reviewer can retry
  -- consumed  -- loaded into the editor; kept for audit rather than deleted
  status        text not null default 'submitted'
                check (status in ('submitted','ready','failed','consumed')),

  -- The model's data.json. Rendered to HTML on load rather than at collect
  -- time, so a change to the renderer applies to drafts already waiting.
  data_json     jsonb,

  error         text,

  requested_by  uuid references public.profiles(id),

  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  consumed_at   timestamptz
);

create index if not exists board_minutes_drafts_status_idx
  on public.board_minutes_drafts(status, created_at);

comment on table public.board_minutes_drafts is
  'Batch-API drafting jobs for board minutes. One per meeting — the unique meeting_id is what makes the submit idempotent.';

comment on column public.board_minutes_drafts.data_json is
  'The model output, unrendered. HTML is produced at load time so renderer changes reach drafts that are already waiting.';

alter table public.board_minutes_drafts enable row level security;

-- Server-side only: the admin screen reads through server actions, the cron
-- writes with the service role. No direct client access.
revoke all on public.board_minutes_drafts from anon, authenticated;
grant select, insert, update, delete on public.board_minutes_drafts to service_role;
