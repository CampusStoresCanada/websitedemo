-- Give the rollups person resolution.
--
-- ⛔ These were org-grained, and the contact column was removed on privacy
-- grounds. That was misplaced: this is an INTERNAL tool and CSC owns the
-- platform, the collection surfaces and the interactions. The rule that matters
-- governs what is shown OUTWARD, at a surface — not what the org may know about
-- its own community.
--
-- The cost of getting this wrong is asymmetric and permanent. Circle posts,
-- badge scans and searches are all acts by a PERSON; aggregating them to org
-- before storing destroys that resolution at the one stage it cannot be
-- recovered from, and "McMaster buys apparel and course materials" is the wrong
-- answer to "who should Zach meet". `collapseToOrg()` folds on demand, so
-- keeping the detail costs nothing.

alter table public.signal_term_rollup
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;

alter table public.signal_affinity_rollup
  add column if not exists contact_id uuid references public.contacts(id) on delete set null;

-- ⚠️ A UNIQUE INDEX, not a primary key.
--
-- `contact_id` is nullable by design — anonymous and unlinked acts still roll up
-- at org level — and a PRIMARY KEY cannot contain a nullable column. A plain
-- unique index would not help either: Postgres treats every NULL as distinct, so
-- the org-level bucket could be inserted repeatedly and the drain's upsert would
-- never fire. NULLS NOT DISTINCT (PG 15+; this server is 17.6) makes the single
-- null bucket behave like the value it represents.
alter table public.signal_term_rollup     drop constraint if exists signal_term_rollup_pkey;
alter table public.signal_affinity_rollup drop constraint if exists signal_affinity_rollup_pkey;

create unique index if not exists signal_term_rollup_key
  on public.signal_term_rollup (organization_id, contact_id, term, term_source, stance, polarity)
  nulls not distinct;

create unique index if not exists signal_affinity_rollup_key
  on public.signal_affinity_rollup (organization_id, contact_id, object_org_id, stance, polarity)
  nulls not distinct;

create index if not exists signal_term_rollup_contact_idx
  on public.signal_term_rollup (contact_id, weight desc) where contact_id is not null;
create index if not exists signal_affinity_rollup_contact_idx
  on public.signal_affinity_rollup (contact_id, weight desc) where contact_id is not null;

comment on column public.signal_term_rollup.contact_id is
  'The person who revealed this interest, when known. Part of the key — rolling up to org before storing destroys resolution that cannot be recovered. Null = anonymous or unlinked; collapseToOrg() folds on demand.';
