-- Badge scan rules belong to a CONFERENCE, not to the platform.
--
-- These briefly lived in `policy_values`, which was wrong twice over: those are
-- global, so one conference's organisation vocabulary would have rewritten
-- every other conference's consent gate; and they are a governed
-- draft/validate/publish flow, which is the wrong weight for an operator
-- assigning "Sponsor" to a column while building a badge.
--
-- Shape:
--   disclosingOrgTypes        string[]  scans BY these capture leads
--   attendeeOrgTypes          string[]  people at these ARE the attendees
--   unlistedOrgTypeDiscloses  boolean   on neither list: ask, or stay internal?
--   onsiteDayIds              string[]  days chosen for the printed schedule
--   unlistedDayMode           text      derive | include | exclude
--
-- Null means nothing has been configured, which is NOT the same as configured
-- empty — see normalizeBadgeScanRules, where null takes conservative defaults
-- and an explicit empty list is respected as an answer.
alter table conference_instances
  add column if not exists badge_scan_rules jsonb;
