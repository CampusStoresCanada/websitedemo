-- Big Ideas Day pitches: a moderation step before a pitch is public.
--
-- Steve, 2026-11-23: "a moderation step on the posts for Big Ideas Day topics."
-- Until now a pitch went straight onto the public board the moment it was
-- submitted. 'submitted' is the state before that: staff have not looked yet.
--
--   submitted -> proposed (approved: on the board, members can choose it)
--             -> declined
--   proposed  -> scheduled | declined | withdrawn   (unchanged)
--
-- ⛔ The column default stays 'proposed'. Every pitch already on the board was
-- public before this existed and stays public; only proposeTopic writes
-- 'submitted', explicitly. Widening the check is safe under the deployed code,
-- which never writes the new value.

alter table conference_topics drop constraint conference_topics_status_check;
alter table conference_topics add constraint conference_topics_status_check
  check (status in ('submitted', 'proposed', 'scheduled', 'declined', 'withdrawn'));
