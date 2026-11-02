-- Confirmation emails for the travel bursary request and for expense claims.
--
-- Stephen, 2026-11-02: a school heard nothing at any step; it had to go back to
-- the page to find out. Sent to the people who filled the request or claim in
-- (lib/actions/conference-bursary.ts, lib/actions/expense-claims.ts), never
-- to all org admins. Transactional: each is about the recipient's own request.
--
-- Authored as body_blocks (body_html is their compiled output, so the
-- template editor round-trips it).

insert into message_templates (key, category, name, description, subject, body_html, body_blocks, variable_keys, is_system, is_transactional)
values (
  'bursary_request_received',
  'conference',
  'Travel bursary: request received',
  'Sent to the people who filled in a school''s travel bursary request when it is submitted.',
  'We received {{organization_name}}''s travel bursary request',
  $body$<p>Hi {{first_name}},</p>
<p>Thank you. Campus Stores Canada has received {{organization_name}}'s travel bursary request for {{conference_name}}.</p>
<p>We review each request and will email you when a decision is made. You can look at your request at any time.</p>
<div style="text-align:left;margin:16px 0;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="left" style="margin:0;">
    <tr>
      <td style="border-radius:6px;background-color:#EE2A2E;">
        <a href="{{request_url}}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:Calibri,'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">View your request</a>
      </td>
    </tr>
  </table>
</div>$body$,
  $blocks$[{"id":"hi","type":"text","html":"<p>Hi {{first_name}},</p>"},{"id":"what","type":"text","html":"<p>Thank you. Campus Stores Canada has received {{organization_name}}'s travel bursary request for {{conference_name}}.</p>"},{"id":"next","type":"text","html":"<p>We review each request and will email you when a decision is made. You can look at your request at any time.</p>"},{"id":"cta","type":"button","text":"View your request","href":"{{request_url}}","align":"left","color":"#EE2A2E"}]$blocks$::jsonb,
  array['first_name', 'organization_name', 'conference_name', 'request_url'],
  true,
  true
)
on conflict (key) do nothing;

insert into message_templates (key, category, name, description, subject, body_html, body_blocks, variable_keys, is_system, is_transactional)
values (
  'bursary_request_approved',
  'conference',
  'Travel bursary: request approved',
  'Sent to the people who filled in a school''s travel bursary request when CSC approves it.',
  'Your travel bursary request is approved',
  $body$<p>Hi {{first_name}},</p>
<p>Good news. {{organization_name}}'s travel bursary request for {{conference_name}} is approved.</p>
<p>Your delegate must attend every partner meeting assigned to them. If a meeting is missed without a reasonable excuse, your institution will be invoiced for the full value of the support. If your delegate can't attend, another qualified person from your institution may go in their place. Let us know as soon as you can.</p>
<p>After the conference, file your expense claim on your request page. Claims open {{claims_open_date}} and close {{claims_close_date}}. Every expense needs a receipt.</p>
<div style="text-align:left;margin:16px 0;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="left" style="margin:0;">
    <tr>
      <td style="border-radius:6px;background-color:#EE2A2E;">
        <a href="{{request_url}}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:Calibri,'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Open your request</a>
      </td>
    </tr>
  </table>
</div>$body$,
  $blocks$[{"id":"hi","type":"text","html":"<p>Hi {{first_name}},</p>"},{"id":"what","type":"text","html":"<p>Good news. {{organization_name}}'s travel bursary request for {{conference_name}} is approved.</p>"},{"id":"attend","type":"text","html":"<p>Your delegate must attend every partner meeting assigned to them. If a meeting is missed without a reasonable excuse, your institution will be invoiced for the full value of the support. If your delegate can't attend, another qualified person from your institution may go in their place. Let us know as soon as you can.</p>"},{"id":"claim","type":"text","html":"<p>After the conference, file your expense claim on your request page. Claims open {{claims_open_date}} and close {{claims_close_date}}. Every expense needs a receipt.</p>"},{"id":"cta","type":"button","text":"Open your request","href":"{{request_url}}","align":"left","color":"#EE2A2E"}]$blocks$::jsonb,
  array['first_name', 'organization_name', 'conference_name', 'request_url', 'claims_open_date', 'claims_close_date'],
  true,
  true
)
on conflict (key) do nothing;

insert into message_templates (key, category, name, description, subject, body_html, body_blocks, variable_keys, is_system, is_transactional)
values (
  'bursary_request_denied',
  'conference',
  'Travel bursary: request not approved',
  'Sent to the people who filled in a school''s travel bursary request when CSC does not approve it.',
  'Your travel bursary request',
  $body$<p>Hi {{first_name}},</p>
<p>We're sorry. {{organization_name}}'s travel bursary request for {{conference_name}} was not approved.</p>
<p>If you have questions, email us at info@campusstores.ca.</p>$body$,
  $blocks$[{"id":"hi","type":"text","html":"<p>Hi {{first_name}},</p>"},{"id":"what","type":"text","html":"<p>We're sorry. {{organization_name}}'s travel bursary request for {{conference_name}} was not approved.</p>"},{"id":"questions","type":"text","html":"<p>If you have questions, email us at info@campusstores.ca.</p>"}]$blocks$::jsonb,
  array['first_name', 'organization_name', 'conference_name', 'request_url'],
  true,
  true
)
on conflict (key) do nothing;

insert into message_templates (key, category, name, description, subject, body_html, body_blocks, variable_keys, is_system, is_transactional)
values (
  'expense_claim_received',
  'membership',
  'Expense claim: received',
  'Sent to the people who filled in an expense claim when it is submitted. Any program.',
  'We received your expense claim',
  $body$<p>Hi {{first_name}},</p>
<p>Campus Stores Canada has received {{organization_name}}'s expense claim for {{program_name}}, for a total of {{claim_total}}.</p>
<p>We will review it and email you when it is approved, or if anything needs to change.</p>
<div style="text-align:left;margin:16px 0;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="left" style="margin:0;">
    <tr>
      <td style="border-radius:6px;background-color:#EE2A2E;">
        <a href="{{claim_url}}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:Calibri,'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">View your claim</a>
      </td>
    </tr>
  </table>
</div>$body$,
  $blocks$[{"id":"hi","type":"text","html":"<p>Hi {{first_name}},</p>"},{"id":"what","type":"text","html":"<p>Campus Stores Canada has received {{organization_name}}'s expense claim for {{program_name}}, for a total of {{claim_total}}.</p>"},{"id":"next","type":"text","html":"<p>We will review it and email you when it is approved, or if anything needs to change.</p>"},{"id":"cta","type":"button","text":"View your claim","href":"{{claim_url}}","align":"left","color":"#EE2A2E"}]$blocks$::jsonb,
  array['first_name', 'organization_name', 'program_name', 'claim_total', 'claim_url'],
  true,
  true
)
on conflict (key) do nothing;

insert into message_templates (key, category, name, description, subject, body_html, body_blocks, variable_keys, is_system, is_transactional)
values (
  'expense_claim_returned',
  'membership',
  'Expense claim: needs a change',
  'Sent to the people who filled in an expense claim when staff send it back for a change. Carries staff''s note.',
  'Your expense claim needs a change',
  $body$<p>Hi {{first_name}},</p>
<p>{{organization_name}}'s expense claim for {{program_name}} needs a change before we can approve it.</p>
<p>What we need: {{decision_note}}</p>
<p>Make the change and submit the claim again.</p>
<div style="text-align:left;margin:16px 0;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="left" style="margin:0;">
    <tr>
      <td style="border-radius:6px;background-color:#EE2A2E;">
        <a href="{{claim_url}}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:Calibri,'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Update your claim</a>
      </td>
    </tr>
  </table>
</div>$body$,
  $blocks$[{"id":"hi","type":"text","html":"<p>Hi {{first_name}},</p>"},{"id":"what","type":"text","html":"<p>{{organization_name}}'s expense claim for {{program_name}} needs a change before we can approve it.</p>"},{"id":"note","type":"text","html":"<p>What we need: {{decision_note}}</p>"},{"id":"next","type":"text","html":"<p>Make the change and submit the claim again.</p>"},{"id":"cta","type":"button","text":"Update your claim","href":"{{claim_url}}","align":"left","color":"#EE2A2E"}]$blocks$::jsonb,
  array['first_name', 'organization_name', 'program_name', 'claim_total', 'claim_url', 'decision_note'],
  true,
  true
)
on conflict (key) do nothing;

insert into message_templates (key, category, name, description, subject, body_html, body_blocks, variable_keys, is_system, is_transactional)
values (
  'expense_claim_rejected',
  'membership',
  'Expense claim: declined',
  'Sent to the people who filled in an expense claim when staff decline it. Carries staff''s note.',
  'Your expense claim was declined',
  $body$<p>Hi {{first_name}},</p>
<p>{{organization_name}}'s expense claim for {{program_name}} was declined.</p>
<p>Why: {{decision_note}}</p>
<p>If you have questions, email us at info@campusstores.ca.</p>$body$,
  $blocks$[{"id":"hi","type":"text","html":"<p>Hi {{first_name}},</p>"},{"id":"what","type":"text","html":"<p>{{organization_name}}'s expense claim for {{program_name}} was declined.</p>"},{"id":"note","type":"text","html":"<p>Why: {{decision_note}}</p>"},{"id":"questions","type":"text","html":"<p>If you have questions, email us at info@campusstores.ca.</p>"}]$blocks$::jsonb,
  array['first_name', 'organization_name', 'program_name', 'claim_total', 'claim_url', 'decision_note'],
  true,
  true
)
on conflict (key) do nothing;

insert into message_templates (key, category, name, description, subject, body_html, body_blocks, variable_keys, is_system, is_transactional)
values (
  'expense_claim_approved',
  'membership',
  'Expense claim: approved',
  'Sent to the people who filled in an expense claim once it has every approval it needs.',
  'Your expense claim is approved',
  $body$<p>Hi {{first_name}},</p>
<p>{{organization_name}}'s expense claim for {{program_name}} is approved, for a total of {{claim_total}}.</p>
<p>Payment will be sent to {{payee_name}}.</p>
<div style="text-align:left;margin:16px 0;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="left" style="margin:0;">
    <tr>
      <td style="border-radius:6px;background-color:#EE2A2E;">
        <a href="{{claim_url}}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:Calibri,'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">View your claim</a>
      </td>
    </tr>
  </table>
</div>$body$,
  $blocks$[{"id":"hi","type":"text","html":"<p>Hi {{first_name}},</p>"},{"id":"what","type":"text","html":"<p>{{organization_name}}'s expense claim for {{program_name}} is approved, for a total of {{claim_total}}.</p>"},{"id":"pay","type":"text","html":"<p>Payment will be sent to {{payee_name}}.</p>"},{"id":"cta","type":"button","text":"View your claim","href":"{{claim_url}}","align":"left","color":"#EE2A2E"}]$blocks$::jsonb,
  array['first_name', 'organization_name', 'program_name', 'claim_total', 'claim_url', 'payee_name'],
  true,
  true
)
on conflict (key) do nothing;
