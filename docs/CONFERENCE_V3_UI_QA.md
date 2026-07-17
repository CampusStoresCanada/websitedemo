# Conference v3 — UI QA Runbook

A repeatable, click-through test of the conference module after the v3 cutover
(see `CONFERENCE_V2_BLUEPRINT.md` and the cutover record in memory). The data
layer is covered by unit tests + live-checks; **this runbook covers the parts
only a human in a browser can verify.**

Approach: **build a conference from scratch through the UI** — the authoring
flow IS the test. Walk the sections in order; each step has an **action** and
what to **expect**. Tick the box if it matches, jot the actual result if it
doesn't (see *Reporting* at the bottom).

---

## How far this runbook reaches

The UI today covers authoring and the go-on-sale gate end-to-end:

```
Describe ──▶ Catalog (Build) ──▶ Sell (Legal + Status gate)   ✅ testable here
                                          │
                                          ▼
                         Buy ──▶ Fulfill (allocation, badges)  🚧 no UI entry yet
```

**Boundary (known gap, not a bug):** there is no public/admin button that adds an
Offer to a cart, so the buy → order → allocation → fulfill chain can't be reached
by clicking. Those paths are proven by the live-checks (`npm run
check:checkout-v3-live`, `check:entity-commerce-live`), not the browser. Section 4
says what you *can* still eyeball. If you want to exercise buy→fulfill in the
browser, ask for a temporary "Buy this offer (dev)" affordance or a seed — both
were deferred.

---

## Prerequisites (once per session)

- [ ] Dev server is up and you can load the site.
- [ ] Logged in as an admin: open the **DevPanel** (`Ctrl+Shift+D`) and pick a
      `super_admin` or `admin` test account.
- [ ] If a hooks/Fast-Refresh error appears right after a code change, **hard-reload**
      (Cmd+Shift+R) before treating it as a bug — see the HMR note in *Reporting*.

> **Reset between runs (optional):** to rebuild from a clean slate, ask me to wipe
> the test conference's rows (I can do it via the DB). There's intentionally no
> auto-seed — building it yourself is the point.

---

## Section 0 — Create / open a conference

1. [ ] Go to **`/admin/conference`** → expect the conference list. "Trial
       Conference" (2027 / ed. 99, **draft**) should be there.
2. [ ] Open it → expect the **sub-nav** with three stages: **Describe · Sell ·
       Fulfill** (the old "Package" stage and the Products/Package/Rules tabs are
       **gone**). Describe shows: Edit · **Days & Setup** · **Catalog** · Schedule.
3. [ ] Click **Overview & Launch Checklist** → expect a "Things for sale" stat
       (NOT "Products") and a launch checklist with blocking items still open.

✔ Pass criteria: three-stage nav, no Products/Package/Rules tabs, no console errors.

---

## Section 1 — Describe ▸ Days & Setup  (`/describe`)

1. [ ] Open **Days & Setup**. Heading reads "Days & scheduling setup" — there is
       **no "Elements" section** (the old facet editor is gone).
2. [ ] **Days:** if dates are set, click **"Sync days to dates"** → expect one row
       per day in range; edit a day profile/label and **Save** → persists on reload.
3. [ ] **Parameters:** fill meeting suites / slots / times / target meetings →
       **Set/Save parameters** → reload, values persist.

✔ Pass criteria: days + parameters save and survive reload; no facet/Elements UI.

---

## Section 2 — Catalog ▸ Build  (`/build`)  ← the centerpiece

This is the v3 graph editor (one list + "add a thing" + connections + for-sale).

1. [ ] Click **"+ Add a thing"** → name it, pick/type a **kind** (e.g. `booth`),
       add a **Property** or two → **Save**. It appears grouped under its kind.
2. [ ] **Connections (composition):** edit the thing → add a connection with a
       **role** (`includes` / `involved_in` / `when` / `where` / `who` / `about`)
       and, for `includes`, a **quantity**. Use **reference-or-create**: reference
       an existing thing OR coin a new one inline (it gets created as a typed stub).
   - [ ] Coin a brand-new thing inline (e.g. "includes 4× Exhibitor Registration")
         → expect it to be created and flagged as an **open question**.
3. [ ] **Open questions worklist:** the amber **"Open questions · N"** chip lists
       stubs + offers missing price/audience. Click **Define** on one → it opens in
       edit mode; fill the required fields / set price → saving **clears it** from
       the list.
4. [ ] **Make it an Offer (for sale):** edit a thing → turn on **for sale** → set a
       base **price**, optional **inventory**, and **tier prices** (member /
       partner / public rows). Save.
   - [ ] Expect an **"Offer · $X"** badge on the row and a **"Sells for"** price
         table in its expanded detail (one line per tier).
   - [ ] An offer with **who-can-buy** set: add a `who` connection to an **audience**
         tier (audiences are seeded from the site's permission tiers).
5. [ ] **Type → instances:** on a type, **"Stamp instances →"** with prefix / start
       # / count (e.g. `Booth` / `601` / `3`) → expect instances created and
       **nested under the type** (count chip + collapsible sublist), not flooding
       the top list.
6. [ ] **Search / filter:** the search box filters by name/kind; the **Open
       questions** and **Offers** filter chips narrow the list.
7. [ ] **Backlinks:** expand a thing referenced by others → "Referenced by" lists
       the incoming edges (Included by / Participants / Audience for / …).

✔ Pass criteria: add/edit/connect/stamp all persist; open-questions list shrinks as
you define things; offers show price-by-tier; instances nest; no console errors.

> Make at least **one thing for sale with a price + a `who` audience** and **no
> open questions** — Section 3's gate needs it.

---

## Section 3 — Sell ▸ Legal + Status gate

### Legal (`/legal`)
1. [ ] Add at least one **legal document version** → it lists and persists.

### Status / go-on-sale (`/status`)
The gate reads the **pure v3 launch-readiness** model. With a fresh conference it
should **block**; fixing each item should flip it green.

Expected checklist items and what each needs:

| Check | Blocks until… |
|---|---|
| Conference dates | start + end set, end ≥ start |
| Registration window | open + close set, close > open (warns if close is after start) |
| Conference days | ≥ 1 day (Section 1) |
| Build catalog open questions | every v3 thing defined (no amber items) — *omitted if you built 0 things* |
| Things for sale | ≥ 1 thing marked for sale (Section 2) |
| Scheduling parameters | parameters configured (Section 1) — its Fix link points to Describe |
| Legal documents | ≥ 1 legal version |
| Tax | info/warning only — **does not block** |

1. [ ] Load the gate with prerequisites missing → expect **blocking** items and a
       **disabled** go-on-sale action; each blocker's **Fix** link jumps to the
       right stage page.
2. [ ] Satisfy each blocker (Sections 1–2 + legal) and reload → blockers clear.
3. [ ] When **0 blocking** remain → the **go-on-sale** action enables; trigger it →
       conference status moves out of `draft`; reload confirms the new status.

✔ Pass criteria: gate blocks correctly, Fix links land on the right editor, and the
transition succeeds only when all blockers are cleared (UI and server agree — one
model).

---

## Section 4 — Buy → Fulfill  (bounded by the UI gap)

No click-path to buy yet, so you can't mint balances/seats from the browser. What
you *can* verify:

1. [ ] **Org conference page** (`/org/<slug>/conference/<id>`): loads, shows the
       **seat allocation panel** (empty — no purchased seats) and the readiness/roster
       sections, **no console errors**, and **no** old "grant allocation" panel.
2. [ ] **Cart page** (`/conference/<year>/<edition>/cart`): loads and shows
       **"Your cart is empty / Add offers from the conference catalog"** (offers
       render here, not products) — empty is expected (nothing can add to it yet).
3. [ ] Public **conference hub** (`/conference/<year>/<edition>`): shows
       Registration / Schedule / Orders cards — **no** Products or Booth cards.

To actually drive buy→allocate→badge in the browser, we'd add a temporary dev "Buy"
button (calls the proven `addOfferToCart` + checkout path) or a seed. Flag it if you
want it.

---

## Section 5 — Schedule tab (rebuilt on the catalog, 2026-06-25)

The Schedule tab (`/admin/conference/[id]/schedule`) now reads/writes the v3
catalog directly. Three blocks: **Daily schedule** (timeline), **Meeting setup**,
**Meeting matrix**.

### 5a — Daily schedule (catalog-derived, editable)
1. [ ] The timeline lists everything in Build that has a **day + time**, grouped by
       day, **coloured by kind** (session/meeting/event/networking/meal), with a
       legend. Things that relate (a meal inside a block) show **nested**.
2. [ ] **Add to schedule** → fill name/kind/day/times/location/audience → Save →
       it appears on the right day. Reload persists (it's a catalog entity).
3. [ ] **Edit** a row (hover → Edit): change time or day or location → Save →
       moves/updates. **Delete** removes it.
4. [ ] The **public** schedule (`/conference/<year>/<edition>/schedule`) and
       **`/me/conference/<id>`** show the same items (one source now).

### 5b — Meeting matrix (review + manual overrides)
> Needs a generated scheduler run first (Schedule Ops). With none, expect the
> "No meeting grid yet…" empty state — that's correct, not a bug.
1. [ ] Four lens chips: **Suite × slot**, **By exhibitor**, **By delegate**,
       **Coverage** (fill %, empty cells, per-suite bars, who-isn't-scheduled).
2. [ ] In **Suite × slot**, click a cell → editor → pick exhibitor + delegates →
       **Save meeting** → cell fills and shows a **manual** badge. **Clear cell**
       empties it. Trying to put the same exhibitor/delegate in two suites at the
       same time is **blocked** with a message.
3. [ ] In **Schedule Ops**, the Active-Run card shows the **manual edit count**;
       promoting a different run **warns** before discarding manual edits.

✔ Pass: timeline add/edit/delete persists and matches public/me; matrix lenses
render; cell edits save with the manual badge; re-promote warns.

## Known gaps — do NOT report these as bugs

- No public/admin **buy UI** for offers yet (org-procurement surface unbuilt).
- **Badges / check-in** still show `entitlement_type` labels, not `resolvePersonAccess`.
- **QuickBooks → conference** invoice-item mapping is parked (falls back to default).
- `entity_balances.holder` columns linger (vestigial; seats are authoritative).

---

## Reporting findings back

For each issue, give me:
1. **Route** (URL) and **stage/section** above.
2. **Action** you took and **what you expected vs. what happened**.
3. Any **console / Next.js overlay error** — for a React hooks error, the component
   name at the top of the stack. (First **hard-reload**: a hooks error right after a
   code edit is usually stale Fast Refresh, not a real bug.)
4. A screenshot if it's visual.

I'll reproduce against the code/DB, fix, and we re-run the affected section.
