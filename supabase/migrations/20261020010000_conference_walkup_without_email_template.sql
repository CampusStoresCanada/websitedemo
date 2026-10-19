-- Heads-up to a company's admins: someone was added for them at the check-in
-- desk without an email address, so they have no login.
--
-- Stephen, 2026-10-19: the desk may skip the email; the person still gets a
-- record and a badge, and their admins are told so they can add the address
-- and invite them. Sent by recordNameOnlyWalkUp (lib/actions/conference-people.ts).
--
-- Authored as body_blocks (body_html is their compiled output, so the
-- template editor round-trips it). The third paragraph is Stephen's wording.

insert into message_templates (key, category, name, description, subject, body_html, body_blocks, variable_keys, is_system, is_transactional)
values (
  'conference_walkup_without_email',
  'conference',
  'Conference: walk-up added without an email',
  'Sent to a company''s org admins when the check-in desk adds one of their people without an email address, so that person has no login.',
  'Heads up: {{person_name}} has no login',
  $body$<p>Hi {{first_name}},</p>
<p>Just a heads up. {{person_name}} was added for {{organization_name}} at the {{conference_name}} check-in desk.</p>
<p>This person was minted for your company but without an email address they are not given the ability to log in, which affects their abilities throughout the conference and CSC.</p>
<p>To give them a login, open them in your organization's contacts, add their email address and send the invite.</p>
<div style="text-align:left;margin:16px 0;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="left" style="margin:0;">
    <tr>
      <td style="border-radius:6px;background-color:#EE2A2E;">
        <a href="{{org_url}}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:Calibri,'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Open {{organization_name}}</a>
      </td>
    </tr>
  </table>
</div>$body$,
  $blocks$[{"id": "hi", "type": "text", "html": "<p>Hi {{first_name}},</p>"}, {"id": "what", "type": "text", "html": "<p>Just a heads up. {{person_name}} was added for {{organization_name}} at the {{conference_name}} check-in desk.</p>"}, {"id": "why", "type": "text", "html": "<p>This person was minted for your company but without an email address they are not given the ability to log in, which affects their abilities throughout the conference and CSC.</p>"}, {"id": "fix", "type": "text", "html": "<p>To give them a login, open them in your organization's contacts, add their email address and send the invite.</p>"}, {"id": "cta", "type": "button", "text": "Open {{organization_name}}", "href": "{{org_url}}", "align": "left", "color": "#EE2A2E"}]$blocks$::jsonb,
  array['first_name', 'person_name', 'organization_name', 'conference_name', 'org_url'],
  true,
  true
)
on conflict (key) do nothing;
