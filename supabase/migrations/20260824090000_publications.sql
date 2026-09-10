-- Saved publication definitions.
--
-- "We can make another directory print run tomorrow if we run the tool and
-- select what goes into it." That only works if a definition is a thing you can
-- keep, edit and re-run — not an object literal in a page component.
--
-- `selection` and `sections` are jsonb because they are a discriminated union of
-- section types with per-type fields, and normalising that into tables would
-- mean a migration every time a section type is added. The trade is that the
-- database cannot enforce their shape, so parsePublication() in
-- lib/publication/store.ts validates on read and reports what it rejected
-- rather than quietly dropping it — a section silently missing from a printed
-- directory is exactly the failure this whole system is built to avoid.
--
-- Not conference-scoped: a publication may be a conference directory, a
-- standing partner directory, or a category buying guide. The conference (if
-- any) lives inside `source`.

create table if not exists public.publications (
  id uuid primary key default gen_random_uuid(),
  -- Internal name for the list ("CSC 2027 Exhibitor Directory").
  name text not null,
  -- Printed title, which may differ from the internal name.
  title text not null,
  source jsonb not null,
  selection jsonb not null default '{}'::jsonb,
  sections jsonb not null default '[]'::jsonb,
  -- Set when this definition has actually been sent to press, so an edit to a
  -- printed publication is visibly a new state rather than a silent rewrite.
  last_printed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists publications_name_idx on public.publications (name);

alter table public.publications enable row level security;

comment on table public.publications is
  'Saved, re-runnable publication definitions: source + selection + ordered sections. Shape validated in application code, not by the DB.';
