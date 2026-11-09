-- "Your updated receipt", sent to the buyer on the order's original payment
-- confirmation when staff change one of its registrations
-- (changeRegistration, lib/actions/conference-registration-change.ts). The
-- person on the ticket gets their registration confirmation again, showing
-- the new registration; this one is for whoever paid.
--
-- Stripe's own receipt cannot be reissued, and it still names what was
-- bought. This lists the order as it stands now, with the changed line marked.
--
-- Authored as body_blocks (body_html is their compiled output, so the
-- template editor round-trips it).

insert into message_templates (key, category, name, description, subject, body_html, body_blocks, variable_keys, is_system, is_transactional)
values (
  'conference_order_updated',
  'conference',
  'Conference: updated receipt',
  'Sent to the buyer when staff change a registration on their conference order, such as a day pass bought for the wrong day. Lists the order as it stands now; no money moves.',
  'Your updated receipt for the {{conference_year}} CSC Conference',
  $body$<p>Hi {{contact_name}},</p>
<p>Here is your updated conference receipt. {{change_line}}</p>
<p>Order reference: {{order_ref}}<br>{{order_lines}}</p>
<div style="text-align:left;margin:16px 0;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="left" style="margin:0;">
    <tr>
      <td style="border-radius:6px;background-color:#EE2A2E;">
        <a href="{{my_conference_url}}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:Calibri,'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">View My Conference</a>
      </td>
    </tr>
  </table>
</div>
<p>Questions? info@campusstorescanada.ca</p>$body$,
  $blocks$[{"id": "hi", "type": "text", "html": "<p>Hi {{contact_name}},</p>"}, {"id": "what", "type": "text", "html": "<p>Here is your updated conference receipt. {{change_line}}</p>"}, {"id": "lines", "type": "text", "html": "<p>Order reference: {{order_ref}}<br>{{order_lines}}</p>"}, {"id": "cta", "type": "button", "text": "View My Conference", "href": "{{my_conference_url}}", "align": "left", "color": "#EE2A2E"}, {"id": "help", "type": "text", "html": "<p>Questions? info@campusstorescanada.ca</p>"}]$blocks$::jsonb,
  array['contact_name', 'conference_year', 'change_line', 'order_ref', 'order_lines', 'my_conference_url'],
  true,
  true
)
on conflict (key) do nothing;
