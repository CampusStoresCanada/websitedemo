-- Shipping labels join the print station's queue as a fourth kind of job.
--
-- Booked at the shipping desk, they wait (status 'queued') until someone swaps
-- the QL to the DK-1247 die-cut roll (103 x 164 mm) and presses "Print the
-- shipping labels" in the War Room, which releases them to the station. If
-- the printer refuses (the badge roll is still loaded), they go back to
-- waiting rather than retrying forever. Restated in full from the live
-- constraint (checked 2026-11-04), plus the new kind.

alter table public.badge_print_jobs drop constraint if exists badge_print_jobs_pipeline_type_check;
alter table public.badge_print_jobs add constraint badge_print_jobs_pipeline_type_check
  check (pipeline_type = any (array['preprinted'::text, 'onsite_reprint'::text, 'document'::text, 'shipping_label'::text]));
