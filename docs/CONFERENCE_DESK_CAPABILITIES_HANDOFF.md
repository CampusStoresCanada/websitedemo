# Conference Desk Capabilities Handoff (Technical)

## Scope

The check-in desk can currently check people in and reprint their badge. It cannot
sell anything, cannot reach the spare-badge stock, and cannot print a label onto a
blank. The decision-making code for all of that is written, tested and merged — it
simply has no caller.

This document turns the remainder into discrete functions, each behind a capability
an organiser switches on for **their** conference. The target reader is a conference
organiser who is not Stephen, looking at a settings panel and deciding what their
desk should be able to do.

Written 2026-10-19 against `origin/main`.

---

## 1. Toggle architecture — reuse, do not invent

Two layers already exist. A third would be the mistake.

### Layer 1 — `platform_features` (whole install)

```ts
await isFeatureEnabled("conference")   // lib/data.ts
```

Table `platform_features` (`feature_key`, `enabled`, `always_on`). Answers *does this
deployment do conferences at all*. `sponsorships` is currently `false` — a live
example of a built module switched off. ⚠️ `isFeatureEnabled` **fails open**: a
missing row or a read error returns `true`.

Not the right layer here. It cannot differ between two conferences.

### Layer 2 — a JSON config column on `conference_instances` (per conference)

This is the layer to use. Two columns already follow the pattern:

| Column | Module | Editor |
|---|---|---|
| `badge_scan_rules` | `lib/conference/badges/rules.ts` | `BadgeScanRulesEditor.tsx` |
| `badge_print_stock` | `lib/conference/badges/print-stock.ts` | `BadgePrintStockEditor.tsx` |

The shape, every time:

1. A `const X = [...] as const` list of the options — the editor maps over it, so
   adding an option adds it to the UI with no second edit.
2. `Record<Option, string>` label maps. **Typed**, so `tsc` refuses to compile until
   a new option has a human label. This is the mechanism that keeps the panel honest.
3. `DEFAULT_*` / `UNCONFIGURED_*` constants.
4. `normalize*(value: unknown)` — falls back **per key**, never all-or-nothing, so an
   unknown or absent key takes its default while the rest of a stored object survives.
5. `load*` / `save*` server actions behind `requireConferenceOpsAccess()`.
6. An editor component rendered on `app/admin/conference/[id]/badges/page.tsx`.

Both existing readers never throw: a badge run must still produce badges when the
config read fails, and the fallback is the loud one.

### Layer considered and rejected — the v3 entity graph

`conference_entities` has a `policy` kind, which looks like a home for rules. It is
not. Checked 2026-10-19: all six rows on CSC 2027 are **legal documents someone
accepts** — Exhibitor Agreement, Member Code of Conduct, Privacy & Recording Release,
Speaker Agreement, Terms & Conditions, Vendor Code of Conduct — carrying
`legal_document_type` and `accept_by`. A desk capability is not something an attendee
signs. Putting one there would be the duplicate, not the reuse.

---

## 2. Current state, measured against `origin/main`

### Reachable today

`CheckInDeskClient.tsx` (1,091 lines) — camera scan, manual check-in, reprint with a
captured reason, test mode. Reprint is also wired from `BadgeQuickReprint.tsx` and
`WarRoomClient.tsx` via `POST /api/admin/conference/[id]/people/[personId]`
with `op: "reprint_badge"`.

### Built, merged, and with **no UI caller anywhere**

| Symbol | File | What it does |
|---|---|---|
| `sellAtDesk` | `lib/actions/conference-desk-sale.ts` | Cart → checkout → Stripe, card or invoice, org is the buyer |
| `listDeskOffers` | `lib/actions/conference-desk-sale.ts` | Registrations + events for sale; booths excluded |
| `assessReprintForPerson` | `lib/conference/badges/reprint-readiness.ts` | Derives whether a reprint can happen and on what stock |
| `renderReprintLabel` | `lib/conference/badges/label-html.ts` | Front/back label for a blank or spare |

Verify before building: `git grep -l "<symbol>" origin/main -- app components`.

### Spare stock is unconfigured

`conference_instances.badge_print_stock` is `NULL` for CSC 2027. Null falls to
`DEFAULT_BADGE_PRINT_STOCK`, whose `enabled` is `false`. No spare or blank badges
print at all.

⚠️ This breaks the "walk-up attendee" chain in three places at once: the sale has no
button, the blanks do not exist, and the label has no caller.

### Already has a toggle — do not build a second one

- **Spare badges** → `badge_print_stock.enabled`, with percentage and minimum fields.
  `BadgePrintStockEditor` already exists. It needs **configuring**, not building.
- **Self-scan destination** → `badge_scan_rules.destinations.self`.
  `BadgeScanRulesEditor` already exists and renders the options list automatically.

---

## 3. The capability set

Be honest about which things are genuinely an organiser's choice and which are just
unfinished. Only the first group gets a switch.

### Genuine capabilities

| Key | Question it answers | Default |
|---|---|---|
| `desk_sales` | May the check-in desk take money at all? | off |
| `desk_invoicing` | May staff offer "invoice my company" instead of a card? | off |
| `self_purchase` | May an attendee buy extras for their org from `/me`? | off |
| `label_reprints` | May the desk print a label onto a blank or spare? | off |

⛔ `desk_invoicing` is a **second** gate, never a replacement for the first.
`createConferenceCheckout` already refuses `paymentMethod: "invoice"` unless
`requireConferenceOpsAccess()` passes, before any write. The capability says *this
conference permits deferred payment*; the guard says *you personally may authorise
it*. Both must pass. Removing either one re-opens a hole where any org admin could
invoice themselves from the public cart page.

⛔ `desk_invoicing` must be unreachable when `desk_sales` is off. Treat it as a
sub-option in the editor, not a sibling checkbox.

### Not capabilities — just unfinished

- **Reprint readiness.** Telling an operator *why* a reprint cannot happen is not
  optional behaviour. Wire `assessReprintForPerson` into the reprint control
  unconditionally.
- **Kiosk / hand-over mode.** This is an undecided design question, not a flag. See §5.

---

## 4. Functions to build

### 4.1 `lib/conference/desk-capabilities.ts` (new)

Mirror `lib/conference/badges/rules.ts` exactly.

```ts
export const DESK_CAPABILITIES = [
  "desk_sales",
  "desk_invoicing",
  "self_purchase",
  "label_reprints",
] as const;
export type DeskCapability = (typeof DESK_CAPABILITIES)[number];

/** Off unless an organiser says otherwise — none of these should surprise anyone. */
export const DEFAULT_DESK_CAPABILITIES: Record<DeskCapability, boolean>;

/** Falls back PER KEY. An unknown key takes its default; the rest survive. */
export function normalizeDeskCapabilities(value: unknown): Record<DeskCapability, boolean>;

/** Never throws. A failed read returns the conservative defaults. */
export async function getDeskCapabilities(
  conferenceId: string
): Promise<Record<DeskCapability, boolean>>;
```

Needs a migration adding `conference_instances.desk_capabilities jsonb null`.
⚠️ Prod and local share one database — a local migration lands under live users.

### 4.2 `lib/actions/desk-capabilities.ts` (new)

Mirror `lib/actions/badge-scan-rules.ts`.

```ts
export async function loadDeskCapabilities(conferenceId: string): Promise<Result<...>>;
export async function saveDeskCapabilities(
  conferenceId: string,
  capabilities: Record<DeskCapability, boolean>
): Promise<Result<void>>;
```

Both behind `requireConferenceOpsAccess()`. `save` normalises before writing, so a
hand-posted body cannot store a key the code does not understand.

### 4.3 `components/admin/conference/DeskCapabilitiesEditor.tsx` (new)

Renders `DESK_CAPABILITIES.map(...)` against a typed
`CAPABILITY_LABELS: Record<DeskCapability, string>` and a
`CAPABILITY_DESCRIPTIONS: Record<DeskCapability, string>`. Both typed Records, so a
new capability cannot ship without words a non-technical organiser can read.

Mount on `app/admin/conference/[id]/badges/page.tsx` beside the two existing editors.

⚠️ Each row needs a one-line consequence, not just a name — "the desk can take a
card payment and print the badge immediately" beats "Desk sales".

### 4.4 Desk sell surface

A control in `CheckInDeskClient.tsx`, rendered only when `desk_sales` is on.

- `listDeskOffers(conferenceId)` populates the choices.
- `sellAtDesk({ conferenceId, organizationId, offerEntityId, attendee, successUrl, cancelUrl, paymentMethod })`.
- The card/invoice choice appears only when `desk_invoicing` is on.
- ⛔ The attendee's name goes in **at purchase time**. That is the whole point: the
  seat mints named, so the badge prints while they are still standing there.

Done when: an operator can sell a registration to a walk-up, choose card or invoice,
and reach a printable badge without leaving the desk.

### 4.5 Label reprints

Make `renderReprintLabel` reachable, gated on `label_reprints`. The job PDF route
(`app/api/admin/conference/[id]/badges/jobs/[jobId]/pdf/route.ts`) already reaches
`buildReprintLabelDocument`; the per-person label does not.

⛔ Depends on spare stock being configured. A label with no blank to stick it on is
not a feature.

### 4.6 Reprint readiness (no toggle)

Call `assessReprintForPerson({ db, conferenceId, personId })` from the reprint
control and render the refusal reason. It returns either
`{ ready: true, stock, registrationTypeId, registrationTypeName }` or
`{ ready: false, blocker: "no_seat" | "no_matching_spare", reason }`.

### 4.7 Self-service purchase

Already built and pushed on `ship/self-scan-purchase` (`b848d5b`), gated today only
by `isConferenceOnSale`. Add the `self_purchase` check alongside it.

---

## 5. Open decision — kiosk / hand-over

Unanswered since September, and §4.4 probably should not ship without it.

Stephen's framing: *"Hand it over to check if this is correct and either pay or the
invoice goes through."* The proposal was one tablet with two states — operator and
handed-over — a deliberate hand-over action, and an operator PIN to come back. The
open question is whether an attendee ever holds the device, and what they can reach
while they do.

---

## 6. Traps, each one already paid for

⛔ **Changing a default changes nothing for a conference that already stored an
answer.** `normalize*` falls back per key, so a stored value keeps winning. CSC 2027
had `badge_scan_rules.destinations.self = "map"` stored; flipping the code default to
`"me"` did nothing until the row was updated. Expect to ship a data change with any
default change, and say so.

⛔ **The reverse also bites.** CSC 2027 has `self: "me"` stored *now*, inert because
main has no such destination. It goes live the moment `ship/self-scan-purchase`
merges. Data can sit ahead of code.

⛔ **A capability is not an authorisation.** Toggling `desk_invoicing` on must not
remove `requireConferenceOpsAccess()`. See §3.

⛔ **`is_for_sale = false` does not hold a booth.** The sales-open cron re-opens it
within 60s unless `sales_window` is cleared too. Verify after a tick, not on write.

⛔ **The shared `makeFakeDb` is filter-blind.** It replays queued rows whatever the
query asked for, so a test built on it cannot tell a filtered read from an unfiltered
one. Anything asserting *which* rows a query returns needs a fake that honours
`.eq/.in/.is/.order` — see `lib/conference/__tests__/registration-mint-seating.test.ts`.

⛔ **Prove a test fails without the fix.** Both recent conference fixes shipped with
tests verified by reverting the source and re-running. A test that passes either way
is worse than none, because it reads as coverage.

⚠️ **Badge jobs pin `template_version`.** The print package must be generated after
the layout is final. A January constraint, not a today one.

⚠️ **`.env.local` holds live Stripe keys**, and prod and local share one database. The
invoice path has run for real (Ambassador, 2026-10-13, $10,170, 13% tax read back
correctly) — it does not need a rehearsal, but nothing here is a sandbox.

---

## 7. Gates

```bash
npx tsc --noEmit && npx vitest run && npm run build
```

`next build` is the only one that catches `"use server"` export violations. In a
fresh worktree, link deps first — and note that `cp -Rl ../../../node_modules .` will
nest itself if `node_modules/` already exists, which it will as soon as vitest has
run once.
