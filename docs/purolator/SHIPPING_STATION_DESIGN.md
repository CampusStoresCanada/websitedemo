# Conference Shipping Station: design

Status: draft for Steve, 2026-11-03. Nothing built yet.
Conference: Campus Stores Conference 2027, Feb 1–4, Hilton Toronto Airport.

## What it is

Attendees ship boxes home from the conference with Purolator. CSC books the shipment, prints the
labels at the station, pays Purolator, and invoices the attendee's institution **the amount
Purolator actually billed**, tax included as Purolator charged it. An institution with its own
Purolator account can ship on that instead, and then nobody invoices anything.

It replaces `csc-shipping-labels`, a separate app with no login that billed members on the estimate.
Last year: 6 shipments re-billed through CSC (about $502 estimated), 3 on institution accounts.

## What last year taught us (from the audit of the old app)

| Last year | This year |
|---|---|
| SOAP, hand-built XML, a library that broke namespaces, ~10 commits fighting labels | Purolator's REST API, typed from the OpenAPI specs in `docs/purolator/openapi/`, proven end to end in the sandbox on 2026-11-03 |
| One box per shipment (hardcoded) | N boxes per shipment; one tracking number and one label page per box |
| Invoiced the estimate, tax folded into one number | Store the quote with every tax line; invoice the actual bill |
| If Purolator failed, saved a fake tracking number and a made-up price, and invoiced it | A failed booking shows the error. Nothing is saved, nothing is billed |
| No login; anyone could type any account number onto an institution's record | Badge or `/me` identifies the person; only an institution's org admin sets its Purolator account |
| Walk-ins whose badge didn't match got a blank screen | Desk staff can book for anyone |
| Labels only emailed to the office | Labels print at the station |
| Secrets in an RTF file and in server logs | Secrets only in env, never logged |
| Last code change 6 days before the event | Freeze two weeks before (see Timeline) |

## How it fits the site (reuse, not new surfaces)

| Need | Existing piece |
|---|---|
| Who is shipping | `conference_people` (what the badge QR resolves to). Self-scan lands on `/me` (`ship/self-scan-purchase`, unmerged) |
| Where the attendee books | `/me` → `MyConferenceSection`, beside the things they can already buy for themselves |
| Staff booking, walk-ins | The check-in desk: desk-staff appointment + desk PIN (`lib/conference/desk-staff.ts`, `desk-pin.ts`) |
| Destination address | Defaults to the org's address on file; edits use the Google Places autocomplete (`lib/google/places.ts`) |
| Institution's own account | `organizations.purolator_account` (exists, unused, private). Edited by org admins through `updateField` like any org field |
| Invoicing the institution | The conference invoice path in `lib/actions/conference-commerce.ts` (Stripe invoice with tax lines → `invoices` row → org admins emailed → paid in `/org/billing`) |
| Into QuickBooks | The membership/partnership export (`lib/quickbooks/export.ts`), new invoice type `shipping` with its own QBO item |
| Failures | `raiseAlertIfNotOpen` ops alerts, as the QBO queues do |

Genuinely new: the Purolator module, the shipment tables, and the "enter actual charges" step.

## Data model

The old `shipments` table (42 rows, last write 2026-01-29, access already revoked) stays as a
read-only archive for last year's reconciliation. It is not reused: its columns encode the
one-box, bill-the-estimate model.

**`conference_shipments`** — one per booking
- `conference_id`, `conference_person_id` (who), `organization_id` (who pays), `booked_by` (profile; the attendee or a desk staffer)
- `billing_mode`: `csc_rebill` | `institution_account`
- `purolator_account` used (CSC's, or the institution's), `service_id`
- destination address fields, `attention_to`, phone
- `shipment_pin`, `status`: `booked` | `voided` | `billed` | `no_charge`
- `quote` jsonb — the full estimate returned at booking (base, each surcharge, each tax, total). What we told them, frozen.
- `actual` jsonb + `actual_entered_by/at` — what Purolator billed (subtotal, each tax, total)
- `invoice_id` → `invoices`
- `purolator_request_reference` (for Purolator support)

**`conference_shipment_packages`** — one per box
- `shipment_id`, `piece_number`, weight, dimensions, `package_pin`

The label PDF is fetched from Purolator on demand (by PIN) rather than stored. Our shipment id goes
in Purolator's `shipmentReference1` (it prints on the label as "REF:"), so their invoice can be
matched back to us.

## The Purolator module (`lib/purolator/`)

Four calls, nothing else on the site touches Purolator:

1. `estimate(shipment)` → every service with base, surcharges, taxes, total, delivery date
2. `book(shipment)` → validate first (`validateOnly`), then create; returns shipment PIN + one PIN per box + the rate
3. `labels(pin)` → one 4×6 thermal PDF, one page per box (`/ship/v1/documents`, `DomesticBillOfLadingThermal`)
4. `voidShipment(pin)` → cancel; free if it never entered Purolator's network

Plus a token cache (1-hour bearer token). Types generated from the specs; tests run against the real
sandbox responses saved on 2026-11-03. Known spec traps are written down in memory and will be
encoded in the module: street address lines are plain strings (the spec's schema is wrong), and
references reject `/`.

Env: `PUROLATOR_CLIENT_ID`, `PUROLATOR_CLIENT_SECRET`, `PUROLATOR_REST_API_KEY`,
`PUROLATOR_BILLING_ACCOUNT` (CSC's), `PUROLATOR_ENV` = `sandbox` | `production`. All server-only.

## Flows

**Before the conference: collect institution Purolator accounts**
- An optional item on the org admin's conference checklist: "Shipping boxes home? Add your Purolator
  account number and we'll ship on it." Reuses the checklist-task pattern (as the directory listing did),
  writes `organizations.purolator_account` through `updateField`.
- Mentioned in the pre-conference email so it's in before Feb 1, not typed at the station.

**Attendee, on `/me` (or by scanning their own badge)**
1. "Ship your boxes home" card appears during the conference.
2. Address prefilled from their institution; they confirm or edit.
3. Add boxes: weight (from the station scale) and size (standard box preset, or custom).
4. See the options, e.g. "Ground, about $219.89, arrives in 4 days · Express, about $510.26, arrives tomorrow".
   Wording: an estimate; the institution is billed Purolator's actual charge.
5. Confirm. The labels join the print queue (below).
6. Email to **the person who booked AND their institution's org admins** (in case the booker explodes
   into confetti): tracking number per box, destination, service, and **the estimate**, clearly labelled
   as an estimate. Never the final amount; that arrives later on the invoice.

**Desk staff**: same flow from the desk, choosing the person by badge scan or search. Covers walk-ins,
people without phones, and anyone who wants help. Desk PIN as for invoices.

**Shipping desk, built 2026-11-04** (`ship/shipping-station`, not pushed): `/admin/conference/<id>/shipping`,
a full-screen kiosk beside the check-in desk, linked from the War Room header. Desk staff only (same
appointment, same desk PIN). Scan a badge (never checks anyone in) or Find by name → address prefilled from
the institution → boxes (weight + preset size or custom) → Get prices → pick service → who pays (the
institution's own account if on file, else CSC) → Book. CSC-pays bookings need the staff PIN, as a desk
invoice does. Done screen opens the label PDF; Shipments lists every booking with Labels and Cancel.
Tables `conference_shipments` + `conference_shipment_packages` are live; ship-from address is
`conference_instances.shipping_origin` (set to the Hilton's 5875 Airport Rd for 2027). The sandbox bills
Purolator's test account (CSC's real number is "invalid" there); production bills `PUROLATOR_BILLING_ACCOUNT`.
**Print queue, built 2026-11-04:** booking queues a held `shipping_label` job on `badge_print_jobs`;
War Room → Print → Shipping labels → "Print the shipping labels" releases them; the station (now on
`brother_ql_next` + PyMuPDF) prints each 4×6 page centred on DK-1247 (1200×1822 dots, model QL-1110NWB).
A refusal (badge roll still in) puts them back to waiting. Cancelling a shipment cancels its labels.
Proven against a stand-in printer; the real QL and a barcode scan are for the dry run, and the station app
must be rebuilt.
Not yet: the `/me` card, emails, box presets confirmed.

**Printing the labels**
- Booking queues the shipment's label (one 4×6 page per box) on the existing print-station queue
  (`badge_print_jobs`, which already carries `onsite_reprint` stickers and `document` PDFs). Shipping
  labels become a third kind.
- War Room → Print tab gets one button: **"Print the shipping labels"**, releasing everything queued
  to the station. Same Brother QL-1110NWBc as the badges, loaded with Brother DK-1247 die-cut labels
  (103 × 164 mm). Purolator's label is 4×6 in (101.6 × 152.4 mm), so it fits the stock with a little to
  spare; the QL prints up to about 4 in wide.
- The print station must print a die-cut label page at its own size (today it prints stickers on the 62 mm
  continuous roll). That change lives in the station, which is partly unmerged (`ship/desk-at-the-cart`).
- To prove at the dry run: barcode scans and the label lines up on DK-1247. Purolator can also return PNG
  if the PDF route fights the printer.

**Cancel**: attendee or staff, same day, before pickup.

**Pickup**: one Purolator pickup per day from the venue, booked by staff (Purolator penalises a pickup
per label). The pickup API exists; could start as a phone call.

**Billing after the event: import Purolator's invoice**
1. Download the invoice data from Purolator's Billing Centre as CSV. Purolator documents an Invoice Viewer
   Tool that exports invoice files as CSV with chosen columns, and an automated EDI "Invoices Flat File (CSV)".
2. Upload it on an admin screen. Each line is matched to our shipment by tracking number (PIN), and by our
   reference if Purolator prints it on the invoice.
3. The screen shows each shipment's quote beside the actual: base, surcharges, each tax. Unmatched lines (Greg's
   envelope) are listed and ignored. Shipments with no line yet stay "awaiting bill".
4. "Invoice institutions" creates one invoice per institution: Purolator's actual subtotal plus its tax lines,
   through the existing conference invoice path.
5. Fallback if the CSV isn't usable: type the actuals in on the same screen.

**Build the importer against real data**: last January's Purolator invoice has the 6 re-billed shipments and
Greg's envelope in it. Downloading that CSV gives us a real file to build and test against, and we can check
the import reproduces Ewa's numbers.

## Decided (Steve, 2026-11-03)

1. **Who books:** both. Attendees on `/me`, desk staff for anyone.
2. **Attendee can commit their institution:** yes. Booking emails tracking and the estimate (never the final
   amount) to the booker and the org admins.
3. **Ship on the institution's own account:** yes, collected before the conference through the org admin
   checklist and the pre-conference email. Needs Purolator to confirm our key can book on another account
   (`paymentType: THIRDPARTY` exists in the spec). Last year 3 of 9 used it.
4. **Printing:** the badge printer (Brother QL-1110NWBc) on DK-1247 103 × 164 mm labels, through the existing
   print-station queue, released by a "Print the shipping labels" button in War Room.
5. **Actuals:** import Purolator's invoice CSV; typing is the fallback.

## Which open questions change what we build (2026-11-04)

| Question | Changes the build? | Status |
|---|---|---|
| Dates (Stripe = QBO) | No. The station makes a Stripe invoice; when it reaches QBO is the site-wide QBO change | Settled by Ewa |
| 5255 account, tax as separate lines | No. The account is a QBO item picked in settings; one line per Purolator charge is built either way | Ewa, Nov 6 |
| Booking on an institution's account | **Yes**, it's one of the two billing modes. Sandbox 2026-11-04: `paymentType: THIRDPARTY` with a valid account validates; a made-up account is rejected ("Billing account number … is invalid"). `RECEIVER` was rejected for the test account. So we use THIRDPARTY, and we can **check the number when the org admin enters it** (a `validateOnly` call) instead of finding out at the desk | Works in sandbox; Purolator to confirm for production |
| One printer swapping rolls, or a second QL for shipping | **Yes**. The station has one QL setting, hardcoded to the 62 mm roll | **One printer, swap rolls** (Steve, 2026-11-04). The station already reports the loaded media; shipping jobs print only when DK-1247 is loaded and wait otherwise, so the button is: swap roll, press "Print the shipping labels", swap back |
| Label stock 103 × 164 | **Yes, small**. The station's library (`brother-ql` 0.9.4) has no 103 × 164 label; `brother_ql_next` 0.12 does (1200 × 1822 dots, and Purolator's 4 × 6 is 1200 × 1800 at 300 dpi, so it fits). Station swaps library and gains a die-cut job kind | Known |
| Self-scan on `/me` | Somewhat. `ship/self-scan-purchase` is unmerged (2 commits). Without it attendees book from `/me` by logging in, not by scanning their badge | Unmerged branch |
| Purolator invoice CSV columns | Yes, but only the importer, which is Feb/March work | Download January's CSV |
| Production key, venue pickup | No. Go-live and operations | Purolator |

## For Ewa

Proposed: shipping re-bills go to **`5255 GENERAL EXPENSES:Reimburseable (Purolator)`** so they net against the
Purolator cost, with our normal treatment of every tax as its own line, matching the Purolator bill exactly.

**Dates: settled by Ewa (2026-11-03).** "The invoice should be recorded with the same date it goes out to the
customer." Shipping invoices follow the site-wide change in `docs/quickbooks/ISSUE_DATE_POSTING_DESIGN.md`:
posted to QBO the day Stripe issues them, payments recorded separately. Still to confirm on Nov 6: 5255 and the
tax lines.

## For Purolator (account manager / webservices@purolator.com)

1. Production REST key: how long, and what they need from us.
2. Can our REST app book on a member institution's own account (third-party billing)?
3. Do our shipment/package references appear on the invoice? Is the Invoice Viewer Tool (CSV export) available
   on our account, and does it give actual charges and taxes per PIN?
4. Pickup from the venue Feb 1–4: book via API or by phone?

## Timeline (conference Feb 1–4, 2027)

- **Now**: send Purolator the questions; production key takes days to weeks.
- **November**: Purolator module + tables + `/me` and desk flows, on sandbox.
- **Early December**: production key; one real end-to-end shipment (a box to the office) to check rates,
  labels and the bill.
- **Mid-January**: code freeze. Station dry run with the printer and scale.
- **Feb 1–4**: live.
- **February/March**: enter actuals from Purolator's invoice; invoice institutions.

## Not in scope this year

Returns, international shipping, freight, dangerous goods, Express Cheque.
