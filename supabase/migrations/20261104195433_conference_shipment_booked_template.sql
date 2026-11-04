-- "Your Purolator shipment from the conference", sent when a shipment is
-- booked at the shipping desk or on /me (notifyShipmentBooked,
-- lib/conference/shipping-notify.ts): to the person shipping AND every org
-- admin of their institution, in case the person who booked is not the one
-- who handles the invoice. The same message also goes to each of them in
-- Circle.
--
-- Shows Purolator's ESTIMATE, labelled as one. The actual charge arrives later
-- on CSC's invoice (or straight from Purolator on the institution's account).
--
-- Authored as body_blocks (body_html is their compiled output, so the
-- template editor round-trips it).

insert into message_templates (key, category, name, description, subject, body_html, body_blocks, variable_keys, is_system, is_transactional)
values (
  'conference_shipment_booked',
  'conference',
  'Conference: shipment booked',
  'Sent when a Purolator shipment is booked at the conference shipping desk or on /me: to the person shipping and to every org admin of their institution. Shows the estimate, clearly labelled; the actual charge comes later on an invoice.',
  'Your Purolator shipment from the conference: {{reference}}',
  $body$<p>Hi {{contact_name}},</p>
<p>{{shipper_name}} booked a Purolator shipment from the conference to {{destination}}.</p>
<p>Reference: {{reference}}<br>Service: {{service}}<br>Boxes: {{box_count}}<br>Tracking: {{tracking}}</p>
<p>Purolator's estimate: {{estimate}}, tax included. {{billing_line}}</p>
<div style="text-align:left;margin:16px 0;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="left" style="margin:0;">
    <tr>
      <td style="border-radius:6px;background-color:#EE2A2E;">
        <a href="{{shipments_url}}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:Calibri,'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">See the shipment</a>
      </td>
    </tr>
  </table>
</div>$body$,
  $blocks$[{"id": "hi", "type": "text", "html": "<p>Hi {{contact_name}},</p>"}, {"id": "what", "type": "text", "html": "<p>{{shipper_name}} booked a Purolator shipment from the conference to {{destination}}.</p>"}, {"id": "detail", "type": "text", "html": "<p>Reference: {{reference}}<br>Service: {{service}}<br>Boxes: {{box_count}}<br>Tracking: {{tracking}}</p>"}, {"id": "money", "type": "text", "html": "<p>Purolator's estimate: {{estimate}}, tax included. {{billing_line}}</p>"}, {"id": "cta", "type": "button", "text": "See the shipment", "href": "{{shipments_url}}", "align": "left", "color": "#EE2A2E"}]$blocks$::jsonb,
  array['contact_name', 'shipper_name', 'destination', 'reference', 'service', 'box_count', 'tracking', 'estimate', 'billing_line', 'shipments_url'],
  true,
  true
)
on conflict (key) do nothing;
