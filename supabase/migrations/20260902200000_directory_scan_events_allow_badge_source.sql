-- An exhibitor's badge front carries the same public code the printed directory
-- does, so scanning it lands on the same public listing page. That is a third
-- provenance alongside the book and a shared link, and distinguishing it is the
-- whole point of the column: "did the book earn its place" is a different
-- question from "did people scan each other at the show".
alter table directory_scan_events
  drop constraint directory_scan_events_source_check;

alter table directory_scan_events
  add constraint directory_scan_events_source_check
  check (source = any (array['print'::text, 'link'::text, 'badge'::text]));
