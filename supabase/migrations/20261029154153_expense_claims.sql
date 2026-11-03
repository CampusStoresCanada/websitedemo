-- Expense claims: a general module for "someone spent money, CSC pays it back".
--
-- The travel bursary is its first PROGRAM, not its shape. Everything that is
-- bursary-specific lives in data (expense_programs + expense_program_categories):
-- which slots exist, what each is capped at, the mileage rate, the claim
-- window, how many approvers. A second use (board travel, committee expenses)
-- is a new program row, not new code.
--
-- Flow:
--   1. A claim is opened against a program, for a payee organization, and
--      optionally tied to the record that entitled it (source_table/source_id,
--      e.g. the school's conference_bursary_applications row).
--   2. The claimant fills one line per category (slot) and attaches receipts,
--      which upload straight to the private `expense-receipts` bucket.
--   3. Submitted → approvers (admin / super_admin) approve one at a time through
--      approve_expense_claim(). When approvals reach the program's
--      approvals_required, the claim becomes `approved` and a row lands in
--      qbo_expense_bill_queue in the SAME transaction, so no approved claim
--      can miss QuickBooks.
--   4. The worker posts a QuickBooks Bill (a payable) and the claim becomes
--      `posted`. Paying the bill (cheque or otherwise) happens in QuickBooks.
--
-- An approver may never be the submitter, nor linked to the payee organization.
-- That rule is enforced here, not only in the UI, because the second approval
-- is what releases money.

-- ─────────────────────────────────────────────────────────────────
-- Programs and their categories (the configuration)
-- ─────────────────────────────────────────────────────────────────

create table public.expense_programs (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text not null unique,
  name                   text not null,
  description            text,
  -- Optional scope. A conference program reads the conference; others leave it null.
  conference_id          uuid references public.conference_instances(id),
  -- The claim window. closes_at is EXCLUSIVE, the same convention as
  -- benchmarking_surveys.closes_at and bursary_request_closes_at.
  opens_at               timestamptz,
  closes_at              timestamptz,
  approvals_required     integer not null default 2 check (approvals_required >= 1),
  -- Who a claim may be paid to: the organization, the claimant personally,
  -- or someone else the claimant names.
  payee_types            text[] not null default array['organization', 'claimant', 'other']
                           check (payee_types <@ array['organization', 'claimant', 'other']
                                  and cardinality(payee_types) >= 1),
  -- QuickBooks: where the payable is expensed, and the tax code on its lines.
  -- Null means the worker refuses to post (a configuration failure, alerted).
  qbo_expense_account_id text,
  qbo_tax_code_id        text,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create table public.expense_program_categories (
  id                uuid primary key default gen_random_uuid(),
  program_id        uuid not null references public.expense_programs(id) on delete cascade,
  key               text not null,
  label             text not null,
  help              text,
  -- 'amount': the claimant enters what they paid, before tax, and the tax.
  -- 'distance': the claimant enters kilometres; the amount is km × rate.
  measure           text not null default 'amount' check (measure in ('amount', 'distance')),
  -- Cap on what this slot can claim, tax included. Null = no cap.
  cap_cents         integer check (cap_cents is null or cap_cents >= 0),
  rate_cents_per_km numeric(8, 2) check (rate_cents_per_km is null or rate_cents_per_km > 0),
  requires_receipt  boolean not null default true,
  -- Categories sharing a choice_group are alternatives: a claim fills at most
  -- one of them (airfare OR mileage).
  choice_group      text,
  sort              integer not null default 0,
  unique (program_id, key),
  check (measure <> 'distance' or rate_cents_per_km is not null)
);

-- ─────────────────────────────────────────────────────────────────
-- Claims, lines, receipts, approvals (the records)
-- ─────────────────────────────────────────────────────────────────

create table public.expense_claims (
  id                    uuid primary key default gen_random_uuid(),
  program_id            uuid not null references public.expense_programs(id),
  organization_id       uuid not null references public.organizations(id),
  -- Who the expenses were incurred by, when that is a known person.
  claimant_contact_id   uuid references public.contacts(id),
  -- The record that entitled this claim, if any. Generic on purpose.
  source_table          text,
  source_id             uuid,
  status                text not null default 'draft'
                          check (status in ('draft', 'submitted', 'returned', 'rejected', 'approved', 'posted')),
  -- Who CSC pays, as the claimant declared it, and where the payment goes.
  -- Gathered for every payee type, the organization included: the address a
  -- cheque goes to is the claimant's to state, not ours to assume.
  payee_type            text check (payee_type in ('organization', 'claimant', 'other')),
  payee_name            text,
  payee_email           text,
  payee_phone           text,
  payee_address_line1   text,
  payee_address_line2   text,
  payee_city            text,
  payee_province        text,
  payee_postal_code     text,
  payee_country         text default 'Canada',
  -- The QuickBooks Vendor the Bill was posted to. For an organization payee
  -- this mirrors organizations.quickbooks_vendor_id; a person gets their own.
  qbo_vendor_id         text,
  created_by_user_id    uuid references public.profiles(id),
  submitted_at          timestamptz,
  submitted_by_user_id  uuid references public.profiles(id),
  -- Sent back for correction (editable again) or refused outright. The note is
  -- what the approver wrote, shown to the claimant.
  decision_note         text,
  decided_by_user_id    uuid references public.profiles(id),
  decided_at            timestamptz,
  approved_at           timestamptz,
  qbo_bill_id           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check ((source_table is null) = (source_id is null))
);

-- One claim per entitling record (one per school's bursary request).
create unique index expense_claims_one_per_source
  on public.expense_claims (program_id, source_table, source_id)
  where source_id is not null;

create index expense_claims_status on public.expense_claims (program_id, status);

create table public.expense_claim_lines (
  id            uuid primary key default gen_random_uuid(),
  claim_id      uuid not null references public.expense_claims(id) on delete cascade,
  category_key  text not null,
  -- Before tax. For a 'distance' category this is km × rate, computed by the app.
  amount_cents  integer not null default 0 check (amount_cents >= 0),
  tax_cents     integer not null default 0 check (tax_cents >= 0),
  distance_km   numeric(8, 1) check (distance_km is null or distance_km >= 0),
  description   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- One slot per category.
  unique (claim_id, category_key)
);

create table public.expense_claim_receipts (
  id                  uuid primary key default gen_random_uuid(),
  line_id             uuid not null references public.expense_claim_lines(id) on delete cascade,
  storage_path        text not null unique,
  file_name           text not null,
  content_type        text not null,
  size_bytes          integer,
  uploaded_by_user_id uuid references public.profiles(id),
  created_at          timestamptz not null default now()
);

create table public.expense_claim_approvals (
  id               uuid primary key default gen_random_uuid(),
  claim_id         uuid not null references public.expense_claims(id) on delete cascade,
  approver_user_id uuid not null references public.profiles(id),
  approved_at      timestamptz not null default now(),
  unique (claim_id, approver_user_id)
);

-- ─────────────────────────────────────────────────────────────────
-- QuickBooks: the payable
-- ─────────────────────────────────────────────────────────────────

-- QuickBooks will not let a Vendor share a name with a Customer, and every
-- school is already a Customer, so the vendor is its own record.
alter table public.organizations add column quickbooks_vendor_id text;

-- Same row shape as the five existing worker queues (see lib/quickbooks/queue.ts).
create table public.qbo_expense_bill_queue (
  id                uuid primary key default gen_random_uuid(),
  expense_claim_id  uuid not null unique references public.expense_claims(id),
  status            text not null default 'pending'
                      check (status in ('pending', 'processing', 'completed', 'failed', 'retrying', 'skipped')),
  retry_count       integer not null default 0,
  max_retries       integer not null default 3,
  next_retry_at     timestamptz,
  lease_expires_at  timestamptz,
  qbo_bill_id       text,
  error_message     text,
  processed_at      timestamptz,
  created_at        timestamptz not null default now()
);

create index idx_qbo_expense_bill_queue_claimable
  on public.qbo_expense_bill_queue (status, next_retry_at);

-- ─────────────────────────────────────────────────────────────────
-- Approval: one function, so the rules and the hand-off are atomic
-- ─────────────────────────────────────────────────────────────────

create or replace function public.approve_expense_claim(p_claim_id uuid, p_approver uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim    public.expense_claims;
  v_required integer;
  v_count    integer;
begin
  select * into v_claim from public.expense_claims where id = p_claim_id for update;
  if not found then
    raise exception 'EXPENSE_CLAIM_NOT_FOUND';
  end if;
  if v_claim.status <> 'submitted' then
    raise exception 'EXPENSE_CLAIM_NOT_SUBMITTED';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_approver and global_role in ('admin', 'super_admin')
  ) then
    raise exception 'APPROVER_NOT_ADMIN';
  end if;

  if p_approver = v_claim.submitted_by_user_id or p_approver = v_claim.created_by_user_id then
    raise exception 'APPROVER_IS_CLAIMANT';
  end if;

  -- Any link to the payee organization, current or not, disqualifies.
  if exists (
    select 1 from public.user_organizations
    where user_id = p_approver and organization_id = v_claim.organization_id
  ) then
    raise exception 'APPROVER_LINKED_TO_PAYEE';
  end if;

  insert into public.expense_claim_approvals (claim_id, approver_user_id)
  values (p_claim_id, p_approver)
  on conflict (claim_id, approver_user_id) do nothing;
  if not found then
    raise exception 'APPROVER_ALREADY_APPROVED';
  end if;

  select approvals_required into v_required from public.expense_programs where id = v_claim.program_id;
  select count(*) into v_count from public.expense_claim_approvals where claim_id = p_claim_id;

  if v_count >= v_required then
    update public.expense_claims
      set status = 'approved', approved_at = now(), updated_at = now()
      where id = p_claim_id;
    insert into public.qbo_expense_bill_queue (expense_claim_id)
      values (p_claim_id)
      on conflict (expense_claim_id) do nothing;
    return 'approved';
  end if;

  return 'pending';
end;
$$;

revoke all on function public.approve_expense_claim(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_expense_claim(uuid, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────
-- Access: every read and write goes through server code on the service role.
-- No grants to anon/authenticated and no policies: a session-client query
-- fails loudly instead of matching zero rows (see db-access-baseline.ts).
-- ─────────────────────────────────────────────────────────────────

revoke all on public.expense_programs, public.expense_program_categories, public.expense_claims,
  public.expense_claim_lines, public.expense_claim_receipts, public.expense_claim_approvals,
  public.qbo_expense_bill_queue
  from anon, authenticated;

alter table public.expense_programs           enable row level security;
alter table public.expense_program_categories enable row level security;
alter table public.expense_claims             enable row level security;
alter table public.expense_claim_lines        enable row level security;
alter table public.expense_claim_receipts     enable row level security;
alter table public.expense_claim_approvals    enable row level security;
alter table public.qbo_expense_bill_queue     enable row level security;

-- ─────────────────────────────────────────────────────────────────
-- Receipts bucket: private, written only through signed upload URLs.
-- ─────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-receipts', 'expense-receipts', false, 20 * 1024 * 1024,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']
)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────
-- The first program: the CSC 2027 travel bursary (Steve, 2026-10-29).
-- Hotel up to $665 (four nights, per the agreement), and EITHER economy airfare
-- (no cap) OR mileage at $0.73/km. Two approvers. Claims open when the
-- conference ends and close at the end of the 30th day after it.
-- ─────────────────────────────────────────────────────────────────

with program as (
  insert into public.expense_programs
    (slug, name, description, conference_id, opens_at, closes_at, approvals_required)
  select
    'travel-bursary-2027',
    'Travel Bursary 2027',
    'Hotel and travel for one delegate per member institution, CSC 2027.',
    ci.id,
    '2027-02-04T12:00:00Z',
    -- End of March 6 in every Canadian zone: 30 days after the conference ends.
    '2027-03-07T08:00:00Z',
    2
  from public.conference_instances ci
  where ci.name = 'Campus Stores Conference 2027'
  returning id
)
insert into public.expense_program_categories
  (program_id, key, label, help, measure, cap_cents, rate_cents_per_km, requires_receipt, choice_group, sort)
select program.id, c.key, c.label, c.help, c.measure, c.cap_cents, c.rate, c.receipt, c.grp, c.sort
from program, (values
  ('hotel', 'Hotel', 'CSC covers up to four hotel nights as part of our agreement, to a maximum of $665 including tax.',
     'amount', 66500, null::numeric, true, null, 1),
  ('airfare', 'Airfare', 'Economy airfare and one checked bag.',
     'amount', null, null::numeric, true, 'travel', 2),
  ('mileage', 'Mileage', 'One round trip, at $0.73 per kilometre.',
     'distance', null, 73::numeric, false, 'travel', 3)
) as c(key, label, help, measure, cap_cents, rate, receipt, grp, sort);
