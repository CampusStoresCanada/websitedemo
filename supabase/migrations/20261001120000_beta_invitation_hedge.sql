-- The beta invitation, hedged.
--
-- "Your submission is real" was too absolute for the thing we are actually
-- asking. A beta tester is being invited to attack the form, and the honest
-- version admits both halves: their figures count if they want them to, and if
-- the attack succeeds we are not going to hold them to whatever wreckage is
-- left in the row.
--
-- ⛔ Written as a new migration rather than an edit to
-- 20260825194600_benchmarking_invitation_email.sql, which seeds this template
-- with `on conflict (key) do update set`. Editing that file in place would
-- leave the applied history saying one thing and the file saying another, and
-- replaying it on a fresh environment would quietly reinstate the old copy
-- over this one.
--
-- replace() rather than a full body rewrite, so this is a no-op on an
-- environment where the change was already made by hand and still correct on a
-- fresh one that has just replayed the original seed.

update public.message_templates
set body_html = replace(
      body_html,
      '<p><strong>Your submission is real.</strong> You are not testing with fake numbers and you will not be asked to do this twice. You are just going first, while we can still fix what you find.</p>',
      '<p><strong>Your submission is real, if you want it to be.</strong> You are not testing with fake numbers and you will not be asked to do this twice, unless something goes really wrong. You are just going first, while we can still fix what you find.</p>'
    ),
    updated_at = now()
where key = 'benchmarking_beta_invitation';
