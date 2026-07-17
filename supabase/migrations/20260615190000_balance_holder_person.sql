-- Fork B · slice B1 — v3 balances held by REAL people.
--
-- Until now a balance's holder was free text (a proof stand-in). The fulfillment
-- chain (allocation, badges, check-in) keys on conference_people — so a held
-- grant must point at a real person. holder (text) stays as an optional label;
-- holder_person_id is the real link. The resolver gains a person-keyed variant
-- so "what can this person get into" is answerable for the people badges use.

alter table public.entity_balances
  add column if not exists holder_person_id uuid references public.conference_people(id) on delete set null;

create index if not exists idx_entity_balances_person
  on public.entity_balances(conference_id, holder_person_id);

-- Access for a real person: everything reachable from what they hold, via
-- includes + involved_in. Mirrors resolve_holder_access (text) but keyed on the
-- person — this is the one fulfillment will use.
create or replace function public.resolve_person_access(
  p_conference_id uuid,
  p_person_id     uuid
) returns table (entity_id uuid)
language sql
as $$
  with recursive held as (
    select b.entity_id from public.entity_balances b
    where b.conference_id = p_conference_id and b.holder_person_id = p_person_id
  ),
  acc(entity_id) as (
    select h.entity_id from held h
    union
    select r.to_entity_id
    from acc a
    join public.conference_entity_refs r
      on r.from_entity_id = a.entity_id
     and r.role in ('includes', 'involved_in')
     and r.conference_id = p_conference_id
  )
  select a.entity_id from acc a;
$$;
