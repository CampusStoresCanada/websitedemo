-- Every email we send, by address and time. Nothing else.
--
-- Why this exists: lib/onboarding/nudge-job.ts has always asked "when did this
-- person last hear from us" before nudging, and could only see two answers --
-- previous onboarding nudges, and campaign sends in message_deliveries. Every
-- other sender (elections, renewals, benchmarking, conference, Stripe receipts,
-- applications, tickets, logins) calls lib/email/send.ts directly and leaves no
-- trace, so roughly seventy send sites were invisible to that check. Five
-- different systems could, and did, mail the same person on the same day.
--
-- message_deliveries cannot hold these: campaign_id and recipient_id are both
-- NOT NULL, so recording a raw send there means inventing a campaign for it.
-- That is the rewrite-twenty-files option, and it is why this never got built.
-- One narrow log written at the single chokepoint makes every sender visible,
-- including senders nobody has written yet.
--
-- Deliberately NOT a copy of the email: no subject, no body, no recipient name.
-- This answers "how much have we contacted this person lately" and nothing
-- else, so it cannot drift into being a shadow mailbox.

create table if not exists public.email_log (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  sent_at timestamptz not null default now()
);

create index if not exists email_log_email_sent_at_idx
  on public.email_log (lower(email), sent_at desc);

create index if not exists email_log_sent_at_idx
  on public.email_log (sent_at desc);

alter table public.email_log enable row level security;

-- No policies on purpose: this is written and read by the service role only.
-- A session client that could read it could reconstruct who we contact and
-- when. lib/comms/contact-budget.ts is the only reader.
comment on table public.email_log is
  'Send-rate ledger: address and timestamp only. Written by lib/email/send.ts, read by lib/comms/contact-budget.ts.';
