-- The admin ops page's Resolve button writes status = 'resolved', which the
-- check constraint rejected, so the button never worked. Allow it.
-- Applied to the live database 2026-11-17.
alter table public.circle_sync_queue drop constraint circle_sync_queue_status_check;
alter table public.circle_sync_queue add constraint circle_sync_queue_status_check
  check (status = any (array['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'resolved'::text]));
