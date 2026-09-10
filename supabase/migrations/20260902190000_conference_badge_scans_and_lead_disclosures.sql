-- Badge scans, and the consent gate that governs disclosing a member's details.
--
-- Two tables on purpose. `conference_badge_scans` records THE ACT: A scanned B,
-- at this time. Nothing about why. A member scanning anyone, and a vendor
-- scanning a member, produce identical rows here.
--
-- `conference_lead_disclosures` is the separate thing that only exists when the
-- scan would send a member's contact details to a third party's CRM. That is a
-- consent lifecycle with its own grain — pending until the member decides — and
-- it must not be inferred later from the scan row, because "did this person
-- agree" is a fact, not an interpretation of one.

create table if not exists conference_badge_scans (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references conference_instances(id) on delete cascade,
  scanned_person_id uuid not null references conference_people(id) on delete cascade,
  scanner_user_id uuid not null references profiles(id),
  scanner_contact_id uuid references contacts(id),
  scanner_organization_id uuid references organizations(id),
  -- Which printed code was used. Kept so scans stay attributable after the
  -- token is revoked and reissued.
  badge_token_id uuid references conference_badge_tokens(id),
  scanned_at timestamptz not null default now()
);

create index if not exists conference_badge_scans_conference_idx
  on conference_badge_scans (conference_id, scanned_at desc);
create index if not exists conference_badge_scans_scanned_idx
  on conference_badge_scans (scanned_person_id);
create index if not exists conference_badge_scans_scanner_idx
  on conference_badge_scans (scanner_user_id);

create table if not exists conference_lead_disclosures (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null unique references conference_badge_scans(id) on delete cascade,
  conference_id uuid not null references conference_instances(id) on delete cascade,
  member_person_id uuid not null references conference_people(id) on delete cascade,
  vendor_organization_id uuid not null references organizations(id),
  status text not null default 'pending'
    check (status in ('pending', 'released', 'declined')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references profiles(id)
);

create index if not exists conference_lead_disclosures_member_idx
  on conference_lead_disclosures (member_person_id, status);
create index if not exists conference_lead_disclosures_vendor_idx
  on conference_lead_disclosures (vendor_organization_id, status);

-- RLS on with no permissive policy: every read and write goes through server
-- code holding the service role. A GRANT without a policy returns zero rows and
-- reports success, so nothing here is reachable from a session client by
-- accident.
alter table conference_badge_scans enable row level security;
alter table conference_lead_disclosures enable row level security;
