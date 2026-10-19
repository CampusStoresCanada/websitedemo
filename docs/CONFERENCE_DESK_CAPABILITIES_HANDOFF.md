# Conference Desk Handoff (Technical)

Rewritten 2026-10-19 after Stephen's decisions. The first version of this doc
proposed four per-conference switches, a new `desk_capabilities` column, a
settings editor and a desk sell control. None of that was built, on purpose —
see §5 for why each one was a second copy of something that already existed.

Everything below is on branch `ship/desk-at-the-cart`, **not pushed** — Stephen
wants the desk fully developed before it ships. Two database changes from it
are already live, because prod and local share one database (§4).

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
7. **Kiosk / hand-over is wanted** — one tablet, operator and handed-over
   states, a PIN set on first use of the desk. Not designed yet: resetting the
   PIN and recovering when every PIN holder is unavailable. Nothing is built.

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

### Fixed: Deactivate never worked

The org user table's Deactivate button sets status `inactive`, which the
`user_organizations` check constraint did not allow: zero deactivations ever
succeeded since 2026-08-17. Constraint widened (live). Re-inviting also clears a
stale end date.

## 3. Still open

- **Name-only walk-ups cannot print.** A walk-up named at the desk without an
  email has no person record (`canonical_person_id`), and badge printing
  refuses without one. Badge Ops' "Attempt Auto Link" creates one from the
  name; the desk does not call it. Identity decision for Stephen.

- **Kiosk / PIN** — design first (§1.7).
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

## 3a. Device test checklist (before pushing)

Not testable on a laptop: the webcam never read a code (no scan reached the
server), the browser pane has no camera or sound, and there is no on-screen
keyboard. Needs a **preview deploy of this branch** (not `main`) for an
`https://` link — phones only allow the camera on secure pages.

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

**Not ready — do not test yet**
- Naming a walk-up WITHOUT an email, then printing their badge: fails ("missing
  canonical person linkage"). Decision pending (§3).

**Test data to remove afterwards:** the two "Desk Test …" people, their seats
and print jobs (Test Org (BI Member Registered), Test Org (BI Presenter)), and
the expired scratch desk appointments (reason "Scratch test by Claude, remove
after").

## 4. Database changes (live on the shared database)

- `20261019180000_conference_desk_staff.sql` — `governance_role_assignments.conference_id`,
  `user_organizations.expires_at`, the desk staff body + role, `capability_contributions`
  view with `conference_id` appended (options and grants restated).
- `20261019200000_user_organizations_inactive_status.sql` — status may be `inactive`.

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
