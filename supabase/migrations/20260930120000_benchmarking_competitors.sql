-- Competing stores, one row each — like every other list in this survey.
--
-- Was a count plus a free-text "who are they?", which asked a store to compress
-- four answers into one box and gave us a sentence nobody can group by. One row
-- per store means a reader can ask how many members compete with a national
-- chain, which is the question this was for.

create table if not exists public.benchmarking_competitors (
  id uuid primary key default gen_random_uuid(),
  benchmarking_id uuid not null references public.benchmarking(id) on delete cascade,
  name text not null,
  kind text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists benchmarking_competitors_benchmarking_idx
  on public.benchmarking_competitors (benchmarking_id, position);

alter table public.benchmarking_competitors enable row level security;

comment on table public.benchmarking_competitors is
  'One row per store competing with the member for the same business. Read through the admin client behind the survey route guard, like every other benchmarking table.';
