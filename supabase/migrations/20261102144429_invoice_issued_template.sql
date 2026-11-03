-- "Your invoice is ready", sent to EVERY active org admin when an invoice is
-- finalized (finalizeAndSendInvoice, lib/stripe/billing.ts).
--
-- Replaces Stripe's own invoice email, which could only reach one address: the
-- Stripe customer's, which was the org's oldest admin. Stephen, 2026-10-30: one
-- Stripe customer per org, the invoice goes to all admins, and whoever clicks
-- through to pay is the person on the Stripe session and gets the receipt.
--
-- The button goes to /org/billing, not to Stripe. The Pay button there puts the
-- clicking admin's email on the org's Stripe customer before handing them to
-- Stripe's pay page, which is what routes the receipt to them.
--
-- Authored as body_blocks (body_html is their compiled output, so the
-- template editor round-trips it).

insert into message_templates (key, category, name, description, subject, body_html, body_blocks, variable_keys, is_system, is_transactional)
values (
  'invoice_issued',
  'renewal',
  'Billing: invoice ready',
  'Sent to every org admin when a Campus Stores Canada invoice is issued to their organization. Links to the organization''s billing page, where any admin can pay it.',
  'Your Campus Stores Canada invoice for {{org_name}}',
  $body$<p>Hi {{contact_name}},</p>
<p>Campus Stores Canada has issued an invoice to {{org_name}}.</p>
<p>{{invoice_description}}<br>Amount: {{invoice_amount}}<br>Due: {{due_date}}</p>
<p>Any admin for {{org_name}} can pay it. The receipt goes to whoever pays.</p>
<div style="text-align:left;margin:16px 0;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="left" style="margin:0;">
    <tr>
      <td style="border-radius:6px;background-color:#EE2A2E;">
        <a href="{{invoice_url}}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:Calibri,'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">View and pay</a>
      </td>
    </tr>
  </table>
</div>$body$,
  $blocks$[{"id": "hi", "type": "text", "html": "<p>Hi {{contact_name}},</p>"}, {"id": "what", "type": "text", "html": "<p>Campus Stores Canada has issued an invoice to {{org_name}}.</p>"}, {"id": "detail", "type": "text", "html": "<p>{{invoice_description}}<br>Amount: {{invoice_amount}}<br>Due: {{due_date}}</p>"}, {"id": "who", "type": "text", "html": "<p>Any admin for {{org_name}} can pay it. The receipt goes to whoever pays.</p>"}, {"id": "cta", "type": "button", "text": "View and pay", "href": "{{invoice_url}}", "align": "left", "color": "#EE2A2E"}]$blocks$::jsonb,
  array['contact_name', 'org_name', 'invoice_description', 'invoice_amount', 'due_date', 'invoice_url'],
  true,
  true
)
on conflict (key) do nothing;
