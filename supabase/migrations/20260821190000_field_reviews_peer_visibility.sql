-- Let content reviewers read each other's reviews.
--
-- The UI still holds back a field's peer comments until you have logged your
-- own verdict on it, so first impressions stay independent. That gate is a
-- nudge in the page, not a security boundary — these are a handful of trusted
-- store directors, and the point is that they can compare notes.

drop policy if exists bfr_content_reviewer_peer_select on public.benchmarking_field_reviews;
create policy bfr_content_reviewer_peer_select on public.benchmarking_field_reviews
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_benchmarking_content_reviewer = true
    )
  );

comment on table public.benchmarking_field_reviews is
  'Content reviewers'' verdicts on survey question wording, plus the worked examples they author. One row per (survey, field, reviewer). Reviewers can read each other''s rows; the review page reveals a field''s peer comments only once you have answered it yourself.';
