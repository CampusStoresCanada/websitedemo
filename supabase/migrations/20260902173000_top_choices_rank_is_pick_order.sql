-- `rank` was a lie, so it stops being called one.
--
-- The pickers are checkboxes on one alphabetical list. Rank was derived from
-- array position, and the array appends in tick order — so "rank 1" largely
-- means "early in the alphabet", not "wanted most". Steve specified the product
-- as "choose in no order your top five Orgs to meet": UNORDERED is the design,
-- not a limitation of the control.
--
-- ⛔ Renamed rather than documented. A write-site comment does not travel with
-- the data into a query somebody writes in eight months, and a column called
-- `rank` next to a column called `chosen_org_id` will eventually be read as a
-- preference ordering by someone who never saw this file. The match-engine
-- session raised exactly this and will not read it either way.
--
-- Kept, rather than dropped, only so the set has a stable display order —
-- replaceTopChoices deletes and re-inserts wholesale, so without it the order
-- a person sees their own five in could change between page loads.
alter table public.conference_top_choices
  rename column rank to picked_order;

comment on column public.conference_top_choices.picked_order is
  'The order the boxes were ticked, nothing more. NOT a ranking: the picker is checkboxes on one alphabetical list, so a low number largely means "early in the alphabet". Steve specified the product as "choose in no order your top five Orgs to meet" — being IN the five is the signal. Kept only to give the set a stable display order.';
