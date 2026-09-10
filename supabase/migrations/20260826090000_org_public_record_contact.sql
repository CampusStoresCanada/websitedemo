-- The public-record contact slot.
--
-- `organizations.email` and `.phone` were collected as "how do we reach you",
-- and that is what people gave us: a named individual's address. Measured
-- 2026-08-26 — 42 of 50 member org emails and ALL 60 partner org emails match
-- a contact row for a specific person; only 8 of 110 look like a shared inbox.
-- Phone is the same, 93 of 101.
--
-- So those columns cannot be published. Printing one as a "company contact"
-- would put a named person into a book they never agreed to appear in, routing
-- around the per-person consent gate through a different column.
--
-- This timestamp is the affirmation that a value in that slot is meant as a
-- PUBLIC RECORD — an address the organisation is content to see printed and
-- read by anyone. It is deliberately NOT backfilled: every existing value
-- predates the promise, so nothing is publishable until someone says so
-- knowing what they are saying.
--
-- NULL means "never affirmed", exactly as contacts.directory_visibility does
-- for a person. Absence of an objection is not consent.
alter table organizations
  add column if not exists public_contact_confirmed_at timestamptz;

comment on column organizations.public_contact_confirmed_at is
  'When an org admin affirmed that email/phone are a PUBLIC RECORD contact, fit '
  'to print and publish. NULL = never affirmed; the values predate the promise '
  'and must not be published. Never backfill this.';

comment on column organizations.email is
  'Public-record contact address — publishable ONLY when '
  'public_contact_confirmed_at is set. Historically collected as "how do we '
  'reach you" and is a named person''s address in most rows.';
