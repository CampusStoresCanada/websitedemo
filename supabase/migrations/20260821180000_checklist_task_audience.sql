-- Who answers a checklist task: the company, or the person.
--
-- The user's rule, stated plainly: "Org admins answer for the company, people
-- answer for themselves." Stronco, Encore, payment and the directory listing
-- are answered once by the company. Hotel, travel and assignee-accepted
-- policies are answered by each attendee for themselves.
--
-- One task vocabulary serves both — the audience decides who is asked and
-- where it renders. The reminder engine is org-scoped throughout (its checks
-- take an organizationId and its reminders resolve to org admins), so it
-- processes 'org' tasks only. 'person' tasks surface on /me/conference, and
-- their answers carry person_id on the acknowledgement.
--
-- Defaulting to 'org' preserves every existing task's behaviour exactly.

alter table public.conference_checklist_tasks
  add column if not exists audience text not null default 'org'
  check (audience in ('org', 'person'));

comment on column public.conference_checklist_tasks.audience is
  'Who answers: org (an admin answers for the company) or person (each attendee answers for themselves).';
