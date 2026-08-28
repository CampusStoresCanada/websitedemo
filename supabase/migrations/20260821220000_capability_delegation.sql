-- Delegation: a grant that carries the right to issue other grants.
--
-- The ED appoints a committee lead. The lead then hands out the working
-- capabilities themselves, without going through an admin every time — which
-- is the difference between a committee that can operate and one that queues
-- behind one person's inbox.
--
-- A delegated grant can never outlive the grant that authorised it. If the
-- lead's own window ends 15 October, nothing they issue may run past it.

alter table public.capability_grants
  add column if not exists can_delegate boolean not null default false,
  add column if not exists delegated_from uuid references public.capability_grants(id) on delete set null;

comment on column public.capability_grants.can_delegate is
  'Holder may issue the capabilities this one delegates (see capability_delegates). Leads have it; working members do not.';
comment on column public.capability_grants.delegated_from is
  'The grant that authorised this one. Null when an admin issued it directly.';

create table if not exists public.capability_delegates (
  parent_capability text not null,
  child_capability text not null,
  primary key (parent_capability, child_capability)
);

insert into public.capability_delegates (parent_capability, child_capability) values
  ('benchmarking.committee_lead', 'benchmarking.content_review'),
  ('benchmarking.committee_lead', 'benchmarking.qa_verify'),
  ('benchmarking.committee_lead', 'benchmarking.recipient_confirm')
on conflict do nothing;

create or replace function public.max_delegable_until(
  p_subject uuid,
  p_child_capability text
) returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $$
  select max(g.ends_at)
  from public.capability_grants g
  join public.capability_delegates d
    on d.parent_capability = g.capability
   and d.child_capability = p_child_capability
  where g.subject_id = p_subject
    and g.can_delegate = true
    and g.revoked_at is null
    and now() >= g.starts_at
    and now() < g.ends_at;
$$;

comment on function public.max_delegable_until is
  'Latest end date this person may set when issuing that capability. Null means they may not issue it at all. A delegated grant never outlives its parent.';

grant select on public.capability_delegates to authenticated;
grant execute on function public.max_delegable_until(uuid, text) to authenticated;
