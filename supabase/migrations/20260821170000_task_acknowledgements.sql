-- Self-reported checklist items.
--
-- The checklist engine only allowed machine-verifiable checks, which is right
-- for anything the site captures. But the exhibitor follow-up list is mostly
-- things that happen on someone else's system: Stronco's portal, Encore's
-- emailed PDF order form, a hotel booking. CSC cannot observe any of them.
--
-- So: let people tick them off, and record who said so and when.
--
-- Three states, not two. "Not applicable" is the important one — an exhibitor
-- staying at their own hotel who gets nagged until February stops reading the
-- reminders entirely, including the ones that cost them money if missed (the
-- Encore advance rate closes 10 business days before opening). Dismissal is a
-- feature, not an escape hatch.
--
-- Scope follows who actually answers, which the user stated plainly: "Org
-- admins answer for the company, people answer for themselves." Stronco,
-- Encore and the directory listing are per-org; hotel, travel and
-- assignee-accepted policies are per-person. person_id NULL = an org-level
-- answer given on behalf of the company.

create table if not exists public.conference_task_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conference_instances(id) on delete cascade,
  task_id uuid not null references public.conference_checklist_tasks(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- NULL = answered for the whole org by an admin; set = one person's own answer.
  person_id uuid references public.conference_people(id) on delete cascade,
  state text not null check (state in ('done', 'not_applicable')),
  -- Optional proof the org chose to give: a hotel confirmation code, a Stronco
  -- order number. Never required — the point is a low-friction tick.
  evidence text,
  note text,
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- One answer per task per answerer. Two partial indexes because Postgres treats
-- NULLs as distinct, so a plain UNIQUE over a nullable person_id would let an
-- org accumulate duplicate org-level answers.
create unique index if not exists conference_task_ack_org_unique
  on public.conference_task_acknowledgements (task_id, organization_id)
  where person_id is null;

create unique index if not exists conference_task_ack_person_unique
  on public.conference_task_acknowledgements (task_id, person_id)
  where person_id is not null;

create index if not exists conference_task_ack_lookup
  on public.conference_task_acknowledgements (conference_id, organization_id, task_id);

alter table public.conference_task_acknowledgements enable row level security;

-- Reads and writes go through server actions on the service-role client, the
-- same pattern as the rest of the conference tables. No session-client policy
-- is granted here on purpose: a GRANT without a matching policy returns zero
-- rows and a null error, which reads as success.
comment on table public.conference_task_acknowledgements is
  'Self-reported completion of checklist tasks the site cannot verify (Stronco, Encore, hotel). person_id NULL = answered for the org by an admin.';

-- Add the check type that reads this table.
alter table public.conference_checklist_tasks
  drop constraint if exists conference_checklist_tasks_check_type_check;

alter table public.conference_checklist_tasks
  add constraint conference_checklist_tasks_check_type_check
  check (check_type = any (array[
    'seat_assigned'::text,
    'entity_purchased'::text,
    'travel_info_submitted'::text,
    'payment_complete'::text,
    'legal_document_accepted'::text,
    'directory_profile_complete'::text,
    'self_reported'::text
  ]));
