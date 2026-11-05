-- ⛔ APPLY AT SHIP, with the code that stops asking schools how they want to be
-- paid (the request form no longer offers "CSC pays in advance").
--
-- The board's comments on the announcement (Shawn Davies, Karin Stonehouse,
-- 2026-11-05), adopted by Steve:
-- 1. Reimbursement is the default. Paying in advance is no longer a choice on
--    the request; a school that can't manage reimbursement emails the board.
--    Requests already in keep what they chose.
-- 2. Daily driving is covered. Mileage is the total distance driven to and from
--    the conference, including a daily round trip for a delegate who drives in
--    instead of staying at the hotel.
-- Schools and delegates that agreed to v3 are asked again, on their request
-- page and their agenda, the same way v3 asked those who agreed to v2.

insert into public.conference_legal_versions (conference_id, document_type, version, content, effective_at, policy_entity_id)
values (
  '7e650b08-51d1-4573-a332-7d6b6fbc50bd',
  'travel_bursary_terms',
  4,
  $terms$<p>Campus Stores Canada offers travel support to help member institutions send a delegate to the 2027 Campus Stores Conference. These terms apply to any support you request.</p><h2>What is covered</h2><ul><li><p>Hotel: three nights at the Hilton Toronto Airport Hotel &amp; Suites, at the conference rate, in a standard single-occupancy room, at $185 a night plus room tax ($664.78 for three nights). A fourth night is covered when your delegate cannot get home to campus before midnight local time on Thursday, February 4, 2027. Your request page shows how many nights your institution is covered for. The most we cover is $886.37, for four nights. Parking at the hotel is included with your room nights. Upgrades, additional guests and any charge above that rate are not covered.</p></li><li><p>Travel: one of the following:</p><ul><li><p>Air: economy fare for one round trip, and one checked bag. Additional bags, seat selection and other extras are not covered. The conference ends at 3:00 pm on Thursday, February 4. Book a flight home leaving Toronto Pearson at 4:30 pm or later; the hotel will hold your bags and the shuttle will take you to the airport.</p></li><li><p>Train: economy fare for one round trip.</p></li><li><p>Mileage: paid at the federal rate, for the total distance you drive to and from the conference, including each day's round trip if you drive in daily instead of staying at the hotel.</p></li></ul></li></ul><h2>What is not covered</h2><ul><li><p>Incidentals, including local transportation to and from Toronto Pearson airport, airport parking, meals and other purchases while travelling, and any expense not listed above.</p></li><li><p>Travel between your campus and the airport you fly from. If that cost is a real barrier, tell us in your request.</p></li></ul><h2>If you need more help</h2><p>If cost is still a barrier after this support, tell us in your request what you need. CSC's Board of Directors considers these requests one at a time. We cannot promise to meet every request.</p><h2>Attending your meetings</h2><p>This support is given so that your delegate can meet the partners scheduled with them.</p><ul><li><p>Your delegate must attend every partner meeting CSC assigns to them, for its full scheduled time. If your conference registration is funded by CANCOLL, this also includes the CANCOLL Annual General Meeting on February 3, 2027.</p></li><li><p>Your delegate agrees to these terms themselves, on their own conference page.</p></li><li><p>If your delegate cannot attend, another qualified person from your institution may attend in their place. Tell CSC as soon as you can. You can name a different delegate until January 17, 2027. After that, contact CSC and we will do our best.</p></li><li><p>If an assigned meeting is missed without a reasonable excuse, such as illness or a travel disruption, CSC will invoice your institution for the full value of the support provided. That includes the conference registration fee and any hotel and travel costs CSC has paid or reimbursed.</p></li></ul><h2>Payment</h2><ul><li><p>CSC reimburses your hotel and travel after the conference. If paying up front is a problem for your institution, email board@campusstores.ca and we may be able to help.</p></li><li><p>Reimbursement is paid by cheque, to your institution or to you personally, within 90 days of the end of the conference.</p></li></ul><h2>Claims</h2><ul><li><p>Submit all expenses for approval within 30 days of the end of the conference.</p></li><li><p>Every expense needs a receipt from a reputable source. An expense without one can be claimed only with the approval of CSC's Board of Directors.</p></li><li><p>Every claim is reviewed and approved by two people at CSC, who may ask for more information.</p></li></ul><h2>Limits of responsibility</h2><ul><li><p>CSC is not responsible for flight delays, cancellations or missed connections, or for any cost that results from them.</p></li><li><p>CSC is not liable for additional costs you incur beyond what is covered above.</p></li><li><p>CSC is not responsible for being unable to provide support because of events beyond its reasonable control, including severe weather, public health measures, government action, or disruption to travel or the venue.</p></li></ul><p>By requesting support, you agree to these terms.</p>$terms$,
  now(),
  '99ffeb52-680d-4c5e-8e7d-711b5f328f64'
);

-- The claim form's help text: mileage is a total now, and the hotel line still
-- carried v2's $665 although the cap itself has been $886.37 since v3.
update public.expense_program_categories c
set help = case c.key
  when 'mileage' then 'Your total driving to and from the conference, including each day''s round trip if you drive in instead of staying at the hotel, at $0.73 per kilometre.'
  when 'hotel' then 'CSC covers three hotel nights, or four when your delegate can''t get home to campus before midnight on Thursday, to a maximum of $886.37 including tax. Parking at the hotel is included with your room nights.'
end
from public.expense_programs p
where p.id = c.program_id and p.slug = 'travel-bursary-2027' and c.key in ('mileage', 'hotel');

-- The "received" email no longer mentions paying in advance: a school can't
-- ask for it on the request any more.
update public.message_templates
set body_blocks = replace(body_blocks::text, ' If you asked us to pay in advance, we will be in touch to book with you.', '')::jsonb,
    body_html = replace(body_html, ' If you asked us to pay in advance, we will be in touch to book with you.', ''),
    updated_at = now()
where key = 'bursary_request_received';
