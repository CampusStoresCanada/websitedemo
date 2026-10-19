# Conference Desk Handoff (Technical)

Rewritten 2026-10-19 after Stephen's decisions. The first version of this doc
proposed four per-conference switches, a new `desk_capabilities` column, a
settings editor and a desk sell control. None of that was built, on purpose —
see §4 for why each one was a second copy of something that already existed.

## 1. Decisions (Stephen, 2026-10-19)

1. **Desk sales, invoicing, reprints, labels and self-purchase are core
   conference functionality.** No per-conference on/off switches.
2. **Conference ops staff can buy for any organisation**, not just their own.
3. **`ship/self-scan-purchase` merges.** Self-scan lands on `/me` with the
   purchase block.
4. **Kiosk / hand-over is wanted** — one tablet, operator and handed-over states,
   an operator PIN to return. Not designed yet: setting the PIN, resetting it,
   and recovering when every PIN holder is unavailable all need working through
   first. Nothing is built.

## 2. What shipped

### Selling at the desk = the storefront

A walk-up is a sale, then a seat, then a badge. The desk sells through the same
`/conference/[year]/[edition]/offers` page and cart everyone else uses:

1. Desk → **Find by name** → nobody matches → **"Not registered? Sell them a
   registration"** opens the offers page.
2. Pick their company (ops staff now get the org picker global admins had).
3. Add the registration. Name the attendee in the cart.
4. Card, or invoice the company (invoice was already staff-only in the cart).

### One rule for "may this person transact for this org"

`requireOrgCommerceAccess(organizationId)` in `lib/auth/guards.ts`: global
admin, a member of the org, or conference ops. Every storefront action calls it
— offers, cart read, add, quantity, attendee, remove, clear, checkout. It was
previously copied inline in five places, and conference ops passed none of them.

⛔ It is not the invoicing check. `createConferenceCheckout` still refuses
`paymentMethod: "invoice"` without `requireConferenceOpsAccess()`, before any
write. An org admin buying for their own org passes the first and must fail the
second.

### Deleted

`lib/actions/conference-desk-sale.ts` (`sellAtDesk`, `listDeskOffers`). Built
for a desk checkout that the storefront already is; nothing called it.

## 3. Still open

### Reprint readiness — two derivations, pick one

The desk already answers "what does this reprint need?" with
`reprintModeForOrganization` (`lib/conference/badges/print-stock.ts`), via
`loadCheckInFacts`: company blank vs full badge. `assessReprintForPerson`
(`lib/conference/badges/reprint-readiness.ts`) answers the same question with
two more cases — no seat at all, and a spare of the person's own type — and has
no caller. Wiring the second in beside the first would put two answers on one
card. One must absorb the other and the loser be deleted.

### Second label (John's back QR code)

`renderReprintLabel` is reachable only from the job PDF route. The per-person
label waits on the readiness decision above, and on spare stock being
configured: `badge_print_stock` is `NULL` for CSC 2027, so no spares print.

### The desk page is admin-only in practice

`getConference()` is gated on `requireAdmin()` (global admin). The check-in page
calls it after its own `requireConferenceOpsAccess()`, so an ops person who is
not a global admin gets "Conference not found".

### Audit noise

Both storefront pages call `requireConferenceOpsAccess()` on every load to
decide whether to show the org picker; for an ordinary member that logs an
`auth_guard_denied` row. The cart page already did this before.

## 4. Why the first plan was cut

| Proposed | Already existed |
|---|---|
| `desk_sales` switch + desk sell control | The offers page + cart, which already name attendees and invoice |
| `desk_invoicing` switch | The cart's staff-only invoice option; a desk-only switch would have allowed it on one screen and not the other |
| `label_reprints` switch | `badge_print_stock.enabled` — no spares, no label |
| `self_purchase` switch | `isConferenceOnSale`; nobody asked for it |
| `desk_capabilities` column + editor | Nothing to store once the switches go |

## 5. Traps, each one already paid for

⛔ **Changing a default changes nothing for a conference that already stored an
answer.** `normalize*` falls back per key, so a stored value keeps winning.

⛔ **Data can sit ahead of code.** CSC 2027 has `badge_scan_rules.destinations.self
= "me"`, set by raw UPDATE on 2026-09-16, inert until self-scan merged.
Reversible from `BadgeScanRulesEditor`.

⛔ **`is_for_sale = false` does not hold a booth.** The sales-open cron re-opens
it within 60s unless `sales_window` is cleared too.

⛔ **The shared `makeFakeDb` is filter-blind.** Tests asserting *which* rows a
query returns need a fake that honours `.eq/.in/.is/.order` — see
`lib/conference/__tests__/registration-mint-seating.test.ts`.

⛔ **Tests that mock `@/lib/auth/guards` wholesale** must include
`requireOrgCommerceAccess` — see the shim in
`lib/actions/__tests__/conference-checkout.test.ts`.

⚠️ **Badge jobs pin `template_version`.** Generate the print package after the
layout is final.

⚠️ **`.env.local` holds live Stripe keys**, and prod and local share one
database. Nothing here is a sandbox.

## 6. Gates

```bash
npx tsc --noEmit && npx vitest run && npm run build
```

`next build` is the only one that catches `"use server"` export violations.
