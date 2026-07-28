-- Insert 'announced' between 'draft' and 'registration_open' so conferences
-- can be publicly informational (dates, description, homepage presence)
-- before anything is actually on sale. See lib/constants/conference.ts for
-- the transition graph and the VISIBLE_CONFERENCE_STATUSES / SALES_OPEN_STATUSES
-- split that reads this.

alter table public.conference_instances drop constraint conference_instances_status_check;

alter table public.conference_instances add constraint conference_instances_status_check
  check (status in ('draft','announced','registration_open','registration_closed','scheduling','active','completed','archived'));
