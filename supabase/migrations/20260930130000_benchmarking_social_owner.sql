-- Who actually posts, by name, when the answer is somebody on staff.
--
-- "Store staff, as part of their job" tells you the arrangement but not the
-- person, and the person is the useful half: they are who a peer asks how a
-- campaign went, and who CSC invites when it runs something on social. Only
-- asked where the answer is internal — an agency is not in our contacts and
-- never will be.

alter table public.benchmarking
  add column if not exists social_media_run_by_contact_id uuid
    references public.contacts(id) on delete set null;

comment on column public.benchmarking.social_media_run_by_contact_id is
  'The person who runs the store''s social, where it is run in house. Points at contacts, so it is the same person record the rest of the site uses.';
