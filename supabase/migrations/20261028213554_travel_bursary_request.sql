-- The travel bursary becomes a request, not a registration of interest.
--
-- Steve, 2026-10-28: every member school may ask for hotel nights, travel, or
-- both, for one delegate "substantially in charge of the purchase of General
-- Merchandise for their institution". One request per school. Anyone
-- registered from the school, or its admin, may fill it in. Requests close at
-- the end of November 20, 2026.
--
-- Modelled on the benchmarking survey: one row per school per conference that
-- anyone entitled at the school can work on; who it is about is picked from
-- the school's contacts rather than typed; the login that submitted is
-- recorded; the deadline is an exclusive boundary instant.
--
-- Existing rows (the "Register your interest" sign-ups) keep everything they
-- have. A row with requested_at NULL is still only interest; the school
-- completes it with the same form.

alter table public.conference_bursary_applications
  add column if not exists covers_hotel boolean,
  add column if not exists covers_travel boolean,
  -- CSC pays in advance, or the school is reimbursed after (preferred).
  add column if not exists payment_preference text
    check (payment_preference in ('reimburse', 'prepay')),
  -- The submitter's confirmation that the delegate meets the GM-buyer rule.
  add column if not exists gm_buyer_confirmed boolean,
  -- Who the support is for, picked from the school's contacts.
  add column if not exists delegate_contact_id uuid references public.contacts(id) on delete set null,
  -- When the request was submitted, and by which login. NULL = interest only.
  add column if not exists requested_at timestamptz,
  add column if not exists requested_by_user_id uuid references auth.users(id) on delete set null;

-- One request per school per conference. The app has always enforced it; no
-- duplicates exist (checked 2026-10-28), so the database can too.
create unique index if not exists conference_bursary_applications_one_per_org
  on public.conference_bursary_applications (conference_id, organization_id);

-- Requests close at this instant (exclusive), same convention as
-- benchmarking_surveys.closes_at: 2026-11-21T08:00:00Z is the end of
-- November 20 in every Canadian zone.
alter table public.conference_instances
  add column if not exists bursary_request_closes_at timestamptz;

-- The Travel Bursary Terms as a conference legal document type. Restated in
-- full from the live constraint (checked 2026-10-28), plus the new type.
alter table public.conference_legal_versions
  drop constraint if exists conference_legal_versions_document_type_check;

alter table public.conference_legal_versions
  add constraint conference_legal_versions_document_type_check
  check (document_type in (
    'code_of_conduct',
    'member_code_of_conduct',
    'terms_and_conditions',
    'refund_policy',
    'privacy_notice',
    'exhibitor_agreement',
    'speaker_agreement',
    'cancoll_information_sharing',
    'travel_bursary_terms'
  ));
