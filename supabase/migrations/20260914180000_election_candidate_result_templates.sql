-- The candidates' own result, sent before the membership broadcast.
--
-- Until now the only message carrying the result went to every eligible
-- institution's administrators, so a candidate who was not elected learned it
-- from a broadcast addressed to the whole association — and, since every
-- director is also an administrator of their own store, often in the same
-- inbox as their colleagues' copies.
--
-- Two templates rather than one with a conditional: they say opposite things
-- to people in opposite situations, and a shared template is one careless edit
-- away from congratulating somebody who lost.
--
-- NEITHER carries vote counts. By-Law Part V S3(d) has the Chair announce who
-- was elected; the announcement to members names the result and the turnout
-- and never the tallies. getCandidateOutcomes does not return the numbers at
-- all, so these cannot leak them by accident.

insert into message_templates (key, category, name, description, subject, body_html, variable_keys, is_system, is_transactional)
values
  (
    'election_result_elected',
    'governance',
    'Election: you were elected',
    'Sent to each elected candidate after the AGM, before the membership announcement.',
    'You have been elected to the CSC Board of Directors',
    '<h2>You have been elected</h2>
  <p>Hi {{candidate_name}},</p>
  <p>At the annual general meeting on {{agm_date}}, the members elected you to the Campus Stores Canada Board of Directors for the {{cycle_year}} term. Thank you for standing — and congratulations.</p>
  <p>You stood on behalf of {{organization_name}}, and that institution''s support made your nomination possible. It is worth telling them yourself before this becomes general knowledge.</p>
  <p>The association will be in touch shortly about your first meeting, the orientation material, and the access you will need. Nothing is required from you today.</p>
  <p>We are glad to have you.</p>',
    array['candidate_name', 'organization_name', 'cycle_year', 'agm_date'],
    true,
    true
  ),
  (
    'election_result_not_elected',
    'governance',
    'Election: you were not elected',
    'Sent to each candidate who was not elected, after the AGM and before the membership announcement.',
    'The result of the CSC board election',
    '<h2>The result of the election</h2>
  <p>Hi {{candidate_name}},</p>
  <p>At the annual general meeting on {{agm_date}}, the members elected the {{cycle_year}} Board of Directors. You were not among those elected this time, and we wanted you to hear it from us directly rather than in the announcement going to the membership.</p>
  <p>Standing for the board is not a small thing. It asks you to put your name in front of the whole association, and it asks your institution to back you. That {{organization_name}} did so, and that you were willing, says something worth saying plainly: the association is better for having had the choice.</p>
  <p>Nominations open again next year, and candidates who stand more than once are common rather than unusual. If you would like to talk about committee work in the meantime — which is where a good deal of the association''s actual work happens, and where most directors started — please reply to this message.</p>
  <p>Thank you for standing.</p>',
    array['candidate_name', 'organization_name', 'cycle_year', 'agm_date'],
    true,
    true
  )
on conflict (key) do nothing;
