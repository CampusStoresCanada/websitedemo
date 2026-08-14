-- Phase 4 Stage 0: backfill memberships from today's real organizations data.
-- Only orgs whose type maps to a configured program (Member -> member, Vendor Partner -> partner)
-- get a row; Non-Member/Staff/Supplier orgs correctly get none (they hold no real membership today).
-- One-time backfill: a no-op against an empty organizations table (fresh deploy).
insert into memberships (
  organization_id, program_key, status, status_changed_at,
  fte, is_cancoll_member, cancoll_tier, expires_at,
  grace_period_started_at, locked_at, canceled_at
)
select
  o.id,
  case o.type when 'Member' then 'member' when 'Vendor Partner' then 'partner' end,
  o.membership_status,
  o.membership_status_changed_at,
  o.fte,
  o.is_cancoll_member,
  o.cancoll_tier,
  o.membership_expires_at,
  o.grace_period_started_at,
  o.locked_at,
  o.canceled_at
from organizations o
where o.type in ('Member', 'Vendor Partner')
  and o.membership_status is not null;
