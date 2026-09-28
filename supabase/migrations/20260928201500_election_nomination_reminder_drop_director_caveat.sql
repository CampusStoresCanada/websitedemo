-- Drop the sitting-director paragraph from the nomination reminder.
--
-- It was written to reach four incumbents who had said they would seek
-- re-election and started nothing. But this template goes to every eligible
-- institution, and a caveat aimed at four people reads to the other two
-- hundred as the association correcting its own board in public. It also made
-- a clean message longer for everyone who did not need it.
--
-- A message for four named people is a note from the Executive Director, not a
-- paragraph in a membership-wide send. The self-nomination line stays: that one
-- applies to anybody standing, and it is the rule that has already caught
-- somebody out this cycle.

update message_templates
set body_html = '<h2>Nominations close {{nominations_close}}</h2>
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
  <p>If you nominate yourself, your own institution cannot be one of the two co-signers, so you will need two others.</p>
  <p><strong>Nominations close {{nominations_close}}.</strong> Anything incomplete on that date does not go on the ballot, and there is no way to extend it afterwards.</p>',
    updated_at = now()
where key = 'election_nomination_reminder';
