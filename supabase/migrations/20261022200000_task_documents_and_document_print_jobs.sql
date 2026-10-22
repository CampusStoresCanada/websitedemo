-- Documents on checklist tasks, and printing them from the War Room.
--
-- Stephen, 2026-10-22: "when the Board member walks up and is like 'do you
-- have a copy of my speech' … pull out my phone … and send the print job."
--
-- 1. A task names the documents that belong to it. The documents themselves
--    stay where admins already keep them — conference_instances.documents, the
--    conference's Documents page (a label plus a link or an uploaded file) —
--    and a task holds their ids. Those ids are client-made uuids inside that
--    jsonb array, so there is nothing to foreign-key to: a document removed
--    from the Documents page simply stops showing on the task.
--
-- 2. "Send to printer" puts a job on the queue the print station already
--    claims from (badge_print_jobs, transport printer_bridge). A third pipeline,
--    'document', not a second queue: the station that prints reprint stickers on
--    the QL prints a document on the paper printer beside it.

alter table public.conference_checklist_tasks
  add column if not exists document_ids text[] not null default '{}';

comment on column public.conference_checklist_tasks.document_ids is
  'Ids of entries in conference_instances.documents that belong to this task (a speech, a run-sheet). Shown on the task with Open and Send to printer.';

alter table public.badge_print_jobs
  drop constraint if exists badge_print_jobs_pipeline_type_check;

alter table public.badge_print_jobs
  add constraint badge_print_jobs_pipeline_type_check
  check (pipeline_type = any (array['preprinted'::text, 'onsite_reprint'::text, 'document'::text]));
