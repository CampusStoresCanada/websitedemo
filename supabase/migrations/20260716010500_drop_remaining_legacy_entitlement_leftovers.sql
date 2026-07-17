-- Missed in the first pass: conference_registrations.entitlement_status (same
-- dead passthrough as entitlement_type/conference_entitlement_id), and the
-- link_legacy_entitlement_seats() RPC, which has zero application callers
-- anywhere in the codebase.

alter table conference_registrations drop column if exists entitlement_status;
drop function if exists link_legacy_entitlement_seats(uuid);
drop function if exists link_legacy_entitlement_seats();
