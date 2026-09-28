-- The nominations nudge.
--
-- The reminder machinery only ever pointed at the ballot: every step counted
-- back from ballots close and both audiences were voting audiences. So the one
-- window where the association actually needs people to act had no reminder at
-- all, and the call for nominations refuses to send twice by design.
--
-- One template for both steps. The opening line is a variable rather than a
-- second template, because the two steps differ only in who they address, not
-- in what they say. (Contrast the elected/not-elected pair, which say opposite
-- things and are deliberately separate.)
--
-- The point it exists to make: a nomination is not finished when it is
-- submitted. Three other parties have to act before the close, and that is why
-- starting early matters more than the deadline implies.

insert into message_templates (key, category, name, description, subject, body_html, variable_keys, is_system, is_transactional)
values (
  'election_nomination_reminder',
  'governance',
  'Election: nominations closing reminder',
  'Scheduled nudge during the nomination window. Sent to every eligible institution, or only those that have put nobody forward.',
  'Nominations for the {{cycle_year}} CSC Board close {{nominations_close}}',
  '<h2>Nominations close {{nominations_close}}</h2>
  <p>Hi {{contact_name}},</p>
  <p>{{standing_line}}</p>
  <p>If you are thinking about standing, or about putting a colleague forward, the thing worth knowing is that a nomination is not finished when it is submitted. Three other things have to happen before it counts:</p>
  <ul>
    <li>the nominee accepts, and writes a short biography and candidate statement</li>
    <li>their institution gives permission for them to serve if elected</li>
    <li>two member institutions co-sign it</li>
  </ul>
  <p>None of that is difficult, but it involves people at other campus stores acting on their own schedules. That is the part everyone underestimates, and it is why starting now matters more than the closing date suggests.</p>
  <p style="margin:24px 0">
    <a href="{{nominate_url}}" style="background:#163D6D;font-weight:600;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Put forward a nomination</a>
  </p>
  <p>One thing that catches people out: if you are already a director and your term ends at this annual general meeting, standing again is a new nomination. Telling someone you intend to seek re-election does not start one, and the by-laws do not treat a sitting director differently. You need the same three steps as anyone else.</p>
  <p>If you nominate yourself, your own institution cannot be one of the two co-signers, so you will need two others.</p>
  <p><strong>Nominations close {{nominations_close}}.</strong> Anything incomplete on that date does not go on the ballot, and there is no way to extend it afterwards.</p>',
  array['contact_name', 'organization_name', 'cycle_year', 'nominations_close', 'nominate_url', 'standing_line'],
  true,
  true
)
on conflict (key) do nothing;
