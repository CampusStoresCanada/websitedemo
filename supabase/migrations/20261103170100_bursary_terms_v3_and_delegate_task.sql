-- ⛔ APPLY AT SHIP, with the code that reads it (ship/bursary-pre-announcement).
-- The deployed site before that would show the delegate task below to EVERY
-- delegate (it does not know scope_designation), and would send the new
-- "received" email without its hotel_nights_text value.
--
-- 1. Travel Bursary Terms v3 (Steve, 2026-11-02): three nights, a fourth when
--    the delegate can't get home to campus before midnight Thursday, at most
--    $886.37; fly home at 4:30 pm or later; the drive to your own airport is
--    not covered, ask in the request; two people at CSC approve each claim.
--    Schools that agreed to v2 are asked again on their request page.
-- 2. Every supported delegate agrees to the terms themselves, on their own
--    agenda. CANCOLL-funded delegates already have their consent task
--    (scoped to the funded registration); this one is for the others.
-- 3. The "received" email carries what "approved" used to: there is no board
--    gate any more (Steve, 2026-11-02: approve on the uploaded expenses).

insert into public.conference_legal_versions (conference_id, document_type, version, content, effective_at, policy_entity_id)
values (
  '7e650b08-51d1-4573-a332-7d6b6fbc50bd',
  'travel_bursary_terms',
  3,
  $terms$<p>Campus Stores Canada offers travel support to help member institutions send a delegate to the 2027 Campus Stores Conference. These terms apply to any support you request.</p><h2>What is covered</h2><ul><li><p>Hotel: three nights at the Hilton Toronto Airport Hotel &amp; Suites, at the conference rate, in a standard single-occupancy room, at $185 a night plus room tax ($664.78 for three nights). A fourth night is covered when your delegate cannot get home to campus before midnight local time on Thursday, February 4, 2027. Your request page shows how many nights your institution is covered for. The most we cover is $886.37, for four nights. Parking at the hotel is included with your room nights. Upgrades, additional guests and any charge above that rate are not covered.</p></li><li><p>Travel: one of the following, for one round trip:</p><ul><li><p>Air: economy fare and one checked bag. Additional bags, seat selection and other extras are not covered. The conference ends at 3:00 pm on Thursday, February 4. Book a flight home leaving Toronto Pearson at 4:30 pm or later; the hotel will hold your bags and the shuttle will take you to the airport.</p></li><li><p>Train: economy fare.</p></li><li><p>Mileage: paid at the federal rate, using the calculated distance from your store to the hotel and back. Daily commuting is not covered.</p></li></ul></li></ul><h2>What is not covered</h2><ul><li><p>Incidentals, including local transportation to and from Toronto Pearson airport, airport parking, meals and other purchases while travelling, and any expense not listed above.</p></li><li><p>Travel between your campus and the airport you fly from. If that cost is a real barrier, tell us in your request.</p></li></ul><h2>If you need more help</h2><p>If cost is still a barrier after this support, tell us in your request what you need. CSC's Board of Directors considers these requests one at a time. We cannot promise to meet every request.</p><h2>Attending your meetings</h2><p>This support is given so that your delegate can meet the partners scheduled with them.</p><ul><li><p>Your delegate must attend every partner meeting CSC assigns to them, for its full scheduled time. If your conference registration is funded by CANCOLL, this also includes the CANCOLL Annual General Meeting on February 3, 2027.</p></li><li><p>Your delegate agrees to these terms themselves, on their own conference page.</p></li><li><p>If your delegate cannot attend, another qualified person from your institution may attend in their place. Tell CSC as soon as you can. You can name a different delegate until January 17, 2027. After that, contact CSC and we will do our best.</p></li><li><p>If an assigned meeting is missed without a reasonable excuse, such as illness or a travel disruption, CSC will invoice your institution for the full value of the support provided. That includes the conference registration fee and any hotel and travel costs CSC has paid or reimbursed.</p></li></ul><h2>Payment</h2><ul><li><p>You can ask CSC to pay your hotel or travel in advance, or be reimbursed after the conference. Reimbursement is preferred.</p></li><li><p>Reimbursement is paid by cheque, to your institution or to you personally, within 90 days of the end of the conference.</p></li></ul><h2>Claims</h2><ul><li><p>Submit all expenses for approval within 30 days of the end of the conference.</p></li><li><p>Every expense needs a receipt from a reputable source. An expense without one can be claimed only with the approval of CSC's Board of Directors.</p></li><li><p>Every claim is reviewed and approved by two people at CSC, who may ask for more information.</p></li></ul><h2>Limits of responsibility</h2><ul><li><p>CSC is not responsible for flight delays, cancellations or missed connections, or for any cost that results from them.</p></li><li><p>CSC is not liable for additional costs you incur beyond what is covered above.</p></li><li><p>CSC is not responsible for being unable to provide support because of events beyond its reasonable control, including severe weather, public health measures, government action, or disruption to travel or the venue.</p></li></ul><p>By requesting support, you agree to these terms.</p>$terms$,
  now(),
  '99ffeb52-680d-4c5e-8e7d-711b5f328f64'
);

with cl as (
  insert into public.conference_checklists (conference_id, name, deadline_at, active)
  values ('7e650b08-51d1-4573-a332-7d6b6fbc50bd', 'Travel bursary delegates', '2027-01-17', true)
  returning id
)
insert into public.conference_checklist_tasks
  (checklist_id, name, description, check_type, check_entity_id, audience, scope_designation, deadline_at, sort_order)
select cl.id,
  'Agree to the Travel Bursary Terms',
  'Your institution asked for travel support for you. Read what it covers and what it asks of you, including attending every meeting assigned to you, and agree.',
  'legal_document_accepted',
  '99ffeb52-680d-4c5e-8e7d-711b5f328f64',
  'person',
  'bursary_delegate',
  '2027-01-17',
  0
from cl;

update public.message_templates
set body_blocks = $blocks$[{"id": "hi", "type": "text", "html": "<p>Hi {{first_name}},</p>"}, {"id": "what", "type": "text", "html": "<p>Thank you. Campus Stores Canada has received {{organization_name}}'s travel bursary request for {{conference_name}}. There is no separate approval to wait for: your request is in, and you can go ahead and plan your delegate's trip under the Travel Bursary Terms. We'll contact you only if something in it needs a closer look.</p>"}, {"id": "hotel", "type": "text", "html": "<p>Your hotel support is {{hotel_nights_text}}. The conference ends at 3:00 pm on Thursday, February 4. Please book a flight home leaving Toronto Pearson at 4:30 pm or later.</p>"}, {"id": "attend", "type": "text", "html": "<p>Your delegate must attend every partner meeting assigned to them. If a meeting is missed without a reasonable excuse, your institution will be invoiced for the full value of the support. If your delegate can't attend, another qualified person from your institution may go in their place. You can change who the support is for on your request page until January 17, 2027.</p>"}, {"id": "claim", "type": "text", "html": "<p>After the conference, file your expense claim on your request page. Claims open {{claims_open_date}} and close {{claims_close_date}}. Every expense needs a receipt. If you asked us to pay in advance, we will be in touch to book with you.</p>"}, {"id": "cta", "type": "button", "text": "Open your request", "href": "{{request_url}}", "align": "left", "color": "#EE2A2E"}]$blocks$::jsonb,
    body_html = $body$<p>Hi {{first_name}},</p>
<p>Thank you. Campus Stores Canada has received {{organization_name}}'s travel bursary request for {{conference_name}}. There is no separate approval to wait for: your request is in, and you can go ahead and plan your delegate's trip under the Travel Bursary Terms. We'll contact you only if something in it needs a closer look.</p>
<p>Your hotel support is {{hotel_nights_text}}. The conference ends at 3:00 pm on Thursday, February 4. Please book a flight home leaving Toronto Pearson at 4:30 pm or later.</p>
<p>Your delegate must attend every partner meeting assigned to them. If a meeting is missed without a reasonable excuse, your institution will be invoiced for the full value of the support. If your delegate can't attend, another qualified person from your institution may go in their place. You can change who the support is for on your request page until January 17, 2027.</p>
<p>After the conference, file your expense claim on your request page. Claims open {{claims_open_date}} and close {{claims_close_date}}. Every expense needs a receipt. If you asked us to pay in advance, we will be in touch to book with you.</p>
<div style="text-align:left;margin:16px 0;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="left" style="margin:0;">
    <tr>
      <td style="border-radius:6px;background-color:#EE2A2E;">
        <a href="{{request_url}}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:Calibri,'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Open your request</a>
      </td>
    </tr>
  </table>
</div>$body$,
    variable_keys = array['first_name', 'organization_name', 'conference_name', 'request_url', 'hotel_nights_text', 'claims_open_date', 'claims_close_date'],
    updated_at = now()
where key = 'bursary_request_received';

-- 4. Who CANCOLL's invoice goes to (Steve, 2026-11-03): Lorraine Hamilton,
--    copying Greg McPherson and Kelly Abraham. Read by
--    lib/conference/cancoll-report.ts. The addresses are MOU Schedule A's
--    notice contacts and Kelly's current TMU address.
update public.conference_entities
set attributes = attributes || jsonb_build_object(
  'invoice_to', 'busdevmgr@cancoll.ca',
  'invoice_contact_name', 'Lorraine',
  'invoice_cc', jsonb_build_array('greg@campusstores.ca', 'kabraham@torontomu.ca')
)
where id = 'faff5494-27b5-4587-981a-037103a642cc';

-- 5. MOU Schedule B: each supported delegate gets, in writing and before the
--    conference, their schedule, the attendance standard and the financial
--    consequence of missing it. The "your schedule is ready" email carries it
--    as {{attendance_terms}}, blank for everyone else
--    (attendanceTermsHtml in lib/conference/bursary-request.ts). This template
--    is stored as HTML with no blocks, so the variable goes into the HTML.
update public.message_templates
set body_html = replace(
      body_html,
      'scheduled across <strong>{{day_count}} days</strong>.</p>',
      'scheduled across <strong>{{day_count}} days</strong>.</p>' || chr(10) || '  {{attendance_terms}}'
    ),
    variable_keys = array_append(variable_keys, 'attendance_terms'),
    updated_at = now()
where key = 'conference_schedule_ready'
  and body_html not like '%{{attendance_terms}}%';
