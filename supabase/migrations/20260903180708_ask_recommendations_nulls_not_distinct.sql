-- ⛔ NULL != NULL in a unique constraint by default, so an org-grain candidate
-- (candidate_contact_id NULL) never collided with itself and every nightly run
-- inserted a fresh duplicate. Login Canada appeared twice at rank 6 after two
-- runs; it would have been thirty duplicates in a month.
--
-- Postgres 15+ has NULLS NOT DISTINCT for exactly this. The server is 17.6.
--
-- ⚠️ Most rows in this table are org-grain — a silent partner has nobody who has
-- written anything for the engine to place individually, which is exactly why
-- they are candidates at all. So the NULL case is the COMMON case here, not an
-- edge one, and this constraint is what the selection log's upsert relies on.

delete from public.ask_recommendations a
using public.ask_recommendations b
where a.ctid > b.ctid
  and a.ask_ref = b.ask_ref
  and a.candidate_org_id = b.candidate_org_id
  and a.candidate_contact_id is not distinct from b.candidate_contact_id;

alter table public.ask_recommendations
  drop constraint if exists ask_recommendations_unique;

alter table public.ask_recommendations
  add constraint ask_recommendations_unique
  unique nulls not distinct (ask_ref, candidate_org_id, candidate_contact_id);
