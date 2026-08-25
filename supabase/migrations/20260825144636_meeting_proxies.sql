-- Proxies for member meetings.
--
-- By-Law No. 1 Part VII Section 7 (approved 2014-01-30), which implements
-- s.171(1) of the Canada Not-for-profit Corporations Act:
--
--   "a member entitled to vote at a member meeting may vote by proxy by
--    appointing in writing a proxyholder, who must be an employee of the
--    member store or a primary store contact of another member store, to
--    attend and act at the meeting in the manner and to the extent
--    authorized by the proxy"
--
--   a) in writing on the form provided by the Corporation, or a facsimile
--   b) members eligible to vote get the form 30 days before the meeting
--   c) signed by the member, valid ONLY for the meeting it was given for
--      (or an adjournment of it)
--
-- Deliberately attached to the MEETING, not to an election. Part VII governs
-- member meetings generally: a proxy carries the member's vote on every
-- question put to that meeting, of which the board election is only one. Keying
-- this to `elections` would have to be torn up the first time there is a special
-- resolution, an amendment to the articles, or any other business.
--
-- Quorum (Part VII S6) is 33% of voting members "present in person or by
-- proxy". This table supplies the by-proxy half. There is deliberately no
-- attendance concept yet, so quorum is still declared by the ED at the meeting
-- rather than computed.

create table if not exists public.meeting_proxies (
  id uuid primary key default gen_random_uuid(),

  -- The meeting this proxy is good for. S7(c): one meeting only. The FK is the
  -- enforcement — a proxy physically cannot carry to the next AGM.
  meeting_id uuid not null references public.board_meetings(id) on delete cascade,

  -- Whose vote is being carried. The member store, not a person: one ballot per
  -- store is the rule everywhere else in governance, and it is the store that is
  -- "the member entitled to vote".
  grantor_organization_id uuid not null references public.organizations(id) on delete cascade,

  -- S7(c) "must be signed by the member" — the human who actually signed.
  grantor_contact_id uuid references public.contacts(id) on delete set null,

  -- Who will act at the meeting. Eligibility (employee of the grantor store, or
  -- primary contact of a DIFFERENT member store) is checked in application code
  -- against live contact/org state; it is not expressible as a row constraint
  -- because it depends on organizations.type and contacts.is_primary at the time
  -- of appointment.
  proxyholder_contact_id uuid not null references public.contacts(id) on delete restrict,

  -- How the appointment arrived. S7(a) allows "the form provided by the
  -- Corporation, or a facsimile thereof", so a scanned paper form is as valid as
  -- one completed online and must be recordable.
  form_source text not null default 'online'
    check (form_source in ('online', 'paper', 'facsimile')),

  -- Storage path of the signed form when one exists. Required in practice for
  -- paper/facsimile; an online appointment is evidenced by signed_at + the
  -- authenticated actor in the audit columns.
  document_path text,

  signed_at timestamptz not null default now(),
  created_by uuid,

  -- Revocation. The by-law is silent, so the common-law default applies: a proxy
  -- is revocable by the member until it is exercised. Soft, because the register
  -- has to show that an appointment existed and was withdrawn.
  revoked_at timestamptz,
  revoked_by uuid,
  revocation_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A store cannot appoint two people to carry the same vote at the same
  -- meeting. Revoked rows are excluded so a store can re-appoint after
  -- withdrawing.
  constraint meeting_proxies_no_self_appointment
    check (grantor_contact_id is null or grantor_contact_id <> proxyholder_contact_id)
);

create unique index if not exists meeting_proxies_one_live_per_store
  on public.meeting_proxies (meeting_id, grantor_organization_id)
  where revoked_at is null;

create index if not exists meeting_proxies_meeting_idx
  on public.meeting_proxies (meeting_id);

create index if not exists meeting_proxies_proxyholder_idx
  on public.meeting_proxies (proxyholder_contact_id)
  where revoked_at is null;

comment on table public.meeting_proxies is
  'By-Law Part VII S7 proxies. One live proxy per member store per meeting; '
  'valid only for the meeting named by meeting_id.';

alter table public.meeting_proxies enable row level security;

revoke select, insert, update, delete on public.meeting_proxies from anon, authenticated;

grant select, insert, update, delete on public.meeting_proxies to service_role;
