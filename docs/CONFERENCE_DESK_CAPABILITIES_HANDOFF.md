# Conference Desk Handoff (Technical)

Rewritten 2026-10-19 after Stephen's decisions. The first version of this doc
proposed four per-conference switches, a new `desk_capabilities` column, a
settings editor and a desk sell control. None of that was built, on purpose —
see §5 for why each one was a second copy of something that already existed.

Everything below is on branch `ship/desk-at-the-cart`, **pushed for a preview
only, not merged to `main`**. Stephen wants the desk fully developed before it
ships. Every database change from it is already live, because prod and local
share one database (§4). Since 2026-10-19 the branch also carries the merged
`ship/cart-shared-email` (online cart and Add contact on the same shared-address
rules).

**Preview:** https://websitedemo-f9ao3k4gj-steve-thomas-projects-70bd4294.vercel.app
(commit `d60222e`; each push to the branch builds a new one).

**Status 2026-10-19:** ✅ scanning proven on a real device — three test-mode
scans at 3:58–4:00 pm MT (Full Conference and Thursday Only checked in; a
repeat came back "already checked in"). ✅ PIN set, five-wrong-try lockout,
sign back in and choose a new PIN — all ran on the laptop.

**Before merging to `main`:** the rest of §3a on a device (PIN and hand-over,
a real sale, naming a walk-up without an email). About half this branch is not
the desk and touches every member: the sign-in step that claims conference
registrations, the contact editor on every company page, the online cart, and
the nightly grace-check job (which now ends expired org links).

**Next:** the alternate versions of the desk. This is the most full-featured
one; before building any other, sort each into "this desk with fewer tools"
or "genuinely different" with Stephen (repo rule: ask before building new).

## 1. Decisions (Stephen, 2026-10-19)

1. **Desk sales, invoicing, reprints, labels and self-purchase are core
   conference functionality.** No per-conference on/off switches.
2. **Desk staff can buy for any organisation**, and invoice an existing one.
3. **`ship/self-scan-purchase` merges** (on this branch). Self-scan lands on
   `/me` with the purchase block.
4. **Desk staff OPERATE a conference, never design it.** Desk, war room,
   roster, storefront and seats — yes. Badges, catalogue, prices, schedule ops
   — admins only.
5. **Desk staff are assigned per conference**, from the conference itself,
   optionally for specific days. Blank days follow the conference's dates.
   "Allow permanent access" is for permanent staff (Carolyn).
6. **Volunteers and temps are added as staff of the staff organisation** (CSC,
   type `Staff`), with a login (password set on invite) and a Circle account,
   like any other invite. Their staff link ends after their last day.
7. **Kiosk / hand-over, with a desk PIN** — each staff member has their own
   4–6 digit PIN, set on first use of the desk after a password sign-in. It
   guards two things only: unlocking the desk after a hand-over, and approving
   an invoice. Forgot it: sign in with the password again and choose a new
   one; an admin can also clear it from the Desk staff list. Five wrong tries
   clear it and sign the desk out. Built — see §2.

## 2. What is built

### Selling at the desk = the storefront

A walk-up is a sale, then a seat, then a badge.

- Desk **Find** (bottom bar, always there) matches names, emails and
  **company names**. A company with open registration seats shows them;
  **Name someone** calls the same `addConferenceAttendee` + `allocateSeat` the
  company's own seat matrix uses.
- Nobody matches → **"Not registered? Sell them a registration"** opens the
  ordinary offers page; staff get the company picker; name them in the cart;
  card or invoice.

`requireOrgCommerceAccess(organizationId, conferenceId)` in `lib/auth/guards.ts`
is the one rule for every storefront action: global admin, member of the org,
or that conference's desk staff. ⛔ Invoicing is a second check inside
`createConferenceCheckout` (desk access for that conference), refused before
any write.

### Reprints — one stock rule

`suggestStock` (`lib/conference/badges/reprint-plan.ts`) is the only answer to
"which card do I reach for": company blank → a spare of **their** registration
type → full badge. The desk card shows it and the reprint request carries it.
`reprintModeForOrganization` and `assessReprintForPerson` were deleted.

### Desk staff

| Piece | Where |
|---|---|
| Add / remove | Days & Setup → **Desk staff** (`DeskStaffPanel`, `lib/actions/conference-desk-staff.ts`) |
| Who holds it today | `holdsDeskStaff` / `deskAppointmentActive` in `lib/conference/desk-staff.ts` |
| The doors | `requireConferenceDeskAccess(conferenceId)` (logs refusals), `isConferenceDeskStaff` (quiet, for what a page shows) |
| Which admin pages they reach | `CONFERENCE_DESK_SEGMENTS` in `lib/admin/nav.ts` — desk and war room only |
| Their way in | "Check-in desk" card on `/me` while they hold access today |

Stored as `governance_role_assignments` rows (role `conference_desk_staff`,
capability `conference.desk_staff`, body `conference_operations`) with the new
`conference_id` column:

| Kind | Stored | Active when |
|---|---|---|
| Specific days | conference, term_start, term_end (EXCLUSIVE) | today in [start, end) |
| Blank | conference, no term_end | registration open → conference's last day, **read fresh each check** |
| Permanent | no conference, no term_end | always, every conference |

⛔ "Today" is the conference's own date in its time zone
(`conference_instances.timezone`), not the database's UTC `CURRENT_DATE` — that
would end a Wednesday shift at 8pm in Ontario.

`requireConferenceOpsAccess()` (badges, schedule ops, legal, scheduler) now
means global admin only; the empty "masthead" organisation allowlist it used to
consult is deleted from code.

### A person's link to an organisation can end

`user_organizations.expires_at` (EXCLUSIVE; NULL = follows the organisation).

- Sign-in ignores a link from its end date (server and browser, one filter:
  `lib/auth/org-link.ts`).
- The nightly `grace-check` cron marks expired links inactive through the same
  off switch as Deactivate (`lib/org/org-link-lifecycle.ts`), including Circle
  removal, without the removal email.
- Add Staff gives a temp's staff link an end the day after their last day.
  ⛔ It never adds or shortens an end date on an active link that has none —
  that is a permanent staffer (`staffLinkEndDecision`, tested).

### The desk PIN and hand-over

- Rules: `lib/conference/desk-pin.ts` (scrypt hash, 5 tries,
  `deskPinChangeAllowed`). Server: `lib/actions/desk-pin.ts`. Screens:
  `components/admin/conference/DeskPinPad.tsx`. Table `desk_pins` — RLS on,
  no policies, service role only; never the digits.
- ⛔ Choosing ANY PIN (even a first one) needs a password sign-in in the last
  15 minutes, or the current PIN. Otherwise five wrong guesses (which delete
  the PIN) would become a reset anyone holding the iPad could use. "Recent" is
  read from the session's own sign-in time (`amr` in the token,
  `signedInRecently` in guards).
- Invoice: "Invoice the company instead" asks for the PIN first.
- Hand-over: "Pay on this device" notes the sale in this browser
  (`desk-handover:<conference>`), then goes to Stripe. Success and cancel both
  bring staff back to the desk, which is locked behind the PIN — a reload
  stays locked. Unlocked, it checks the sale: paid shows the print cards; not
  paid closes the card link and shows a red "Not paid" card.
- ⚠️ What the PIN cannot stop: while the customer holds the iPad on Stripe's
  page, the browser is signed in as staff. Typing an admin address into the
  URL bar would open it. Use **iPad Guided Access** (Settings → Accessibility)
  during hand-over to pin the iPad to the browser and hide the address bar.
  Desk staff who are not admins can only reach the desk anyway.

### Fixed: Deactivate never worked

The org user table's Deactivate button sets status `inactive`, which the
`user_organizations` check constraint did not allow: zero deactivations ever
succeeded since 2026-08-17. Constraint widened (live). Re-inviting also clears a
stale end date.

## 3. Still open

- **Name-only walk-ups: built 2026-10-19.** The desk may skip the email. The
  person gets a NEW record (never matched by name), so their badge prints, but
  no login and no Circle; their company's org admins get the
  `conference_walkup_without_email` heads-up (`recordNameOnlyWalkUp`). Test
  organisations get no email (the org-admin audience skips them).

- **Second label (John's back QR code)** — `renderReprintLabel` is reachable only
  from the job PDF route, and `badge_print_stock` is `NULL` for CSC 2027, so no
  spares print yet.
- **New temps show by email** until they edit their profile: Add Staff uses the
  "Invite user" path, which takes an email only.
- **A temp's staff-link end date is set when they are added**; if the conference
  later runs longer, desk access follows it but the link (staff pricing only)
  does not.
- **Four empty "Conference Ops Masthead Org IDs" rows** still show in Settings
  (`policy_values`); nothing reads them. Deleting them is Stephen's call.
- **`requireConferenceOpsAccess` is a misleading name** now that it means global
  admin; renaming touches ~30 files.

## 3c. Printing: the last mile (built 2026-10-20)

Until now the desk queued reprint jobs that nothing at the desk could print:
the job's page served only the full colour badge (the QL cannot print it), it
was admin-only, and `requestBadgeReprint` refused every non-admin. The label
renderer for the QL-1110NWBc on DK-2113 62 mm was written and never served.

- **Printer:** Brother QL-1110NWBc, AirPrint over Wi-Fi (same network as the
  device), DK-2113 frosted clear continuous 62 mm. Stickers go on a company
  blank or a spare card: front (name, title; company too on a spare) and back
  (the QR).
- **One job per reprint** (`?side=all`, `combineStickerDocuments`): every
  sticker in one document, each its own named page at its own length, so the
  auto-cut separates them with no padding. The print station always uses it.
- **Print now** (any device): the reprint card has "Print now: all stickers",
  plus one-at-a-time links as the fallback →
  `…/badges/jobs/[jobId]/pdf?side=front|back&print=1`, the sticker at its own
  `@page` size, print dialog opens itself. iPad/iPhone: AirPrint → the QL.
- **Send to print queue**: the job becomes `printer_bridge` / `sent_to_printer`
  (columns that existed with no consumer). The **print station**
  (`/admin/conference/[id]/check-in/print-station`, toolkit → "Open the print
  station") runs on the laptop beside the QL and prints each sticker, front then
  back, then marks it printed. QL = the laptop's default printer; Chrome started
  with `--kiosk-printing` prints with no dialog.
- Desk staff may now reprint, queue, and open their conference's reprint
  stickers. The full badge document stays admin-only.
- **Print stock for CSC 2027 set 2026-10-20** (Stephen): spares on, 20% for
  exhibitors and members, member minimum 35. On today's numbers: 48 exhibitor +
  35 member = 83 spares (20% overtakes the 35 minimum at 175 named members).
  Change it on the conference's Badges page → print stock. Company blanks are
  separate: one per unnamed seat, automatically.
- ⛔ **Spares are generic, one stack per badge LOOK** (Stephen, 2026-10-20: "the
  guessing was fun, but it was never gonna work"). A spare prints with its
  schedule area EMPTY; when the desk uses one it prints TWO stickers: the front,
  and one back sticker carrying the person's schedule above the QR, each at its
  place on the card (Stephen: two stickers, not three). CSC 2027 has two looks → two stacks:
  exhibitor (navy, 48) and delegate (red, 35). `spareStacks` groups types by
  `badgeLookKey` (front design + colour theme), so a new look gets its own
  stack. The print run and the desk read the same `loadSpareStacks`.
- **Schedule sticker** (`renderScheduleLabel`): the badge back's own schedule
  column, 62 mm wide. 📏 Thursday-only 17 mm; Full Conference 104 mm of text,
  more than the ~95 mm between the schedule area and the QR, so a long schedule
  scales down to fit (90% for Full Conference, measured in a browser: 91 mm of
  text on a 96 mm sticker). On a spare it is the top of the one back sticker
  (`stackStickerParts`).
- **Badge scan rules changed 2026-10-20** (Stephen): the BACK QR across types
  is a contact share in BOTH directions — "attendee scans company" went from
  the company page to `capture` (exhibitor scans attendee already was).
  Attendee↔attendee stays the Circle profile; exhibitor↔exhibitor the company
  page; your own badge, your page. The FRONT QR (exhibitor badges) is a direct
  company-page link, outside these rules. Badges page → badge scan rules.
- **QR caption wording is still the built-in default** ("This code identifies
  your badge for check-in and scanning on site"), which undersells it: the code
  checks in at the desk, opens your page when you scan it, opens your Circle
  profile for another attendee, and asks your permission when an exhibitor
  scans it. Set it on the Badges page → badge design → back → QR caption →
  "Caption wording", BEFORE the print run (it prints on every card).
- Reprint asks "Which card are you holding?" and offers only cards that exist
  for that person: a blank for their company AND type, a spare of their type,
  or No card. Test mode offers every card. Front and back print as two jobs
  (one shared page height would waste 27–46 mm of film per reprint).
- ⚠️ **Hotel Wi-Fi usually isolates devices**, which breaks AirPrint. Bring a
  travel router or hotspot that the printer and every desk device join. The
  printer's own direct Wi-Fi takes the device off the internet.

**Test 2026-10-21 (Stephen's mom's iPad):**
- [ ] Reprint someone whose company has an unnamed seat (company blank) → card shows "Print now: front/back"
- [ ] Print now: front → the dialog opens itself → AirPrint finds the QL → prints 62 mm at full size, not scaled
- [ ] Print now: back → the QR sticker scans at the desk
- [ ] A spare reprint prints front + one back sticker (~120 mm); placed at the top-left of the schedule area, the QR lands on the card's QR spot (measured in Chrome: QR at 100 mm down / 4 mm in, 8.9 mm below the last schedule line); the schedule reads at its size
- [ ] **"Print now: all stickers" on the iPad**: one job, each sticker its own length (CSS named pages). iPad Safari's page sizing is reported unreliable — if lengths come out wrong, use one-at-a-time, or send to the print station (Chrome honours named pages: verified 67/96/21 mm in Chrome)
- [ ] A laptop opens the print station; "Send to print queue" on the iPad → the laptop prints both, marks it printed

## 3d. Print station: printing straight to the QL (built 2026-10-21)

⛔ Browser printing cannot do this: the printer driver overrides every page's size
with its own paper (a 120 mm back came out as two 100 mm pieces; a short front
printed sideways). Proven 2026-10-21 on the Mac Studio: sending to the QL directly
(brother_ql, last year's `csc-name-badges/printer.py`, model id QL-1060N, USB
04f9:20a8) prints each sticker at its exact length and lines up with the card to
fractions of a millimetre.

- **CSC Print Station** (`print-station/`): a Python program on the laptop beside
  the printer. Heartbeat → claim the oldest queued job → fetch each sticker page →
  picture it with headless Chrome at 300 dpi, TRIM to 696 dots (never scale) →
  print all of a job's stickers in one job, cut after each → report.
- **Keys** (`print_stations`, migration `20261021000000`): one per laptop per
  conference, shown once, SHA-256 only, revocable. Made on the desk: toolkit →
  Open the print station → Get a key. Desk staff may make one.
- **Endpoints** `/api/print-station/{heartbeat,claim,jobs/[id]/sticker,jobs/[id]/result}`,
  key-only (never a session). A printer problem returns the job to the queue; a
  sticker that cannot be drawn fails it.
- The desk's "Send to print queue" says when no station is online. The print
  station page is now management (stations, printer status, queue) — it no longer
  prints through the dialog.
- ✅ End to end 2026-10-21: two queued reprints printed through the queue; one a
  stalled run had claimed came back after two minutes and printed.
- ⚠️ Windows untested: use `tcp://PRINTER-IP:9100` (no USB driver needed).
- ⚠️ Chrome must run with its own profile and a mock keychain, or macOS pops a
  keychain dialog and the draw hangs (hit in testing).

## 3b. Next: the alternate versions (agreed with Stephen, 2026-10-20)

Nothing below is built. Both were sorted before building, per the repo rule.

### Event door = this desk with an event picked (NOT a new screen) — BUILT 2026-10-20

Rules: `lib/conference/door.ts`. Scan/by-name: `scanConferenceCheckInToken` and
`markConferencePersonCheckedInManual` take an `entityId`. New result
`not_on_ticket` (migration `20261020020000`, live). Printed list:
`/admin/conference/[id]/check-in/door-list?entity=` (reader `loadDoorRoster`, the
same walk as the attendance count — 24/24 and 25/25 on live data). Door scans
feed the overview's attendance `scanned` column.

⚠️ Doors offered automatically = **capped** events only (`capacityOf`, check-in
model §3). The toolkit's calendar lists every event, so an uncapped one (the
CANCOLL AGM) is picked by hand.

Supersedes "distinct from the desk" in `planning/conference-check-in-model.md`
Phase 2 — that was written before the desk became full-screen and phone-first.

- **When it asks:** after the PIN, if an event's window is open, the desk asks
  "Is this check-in for <event>?". Window = **1 hour before start to 1 hour
  after end** (the hour after is for reconciling against the paper list).
  Overlapping events are all listed, plus "Not for an event (badge pickup)".
- **Remembered per device** in a cookie that **expires when the window
  closes**, so a reception choice cannot leak into the next morning's scans.
- **Toolkit:** a calendar icon, "Change which event you are checking in".
  After the window, events stay pickable here (not offered automatically) for
  reconciliation; those entries are recorded as by hand.
- **Records** `conference_check_in_events.entity_id` (the column exists,
  nothing writes it yet).
- **A badge SCAN at the door also checks them in to the conference** (they
  hold the badge, so they picked it up). ⛔ A **by-name** door check-in counts
  for the event ONLY: otherwise the desk later reads them as already checked in
  and assumes a reprint (settled rule, check-in model §7).
- ⛔ The door asks "is this event in their access?" (`resolveAccess`), never
  the desk's day rule — a Thursday-only holder who bought the Tuesday reception
  must not be refused at it.
- **Toolkit "Print list"** for the picked event: the backup roster the
  2026-09-08 decisions require (the digital path is never the only path).
- **Sell:** the event at this door goes first, pre-filled with the person.
  Default on a missing ticket stays "admit and invoice" (enforcement off).

### Meetings = a booth card, for CANCOLL's bursary

CANCOLL's sponsorship needs proof that bursary meetings happened, without
staff walking the room.

- **One printed card per booth** (cardstock), a QR that **requires sign-in**,
  like the badge's back QR (`/scan/[token]`). Not per meeting: the schedule
  says which meeting from who, which booth and when.
- **Either side scans; one scan counts; two is never an error.**
  - Delegate scans: if they are on the bursary and have a meeting with that
    exhibitor around now, it is confirmed.
  - Exhibitor scans their own card: their page shows who they are scheduled
    with now, pre-selected; they tap Confirm (covers a delegate who will not
    use their phone).
  - Second scan adds the other side's confirmation, same meeting.
- **Record who confirmed** (delegate / exhibitor / both) — CANCOLL's report
  shows every confirmed meeting and how strongly.
- Anyone not on the bursary who scans it sees the company's page.
- ⛔ Not the badges: the front QR is anonymous (records nothing); an exhibitor
  scanning a delegate's back QR sends a contact-details request (lead capture)
  — wrong for a sponsored meeting and it would pollute the lead data.
- **One instruction:** "When you sit down for your meeting, one of you scans
  the card on the table."
- ⚠️ **Sign-in is per BROWSER, not per phone.** The iPhone camera opens Safari;
  someone signed in on Chrome is asked again. Badge pickup for bursary
  delegates should say "sign in in Safari (Chrome on Android)". Test how long
  an unused session lasts (Supabase setting) on a real phone before relying on
  it.
- ⛔ **Waits on the CANCOLL bursary work**, which is not built yet (Stephen,
  2026-10-20). The card needs to know who is on the bursary; build that first,
  then the card reads it. The event door does not depend on it.

## 3a. Device test checklist (before pushing)

The laptop webcam never read a code; a real device on the preview does
(proven 2026-10-19). Use the **preview deploy of this branch** (link at the
top), not `main`: phones only allow the camera on `https://` pages.

⚠️ Today's date is outside the conference, so the day rule does not apply and
a Thursday-only badge is let in. Test wrong-day refusal with `&as_of=`.

**Devices:** iPad (Safari), iPhone (Safari), one Android phone (Chrome).

**Test badges** (printed 2026-10-19; real codes, shared database, so they work
on any deploy). Rehearse with `…/check-in?test=1`; pretend a day with
`&as_of=2027-02-02`. Press **Leave test mode → reset** when done.

| Badge | Rehearse as | Expect |
|---|---|---|
| Desk Test Full Conference | any conference day | green flash + tone, "Checked in" |
| Desk Test Full Conference | scanned again | amber, "Already checked in" |
| Desk Test Thursday Only | `as_of=2027-02-02` (Tue) | red, "Not valid today", **Sell them a day pass** |
| Desk Test Thursday Only | `as_of=2027-02-04` (Thu) | green |
| Any QR that is not a badge | — | red, "Not one of our badges" |

**Camera and scanning**
- [ ] Camera permission prompt appears; the feed fills the screen
- [ ] Guide square and caption show; a printed badge reads at a normal arm's length
- [ ] A code on another phone's screen reads
- [ ] Reads in poor light (a dim corner of the room)
- [ ] Camera picker (+ → Camera) switches front/back and retries

**Result feedback**
- [ ] Full-screen flash: green / amber / red
- [ ] Sound plays (only after the first tap anywhere — expected); Android vibrates
- [ ] Red cards stay until **Dismiss**; green cards fade after 30s
- [ ] Two stops in a row both stay

**Find**
- [ ] + → Find opens at the TOP; the keyboard does not cover the search box
- [ ] Camera feed blurs and the square disappears while Find is open
- [ ] Typing a name with a badge in view does NOT check that badge in
- [ ] A badge code pasted into Find offers "Check in by badge code"
- [ ] A company name shows its open seats

**Layout and touch**
- [ ] No site header, admin sidebar or toolkit; no sideways scroll
- [ ] Portrait and landscape both usable
- [ ] Every button easy to hit with a finger

**Desk staff (sign in as a non-admin)**
- [ ] `/me` shows "Check-in desk" only on their days
- [ ] They reach the desk and war room; badges, schedule ops, Days & Setup and `/admin` send them away
- ⚠️ Appoint a test staffer by inserting a scratch appointment, or use an
  account already on CSC staff. **Never Add Staff with a test email** — it
  creates a real Circle account.

**Test data:** kept on purpose for device testing: the two "Desk Test …"
people, their seats and print jobs (Test Org (BI Member Registered), Test Org
(BI Presenter)). Cleaned up 2026-10-19 with Stephen's OK: "Alex Sharedinbox"
archived, the scratch desk appointments ended, the two test cart lines removed.
The canceled card checkout (order 2c871dab…, Stripe session expired, unpaid)
stays as a record.

⚠️ "Test Org (Member)" has no province, so it cannot be taxed or check out —
the desk now says so instead of showing an empty cart. Use a test org with a
province (the "Test Org (BI …)" ones are Ontario) to test selling.

**Payment screen** (card checkout, not invoice — an invoice emails a real
Stripe invoice):
- [ ] Review and pay shows the lines, total and a big QR
- [ ] Scanning the QR on a phone opens Stripe; paying shows "Payment received"
- [ ] The desk moves on by itself: a green "Paid: ready to print" card, Print badge
- [ ] Back closes the card link (Stripe shows it expired)

**Walk-up sale on a shared address** (Stephen's rules,
project_shared_email_walkup_rules):
- [ ] Same name + same email → "already on file", details shown, never edited
- [ ] Different name on a known email → operator chooses: that person, or someone new
- [ ] Someone new on a shared address → their own record; no login, no Circle
- [ ] After paying, their badge prints THEIR name, not the address-holder's

**Desk PIN and hand-over** (sign in with your password first — a session
older than 15 minutes is asked to sign in again before choosing a PIN):
- [ ] First open of the desk asks for a PIN, twice; a mismatch starts again
- [ ] Invoice the company instead → PIN screen; Cancel goes back to the QR
- [ ] Pay on this device → Stripe; back (paid or cancelled) lands on a locked desk
- [ ] Reload while locked: still locked
- [ ] Right PIN unlocks: paid → green print cards; cancelled → red "Not paid"
- [ ] Five wrong PINs → signed out; signing back in asks for a new PIN
- [ ] Days & Setup → Desk staff shows "No PIN yet" / Reset PIN; Reset works
- [ ] Customer's own phone, cancelled → "Payment not completed", no sign-in

**Name someone without an email**:
- [ ] The form says "No email: they get a badge but no login…"
- [ ] Their badge prints from the green card
- [ ] A real company's admin gets "Heads up: … has no login" (test orgs get none)
- [ ] Their admin opens them on /org/[slug], adds an email, saves: the modal stays open with Send invite
- [ ] They accept the invite and sign in: their conference registration is theirs (claimed by person, not email)
- [ ] An address someone else already logs in with: "No login of their own… belongs to X", no invite button

**Event door** (rehearse with `…/check-in?test=1&as_of=2027-02-01T18:00` —
`as_of` now takes a venue time):
- [ ] After the PIN, "Is this check-in for an event?" lists the Meet & Greet
- [ ] "No, badge pickup" stops it asking; reload keeps the choice
- [ ] Bottom-left shows "At: Meet & Greet Reception"; tap it to change
- [ ] Toolkit → calendar lists every event; toolkit → Print list opens the sheet
- [ ] Scan a Full Conference badge: green, and checked in to the conference too
- [ ] Scan the Thursday-only badge: amber "Not on their ticket", Sell offers the Meet & Greet first
- [ ] Scan the same badge again: "Already checked in", not counted twice
- [ ] Find → check in by name: counts for the event only (the desk later still treats them as not picked up)
- [ ] Overview → attendance shows the door scans in "scanned"

## 4. Database changes (live on the shared database)

- `20261019180000_conference_desk_staff.sql` — `governance_role_assignments.conference_id`,
  `user_organizations.expires_at`, the desk staff body + role, `capability_contributions`
  view with `conference_id` appended (options and grants restated).
- `20261019200000_user_organizations_inactive_status.sql` — status may be `inactive`.
- `20261019220000_check_in_not_valid_today.sql` — the wrong-day scan result.
- `20261020000000_desk_pins.sql` — the hashed desk PIN, server only.
- `20261020010000_conference_walkup_without_email_template.sql` — the heads-up email.
- `20261020020000_check_in_not_on_ticket.sql` — the door's "not on their ticket" result.
- `20261021000000_print_stations.sql` — print station keys (hashed), heartbeat, printer status.

## 5. Why the first plan was cut

| Proposed | Already existed |
|---|---|
| `desk_sales` switch + desk sell control | The offers page + cart, which already name attendees and invoice |
| `desk_invoicing` switch | The cart's staff-only invoice option |
| `label_reprints` switch | `badge_print_stock.enabled` — no spares, no label |
| `self_purchase` switch | `isConferenceOnSale`; nobody asked for it |
| `desk_capabilities` column + editor | Nothing to store once the switches go |

## 6. Traps, each one already paid for

⛔ **Changing a default changes nothing for a conference that already stored an
answer.** `normalize*` falls back per key, so a stored value keeps winning.

⛔ **Data can sit ahead of code.** CSC 2027 has `badge_scan_rules.destinations.self
= "me"`, set by raw UPDATE on 2026-09-16, inert until self-scan ships.

⛔ **The audit log's `auth_guard_denied` rows feed the Ops Health gauge and a
>25/hour alarm.** Use the quiet check (`isConferenceDeskStaff`) when deciding
what a page shows; the logging one only on real doors.

⛔ **`is_for_sale = false` does not hold a booth.** The sales-open cron re-opens
it within 60s unless `sales_window` is cleared too.

⛔ **The shared `makeFakeDb` is filter-blind.** Tests asserting *which* rows a
query returns need a fake that honours `.eq/.in/.is/.order`.

⛔ **Tests that mock `@/lib/auth/guards` wholesale** must include the new
exports (`requireOrgCommerceAccess`, `requireConferenceDeskAccess`,
`isConferenceDeskStaff`).

⚠️ **`.env.local` holds live Stripe keys**, and prod and local share one
database. Nothing here is a sandbox. To test as a non-admin, use the DevPanel
(Ctrl+Shift+D) personas, and never Add Staff with a new email — it creates a
real Circle account.

## 7. Gates

```bash
npx tsc --noEmit && npx vitest run && npm run build
```

`next build` is the only one that catches `"use server"` export violations.
