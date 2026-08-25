-- `events` has been a valid CalendarCategory in TypeScript since the events
-- source was added, but the CHECK constraint was never widened to match. Every
-- upsert chunk carrying an event row violated the constraint and was rejected
-- whole — silently, because the aggregation never inspected the upsert result.
--
-- Effect: 55 published events, 0 of them on the admin calendar, and any
-- projected row that happened to share a 50-row chunk with one went down too.
alter table calendar_items drop constraint if exists calendar_items_category_check;

alter table calendar_items add constraint calendar_items_category_check
  check (category = any (array[
    'conference', 'renewals_billing', 'legal_retention',
    'communications', 'integrations_ops', 'membership', 'events'
  ]));
