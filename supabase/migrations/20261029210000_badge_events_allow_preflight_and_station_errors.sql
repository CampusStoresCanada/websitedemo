-- The code writes two badge event types the check never listed, so both
-- inserts were rejected and, because neither caller read the error, lost:
--   preflight_warning    the text-fit warnings on a generated package
--   print_station_error  why a print station failed a job (the job row says
--                        only "failed"; its reason lives on this event)
alter table public.badge_print_events
  drop constraint badge_print_events_event_type_check;

alter table public.badge_print_events
  add constraint badge_print_events_event_type_check
  check (event_type = any (array[
    'queued', 'rendering', 'rendered', 'pdf_generated', 'sent_to_printer',
    'printed', 'failed', 'canceled', 'delivered', 'reprint_requested',
    'preflight_warning', 'print_station_error'
  ]));
