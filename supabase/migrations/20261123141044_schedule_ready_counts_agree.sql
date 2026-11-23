-- The schedule-ready email wrote "{{meeting_count}} meetings" and
-- "{{day_count}} days" itself, so one day read "across 1 days". The code now
-- hands over the count with its noun (meetings_phrase, days_phrase in
-- scheduleReadyVariables, lib/comms/conference-triggers.ts).
--
-- ⛔ Apply only once that code is deployed: an older build does not pass the
-- two new values, and the sentence would print with blanks.
update public.message_templates
set body_html = replace(
      body_html,
      'You have <strong>{{meeting_count}} meetings</strong> scheduled across <strong>{{day_count}} days</strong>.',
      'You have <strong>{{meetings_phrase}}</strong> scheduled across <strong>{{days_phrase}}</strong>.'
    ),
    variable_keys = variable_keys || array['meetings_phrase', 'days_phrase'],
    updated_at = now()
where key = 'conference_schedule_ready'
  and body_html like '%{{meeting_count}} meetings%';
