-- Person resolution on the edge itself.
--
-- The org edge is the PRIOR, not the answer. "Merangue and Greentown match
-- McMaster" is a useful institutional fact; "Mike Clark should meet Zach,
-- because Zach owns course materials" is the thing anyone can act on. Both are
-- the same kind of claim at different resolution, so they live in one table —
-- an edge with null contacts is the org-level prior, one with contacts is the
-- specific pairing underneath it.
--
-- Nullable on purpose: most orgs name nobody. Only 7 of 13 orgs with procurement
-- data name any owners at all, so the org-level edge has to keep working alone.

alter table public.match_edges
  add column if not exists subject_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists candidate_contact_id uuid references public.contacts(id) on delete set null;

-- ⚠️ Uniqueness must include the people, or a person edge collides with the org
-- edge it sits under and one silently replaces the other. NULLS NOT DISTINCT for
-- the same reason as the rollups: Postgres treats every NULL as unique, so the
-- org-level row (both contacts null) could otherwise insert repeatedly and no
-- upsert would ever match it. PG 15+; this server is 17.6.
alter table public.match_edges
  drop constraint if exists match_edges_run_id_direction_subject_org_id_candidate_org_i_key;

create unique index if not exists match_edges_key
  on public.match_edges (
    run_id, direction,
    subject_org_id, subject_contact_id,
    candidate_org_id, candidate_contact_id
  )
  nulls not distinct;

create index if not exists match_edges_subject_contact_idx
  on public.match_edges (run_id, direction, subject_contact_id, rank)
  where subject_contact_id is not null;

create index if not exists match_edges_candidate_contact_idx
  on public.match_edges (run_id, direction, candidate_contact_id)
  where candidate_contact_id is not null;

comment on column public.match_edges.subject_contact_id is
  'The specific person this edge is for, when the match resolves to one. Null = the org-level prior that person edges sit under.';
