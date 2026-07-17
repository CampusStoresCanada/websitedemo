-- The entitlement-assignment mechanism (conference_order_items -> a named
-- person, via assignConferenceEntitlement) was built for an earlier
-- registration architecture and never actually used: zero conference_people
-- rows exist with source_type='entitlement', and conference_registrations
-- (which would seed it) has zero rows total. The v3 catalog's own seat
-- mechanism (entity_balance_seats.holder_person_id -> conference_people) is
-- the real forward path. Removing the dead columns/table/constraint value.

alter table conference_people drop column if exists entitlement_type;
alter table conference_people drop column if exists conference_entitlement_id;
alter table conference_people drop column if exists entitlement_status;

alter table conference_registrations drop column if exists entitlement_type;
alter table conference_registrations drop column if exists conference_entitlement_id;

alter table conference_people drop constraint if exists conference_people_source_type_check;
alter table conference_people add constraint conference_people_source_type_check
  check (source_type = any (array['registration'::text, 'staff'::text, 'manual'::text]));

drop table if exists conference_entitlement_assignment_events;
