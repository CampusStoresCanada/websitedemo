-- Retire the two benchmarking reviewer booleans.
--
-- Superseded by capability_grants, which carries an end date, a reason and an
-- author. A boolean on profiles has none of those: it never expires, nobody
-- remembers why it was set, and it leaves no record of the work for the AGM.
--
-- Four RLS policies read these columns. Rewrite them onto has_capability()
-- FIRST — dropping with CASCADE would take the policies with it and silently
-- remove reviewer access to submissions, flags and peer reviews.

drop policy if exists "Benchmarking reviewers can read submissions" on public.benchmarking;
create policy "Benchmarking reviewers can read submissions" on public.benchmarking
  for select to authenticated
  using (public.has_capability(auth.uid(), 'benchmarking.qa_verify'));

drop policy if exists "Benchmarking reviewers can read delta flags" on public.delta_flags;
create policy "Benchmarking reviewers can read delta flags" on public.delta_flags
  for select to authenticated
  using (public.has_capability(auth.uid(), 'benchmarking.qa_verify'));

drop policy if exists "Benchmarking reviewers can review delta flags" on public.delta_flags;
create policy "Benchmarking reviewers can review delta flags" on public.delta_flags
  for update to authenticated
  using (public.has_capability(auth.uid(), 'benchmarking.qa_verify'));

drop policy if exists bfr_content_reviewer_peer_select on public.benchmarking_field_reviews;
create policy bfr_content_reviewer_peer_select on public.benchmarking_field_reviews
  for select to authenticated
  using (public.has_capability(auth.uid(), 'benchmarking.content_review'));

-- Nothing depends on the columns now.
drop index if exists public.profiles_benchmarking_content_reviewer_idx;

alter table public.profiles
  drop column if exists is_benchmarking_reviewer,
  drop column if exists is_benchmarking_content_reviewer;
