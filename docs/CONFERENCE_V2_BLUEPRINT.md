# Conference Module v2 — Rebuild Blueprint

**Status:** Draft for review · 2026-06-12
**Premise:** Rebuild the conference module around a four-stage model (Describe → Package → Sell → Fulfill) and a grant-based commerce graph, reusing the org/identity/payment infrastructure already wired into the site. This is a rebuild of the *conference layer*, not the platform.

---

## 1. The target model

### Four stages (the admin's linear path)

| Stage | Admin activity | Data produced |
|---|---|---|
| **1. Describe** | Define what the conference *is*: days, times, meals, offsites, education, meetings, trade show floor, travel windows | The noun catalog — every object gets a stable row + ID |
| **2. Package** | Define what each purchasable thing *means*, composed only from Stage 1 nouns | Products + grants ("Booth A = floor access Tue–Wed + 3 exhibitor badges + 2 gala seats") |
| **3. Sell** | Open registration; buyers purchase bundles fast (money + who's buying, nothing else) | Orders + order items + grant balances |
| **4. Fulfill** | Drip-feed: orgs allocate seats to people, people complete profiles, deadlines tracked | Assignments + per-person data + readiness |

Stage boundaries are the gates. "Go on sale" = Stage 2→3 transition with server-side validation. The path is linear for orientation but **re-entrant**: adding a noun after sales start (new offsite in March) is a normal append, with optional offer amendment ("add 1 seat to existing booth packages?").

### Three layers of commerce

1. **Grants** (admin-authored, on products): `grant_type × quantity × scope`. Closed vocabulary, no nesting, no conditionals. Conditionals live in the rules engine (eligibility/purchasability only).
2. **Balances** (instantiated at payment): per order item, quantity-aware ("3 badge seats, 1 assigned").
3. **Allocation** (org admins assign people): seats → people over time; each grant type declares what info it needs and by when.

One resolver — `resolveEffectiveAccess(personId, conferenceId)` — is the single source of truth for what any person can access. Badges, check-in, schedule visibility, swaps all read from it.

### Grant vocabulary (initial)

| grant_type | quantity | scope (FK, not free text) |
|---|---|---|
| `booth_space` | 1 | booth / booth tier |
| `badge_seat` | N | registration type (delegate/exhibitor/observer/staff) |
| `day_access` | — | set of `conference_days` |
| `offsite_seat` | N | `conference_offsite_events` row |
| `meal_access` | — | set of meal services |
| `meeting_access` | — | meetings module (days subset) |
| `education_access` | — | education stream / sessions |

Each grant type also declares its **data obligations** (what the assigned person must eventually provide, and the deadline source) — this drives Stage 4 readiness instead of hardcoded field lists.

---

## 2. Inventory: keep / rewire / drop

### KEEP — already sound, reuse as-is

| Asset | Why it stays |
|---|---|
| `organizations`, `user_organizations`, `contacts`, `people` | The org/identity graph is the unfair advantage; untouched |
| Auth/permission system (5-level, `derivePermissionState`) | Untouched |
| `conference_orders`, `conference_order_items`, Stripe webhook spine, `process_conference_order_paid` RPC | The money path works; v2 *extends* the paid handler to mint balances |
| `invoices`, QBO export queue | Untouched |
| `conference_instances` + lifecycle statuses | Keep; add `paused`; gate transitions on the new readiness fn |
| `conference_legal_versions` + `legal_acceptances` | Keep |
| `conference_booths` (+ approvals, reserve/confirm RPCs, hold expiry) | Booth → product FK is already the right shape |
| Badge infra: `badge_print_jobs`, `conference_badge_tokens`, template configs | Consumers switch to the resolver; pipeline unchanged |
| `conference_check_in_events`, check-in desk | Reads resolver instead of inferring from registration type |
| `conference_entitlement_assignment_events` | Carries over nearly unchanged as the allocation audit trail |
| Rules engine (`rules-ast`, `rules-engine`) | Keep, **re-scoped**: eligibility/purchasability only; contents-of-product moves to grants |
| Cart/checkout actions (`conference-commerce.ts` transaction path) | Keep; products become grant-bearing |

### REWIRE — right idea, wrong home or shape

| Today | Problem | v2 |
|---|---|---|
| Entitlement = order item; `conference_people` upserted on `(conference_id, source_type, source_id=order_item_id)` | **One seat per order item** — quantity > 1 can't allocate multiple people; type is a free string | `grant_balances` (qty-aware) between order items and seats; `conference_people` rows become seat assignments keyed by balance + seat index |
| Day profiles, offsite events, meal services, education config inside `conference_schedule_modules.config_json` | Anonymous blobs — grants can't reference them; wizard owns them | Promote to tables: `conference_days`, `conference_offsite_events`, `conference_meal_services`, `conference_education_sessions` (+ backfill from JSON) |
| Registration option `entitlements` (`no/included/purchase_required` per module, JSON) | Conflates access with purchasability; three linkage shapes (FK / JSON array / JSON pointer) | "Included" → grants on the registration product. "Purchase required" → rules-engine eligibility. `updateProductLinkages` + `access_product_id` deleted |
| `conference_products.metadata` carrying linkage semantics | Implicit contract | Explicit `product_grants` rows |
| `conference_program_items` regenerated via manual button | Admin-operated sync chore | Derived automatically on Stage 1 writes; "Regenerate/Reconcile" buttons deleted |
| `lib/conference/readiness.ts` (hardcoded per-person field list) | Static; ignores what was bought | Readiness derived from data obligations of assigned grants |
| Wizard preflight (client-only) + `transitionConferenceStatus` gate (5 crude checks) | Two disconnected readiness models | One server-side `computeLaunchReadiness(conferenceId)`; checklist UI and transition gate consume the same output |
| `conference_registrations` (70 columns: profile + matching + travel + hotel + badge + check-in + entitlement state) | Mega-table; duplicate column sets with `conference_people` | Phased split: registration = profile + custom answers; operational state (badge/check-in/travel) lives on `conference_people`; matching prefs move to a meetings-module profile table. **Phase 6 — do not block earlier phases** |

### DROP — doesn't fit the model

| Asset | Replacement |
|---|---|
| `ScheduleDesignWizard.tsx` (10,989-line client monolith) | Per-stage, per-module pages; state lives in DB rows, not component memory |
| `conference_schedule_modules` as config home (18 modules of JSON) | Real tables (Stage 1) + a slim `module enabled` flag set for scoping |
| Reconcile/Regenerate admin buttons | Automatic on write |
| v1.2 stub modules in the scope UI | Hidden until real |
| 17-tab `ConferenceSubNav` as primary navigation | Four-stage nav + launch checklist home (tabs survive as deep links within stages) |
| Wizard-internal product creation one-offs (`createSuggestedOffsiteProducts`) | Generalized "create linked product with default grants" in each noun editor |
| Booth-package `metadata` conventions on `conference_products` (`day_pattern`, color, features JSON) | `day_pattern` → `day_access` grants with per-day `access_kind` (`floor` \| `meeting`); color/feature list → explicit product display columns. The `booth_product_id` FK on booths survives unchanged |

---

## 3. New schema (additive first)

```sql
-- Stage 1 nouns (promoted from config_json)
conference_days (
  id uuid pk, conference_id fk, date date, day_profile text, -- full_day | half_day | travel | other
  label text, sort int
)
conference_offsite_events (
  id uuid pk, conference_id fk, name text, date date, start_time, end_time,
  venue_name, venue_address, capacity int, travel_mode text, meal_type text, status text
)
conference_meal_services (
  id uuid pk, conference_id fk, day_id fk, service text, -- breakfast|lunch|dinner|snack|custom
  label text, capacity int
)
conference_education_sessions (
  id uuid pk, conference_id fk, day_id fk, stream text, title text,
  starts_at, ends_at, capacity int, status text -- supports TBD mode
)

-- Layer 1: what a product includes
product_grants (
  id uuid pk, product_id fk -> conference_products, grant_type text,
  quantity int default 1,
  scope_registration_type text null,
  scope_booth_id uuid null,
  scope_offsite_event_id uuid null,
  per text default 'order' -- 'order' | 'attendee'
)
product_grant_days (grant_id fk, day_id fk, access_kind text default 'floor') -- floor | meeting
product_grant_meals (grant_id fk, meal_service_id fk)
product_grant_sessions (grant_id fk, session_id fk)

-- Layer 2: minted on payment (extend process_conference_order_paid)
grant_balances (
  id uuid pk, order_item_id fk, grant_id fk, conference_id fk, organization_id fk,
  qty_total int, qty_assigned int default 0, status text -- active|refunded|voided
)

-- Layer 3: conference_people generalized
--   conference_people.grant_balance_id fk + seat_index int
--   (replaces conference_entitlement_id -> order_items over a deprecation window)
```

Scopes are FK columns + join tables, **not** a jsonb blob — the DB enforces that a grant can't reference a day that doesn't exist.

---

## 4. New server modules

| Module | Responsibility |
|---|---|
| `lib/conference/catalog.ts` | CRUD for Stage 1 nouns; auto-derives `conference_program_items` on write |
| `lib/conference/grants.ts` | Grant vocabulary, data-obligation declarations, composer read/write; the **only** writer of linkage |
| `lib/conference/access.ts` | `resolveEffectiveAccess(personId, conferenceId)` — union of assigned seats' grants |
| `lib/conference/launch-readiness.ts` | `computeLaunchReadiness(conferenceId)` — staged checklist; consumed by Overview UI **and** `transitionConferenceStatus` |
| `lib/conference/fulfillment.ts` | Balance minting on paid; allocation (wraps existing assign/unassign + events); per-org obligation to-do list |

## 5. Admin IA

```
/admin/conference/[id]
  /describe          -- days, offsites, meals, education, trade show floor, meetings params
  /package           -- products list; per-product grant composer with live "a buyer gets…" preview
  /sell              -- legal, rules (eligibility), pricing/tax review, GO ON SALE (gated)
  /fulfill           -- registrations, allocations, obligations dashboard, badges, check-in, war room
  (overview = launch checklist across all four stages)
```

Org-side: `/org/[slug]/conference/[id]` gains the allocation panel ("3 badges, 1 assigned") and obligation tracker, powered by `fulfillment.ts`.

## 6. Build sequence

| Phase | Work | Risk note |
|---|---|---|
| **0** | Tests around the money path (checkout → paid → order items) before touching anything. **Done 2026-06-12:** `lib/stripe/__tests__/webhook-processing.test.ts` (paid/refund RPC seam, cart clearing, event routing, audit recording), `lib/actions/__tests__/conference-checkout.test.ts` (order RPC + Stripe session metadata contract, guard rails) — 29 tests | Protects the part that must not break |
| **1** | Stage 1 noun tables + backfill scripts from `config_json`; catalog module; new Describe pages. Wizard untouched, now redundant for these sections. **Schema + backfill + catalog done 2026-06-12:** migration `20260612120000_conference_catalog_nouns.sql` (4 tables, RLS, idempotent backfill — verified against 2027/99 test conference: 4 days, 3 offsites w/ product links, 17 meal services, 2 TBD education blocks); CRUD in `lib/actions/conference-catalog.ts`. Describe pages still to build | Additive only |
| **2** | `product_grants` + composer UI in Package; migration scripts converting occupancy-mode JSON **and** booth-package `metadata.day_pattern` → grants; generalized create-linked-product in noun editors. **Data layer done 2026-06-12:** migration `20260612130000_product_grants.sql` (product_grants + day/meal/session scope tables; `access_kind` extended to floor\|meeting\|move_in\|move_out per real booth data; `scope_mode all\|selected` so all-scoped grants absorb future nouns). Auto-converted the unambiguous encodings only: booth products → booth_space + day_access (verified against both 2027 booth tiers), offsite-linked products → offsite_seat. Registration-option entitlements NOT auto-converted — real data has orphaned product refs and an unofficial `speaker` type; `getGrantCoverageReport` in `lib/actions/conference-grants.ts` surfaces them as the composer's worklist. Vocabulary + data obligations + pure validation in `lib/conference/grants.ts` (15 tests). Composer UI + create-linked-product held for Phase 5 UI pass | Old JSON kept read-only until Phase 5 |
| **3** | `grant_balances` minted in `process_conference_order_paid`; generalize `conference_people` allocation to qty seats; org allocation UI. **Data layer done 2026-06-12:** migration `20260612140000_grant_balances.sql` — `grant_balances` (snapshots grant_type/scopes at mint time so sold promises outlive definition edits), `mint_grant_balances_for_order` helper invoked from the paid RPC (idempotent — verified: pay → mint w/ qty multiplication → double-call no dupes → full refund marks balances refunded; synthetic order, cleaned up). `conference_people` gains `(grant_balance_id, seat_index)` with partial unique index — kills one-seat-per-order-item. Allocation in `lib/actions/conference-fulfillment.ts` (assign w/ invite flow, unassign, org balance listing; writes legacy `conference_entitlement_id` for badge/check-in compat until Phase 4; 9 tests). Org allocation UI held for Phase 5 | Extends existing RPC + assignment events |
| **4** | `access.ts` resolver; switch badges, check-in, schedule visibility, swaps to it; obligation-driven readiness replaces `readiness.ts` | Consumer-by-consumer cutover |
| **4 (revised)** | **Resolver + obligations engine done 2026-06-12:** pure `computeEffectiveAccess` + `computePersonObligations` in `lib/conference/access.ts` (12 tests; uses relative import — no vitest `@/` alias config exists), server `resolveEffectiveAccess` / `resolvePersonObligations` in `lib/actions/conference-access.ts`. **Consumer cutover DEFERRED to Phase 5** — repointing badges/check-in/schedule/swaps before the composer authors grants for registration products would resolve delegate/staff access to empty; and those are rendered pages = UI being batched. Known limitation: balances snapshot scalar scopes only; day/meal/session scopes read live via `grant_id`, lost if a definition is deleted post-sale (revisit w/ balance_scopes snapshot if needed) | Resolver is pure + safe; cutover rides Phase 5 |
| **5** | Four-stage IA + launch checklist + unified gate (`launch-readiness.ts`); retire wizard, reconcile buttons, `updateProductLinkages`, stub modules | UI swap; data already migrated |
| **6** | `conference_registrations` split; drop dead JSON paths and deprecated columns | Cleanup; schedule when calm |

Each phase ships independently and keeps the current site working; nothing requires a big-bang cutover.

## 6a. Hardening pass (2026-06-13) — done before Phase 5

Eight foundation fixes so the UI sits on bulletproof ground:

1. **Catalog drift killed.** `reconcile_conference_catalog()` (migration `20260613110000`) re-projects `config_json` → catalog tables by id-preserving UPSERT (additive-merge; never deletes rows grants reference). Triggers on `conference_schedule_modules` (relevant keys) + `conference_instances` date changes keep it fresh and **swallow errors** so a projection bug can't abort the authoritative wizard save. Verified idempotent + trigger-fires.
2/3. **Atomic writes.** `set_product_grants` (atomic replace-set), `assign_grant_seat` / `unassign_grant_seat` (seat write + `qty_assigned` recount in one tx; reassignment decided in-tx) — migration `20260613100000`. Actions in `conference-grants.ts` / `conference-fulfillment.ts` rewired to the RPCs; the app-side recount helper is gone.
4. **plpgsql live-check** — `scripts/conference-commerce-live-check.mjs` (`npm run check:commerce-live`), 16 assertions over mint/idempotency/refund-void/seat alloc/`set_product_grants` atomic-rollback/reconcile idempotency. Caught two real bugs the mocked tests couldn't: `source_id` uuid type + legacy unique-constraint collision (→ synthetic per-seat uuid), and an ambiguous `assignment_status` reference.
5. **Legacy seat linker** — `link_legacy_entitlement_seats()` (migration `20260613120000`), re-run at cutover. **Cutover gate: 0 unlinked entitlement seats** (depends on Phase 5 authoring registration-product grants).
6. **`per='attendee'` removed** — was defined but never minted/derived; dropped from check constraint + TS vocabulary/validation.
7. **Shared test harness** — `lib/test/fake-supabase.ts`; three test files de-duplicated onto it (imported relatively — no vitest `@/` alias).
8. **Batch resolver** — `resolveEffectiveAccessForConference` (fixed query count, not N×5) for badge/check-in/schedule passes before cutover.

## 6b. Phase 5 progress (2026-06-13)

- **5a done — launch-readiness engine + unified gate.** Pure `computeLaunchReadiness` in `lib/conference/launch-readiness.ts` (Describe/Package/Sell stages, ok|blocked|warning|info, `canGoOnSale`; 12 tests). Server loader `getConferenceLaunchReadiness`/`loadLaunchReadinessInput` in `lib/actions/conference-launch.ts`. `transitionConferenceStatus` draft→registration_open now gates on it (replaced the 5 crude inline checks) — UI and gate share one model. Validated vs real test conf: 1 blocker (no legal), 1 warning (7 ungranted products).
- **5b done — Overview launch checklist UI.** `components/admin/conference/LaunchChecklist.tsx` renders the readiness + a draft-only "Go on sale" button enabled only when `canGoOnSale`; wired above `ConferenceOverview` in the overview page. Fix links map to existing tabs (details/products/legal) transitionally until the real /describe /package /sell routes exist.
- **5c done — grant composer.** New `/admin/conference/[id]/package` route ([page](../app/admin/conference/[id]/package/page.tsx)) + `components/admin/conference/PackageManager.tsx`: coverage worklist banner (`getGrantCoverageReport`), product list with inclusion-summary chips, per-product inline composer data-driven by `GRANT_TYPE_DEFINITIONS` (quantity / badge-type / offsite picker / per-day access-kind toggles / meal+session checkboxes / include-all), saves via `setProductGrants`. "Package" added to the subnav. Composer payload shape round-trip-verified live (day_access + badge_seat persisted and read back through the scope join tables).
- **5d done — org allocation UI.** `components/org/OrgGrantAllocationPanel.tsx` on `/org/[slug]/conference/[id]`: per-seat assign/unassign for `badge_seat` + `offsite_seat` balances (member dropdown via `listOrganizationAssignableUsers`, or email invite), org-level grants (booth/day/meal) shown as context chips. Uses the atomic `conference-fulfillment` actions; `router.refresh()` re-pulls after each mutation.
- **5e (nav spine) done — four-stage IA.** `ConferenceSubNav` regrouped into numbered stages: **Describe** (Edit/Schedule Design/Schedule), **Package** (Products/Package/Rules), **Sell** (Legal/Status), **Fulfill** (Registrations/Booths/Wishlist/Billing Runs/Swaps/War Room/Badge Ops/Schedule Ops/Travel Import). Overview & Launch Checklist is the home; Check-in stays a standalone ↗. Existing tab pages unchanged (deep links survive; legacy `?tab=` redirect still valid).
- **Remaining Phase 5:**
  - **5e (consumer cutover) — readiness DONE on a clean slate (2026-06-13).** User confirmed existing conference data was test-only → start clean, resolver is authoritative. `computeConferenceReadiness` + `lib/conference/readiness.ts` **deleted**; org + me pages now use grant-derived obligations (`resolveConferenceObligations` batch / `resolvePersonObligations`), with `data_quality_flags` still counted as blockers at the page level. People with no active grant seat owe nothing (clean-slate default). Badges/check-in/war-room reference `entitlement_type` only for display labels (identity), not access gating — they legitimately stay; the resolver (`resolveEffectiveAccess` + batch) is available for any future access gating. **Security:** all `conference-access.ts` server actions now guarded (admin for conference-wide/effective-access; org-manager-or-admin for org-scoped obligations; owner-or-manager-or-admin for single-person obligations) — they were previously unguarded `use server` exports.
  - **Ship-prep sweep (2026-06-13):** tsc clean · 119/120 vitest (the 1 is a pre-existing, unrelated `lib/visibility` test) · conference surface lint-clean (remaining 6 lint problems are all in untouched pre-existing files: event-ticket webhook `any` casts + the wizard/floor-plan manager 5f removes) · 16/16 commerce live-check.
  - **5f DONE (2026-06-13) — wizard retired, catalog editor live.** Built the Describe catalog editor: `/admin/conference/[id]/describe` ([page](../app/admin/conference/[id]/describe/page.tsx)) + `components/admin/conference/DescribeManager.tsx` — full CRUD for days (sync-to-dates + profile/label), offsite events, meal services, education sessions over `lib/actions/conference-catalog.ts`. Catalog tables are now the **source of truth**, edited directly. Migration `20260613130000` **drops the reconcile triggers** (config_json→tables projection retired so it can't clobber direct edits; `reconcile_conference_catalog()` kept as a one-off tool). Deleted the 10,989-line `ScheduleDesignWizard.tsx` + `/setup` route (v1.2 stub modules died with it); nav "Schedule Design"→ "Catalog" (`/describe`); legacy `?tab=setup`→`describe`. Now-orphaned server actions (`reconcileConferenceScheduleSetup`, `reconcileConferenceSetupAndPeople`, `createSuggestedOffsiteProducts`) left as harmless dead code for a later trim (`regenerateProgramFromSetup` still used by the schedule designer).
  - **Test data:** full-wiped the 2027/99 test conference (user direction — it was test-only). All conference tables at zero; build a fresh conference in the new system.

**Phase 5 complete.** Describe → Package → Sell → Fulfill is the live IA, end to end, on a clean slate. Code is local-only (not committed/pushed/deployed); Supabase migrations + the wipe are live in the dev DB.

### 5f gap-fix (2026-06-13) — wizard deletion had orphaned two editors
Audit of the create→go-on-sale path (prompted by "did we wire create to the editor?") found the wizard owned more than the catalog editor replaced:
- **Scheduling parameters editor** was gone (`upsertConferenceParameters` had 0 callers) — a launch **blocker** with a dead Fix link. Re-added as a "Meetings & scheduling parameters" section in `DescribeManager` (`/describe`); page now passes `conference_parameters`.
- **Floor plan / booth inventory** (`ExpoFloorPlanManager`) was rendered nowhere. Re-mounted at new route `/admin/conference/[id]/floor-plan` + "Floor Plan" tab under Describe.
- **Fix-link routing** made per-check (`CHECK_FIX_SEGMENT` in `LaunchChecklist`) so each blocker lands on its exact editor (dates→Edit, days/parameters→Catalog, grants→Package, etc.).
- Verified: every launch blocker now has a reachable editor; create lands on Overview/checklist which links each step.
- **Correction (those modules are Fulfill, not lost editors):** the wizard's communications / sponsorship_ops / logistics / travel_accommodation "modules" were planning scaffolding — grep confirms their config fed only the wizard ecosystem (schedule-design + ProductManager), no real downstream op. In the four-stage model these are **Fulfill** concerns, and Fulfill already has its tooling: travel→Travel Import tab + travel obligations; communications→War Room + platform messaging (message_campaigns/templates/deliveries); sponsorship→platform subsystem `lib/actions/sponsorship.ts` (could be surfaced as a per-conference Fulfill tab — optional enhancement); logistics→was scaffolding only, no real workflow existed. **No critical-path gap; no real editor lost.** Create button lands on Overview (the checklist = the linear path); change to deep-link `/describe` if preferred.

## 6c. Catalog-v2 grammar (design, 2026-06-13)

Pressure-testing "sell a non-member delegate registration for the trade-show on Wednesday" surfaced the system's real grammar — four axes:
- **Facets** (Describe) — one **element** wears many typed **facets** (event · location · meal · sponsorable · …). Each facet prompts for its own fields and drives its own downstream. A Meet & Greet is one element [event·location·meal·sponsorable]; a title sponsor is one element [sponsorable] only. Replaces the separate noun tables (offsite/meal/education) — they were the wizard's fragmentation inherited as schema.
- **Grants** (Package) — what a product *contains*. Sponsorship = a `sponsorable` facet's deliverable grants (comms_feature, logo_placement, activation, naming_rights) — the mirror of attendee obligations (we owe the sponsor vs the attendee owes us).
- **Paths** (Sell) — named, reusable policies bundling {eligibility, pricing, attribution/flow}: "Available for non-member", "Member–Partner", "OrgAdmin-on-behalf". A product enables a subset; buyer context selects one. **Hard boundary: a path changes who/price/how-you-buy, never what's inside** (that's grants). Cross-domain links ("tied to year-round sponsorship", "tied to membership") are toggles on this axis, built on the existing rules engine — not a third rule system.
- **Fulfillment** — derived from grants + paths.

Build order (slices, each verifiable):
1. **Resolver bundling rule — DONE 2026-06-13.** `selectPersonHeldGrants` in `lib/conference/access.ts`: a person's grants = their seat balances ∪ access-type grants (`ACCESS_BUNDLE_TYPES` = day/meal/education/meeting) from sibling balances sharing the same **order item**. booth_space stays org-only; offsite_seat stays seat-assigned. This is what makes a delegate's badge actually carry the Wednesday floor it was bought with (and a booth's 3 badges share its floor days). Single + batch server resolvers rewired through it (shared `loadScopeMaps` + `BALANCE_COLUMNS`, scoped to the person's order items). 5 new unit tests incl. the exact scenario; **`npm run check:access-live`** proves it end-to-end on the real DB (self-contained: builds conf+day+product+grants → pay → allocate badge only → walks person→badge→order item→day_access sibling→Wednesday/floor). 124/125 unit (1 pre-existing visibility fail), tsc/lint clean.
2. **Facets** — element + facets catalog. **Slice 2a DONE 2026-06-13:** migration `20260613140000` — `conference_elements` (entity) + 5 facet detail tables (`element_{event,location,meal,education,sponsorable}_facet`) where a row's presence = facet on; days stay as the time spine. Actions in `lib/actions/conference-elements.ts` (`getConferenceElements`, `upsertElement` syncing facets in one call, `deleteElement`). `npm run check:elements-live` proves it: a Meet & Greet is ONE element wearing 4 facets, a Title Sponsor is an abstract sponsorable-only element, removing a facet leaves the element intact. (Live-check caught a real to-one-embed bug — facets come back as a single object, not an array.) **Slice 2b DONE 2026-06-13 (cutover, includes 2c):** migration `20260613150000` — `product_grants`/`grant_balances` `scope_offsite_event_id`→`scope_element_id`; `product_grant_meals`+`product_grant_sessions`→one `product_grant_elements`; **dropped** `conference_offsite_events`/`meal_services`/`education_sessions` + the dead reconcile fns; `set_product_grants`+mint RPCs updated. Grant vocabulary scopeKinds → `element`/`elements`; `GrantInput`/`ProductGrant`/`HeldGrant`/`EffectiveAccess`/`GrantScopeCatalog` all element-based (offsite→`scopeElementId`, meal/education→`elementIds`). Server `conference-access`/`-grants`/`-launch`/`-fulfillment` repointed; `conference-catalog` slimmed to days-only. **Composer** (`PackageManager`) scope pickers now filter elements by facet (event/meal/education); **Describe editor** (`DescribeManager`) replaced offsite/meal/education sections with one faceted **Elements** section (checkbox a facet → its fields appear), built on `upsertElement`. tsc/lint clean, 124/125 (pre-existing visibility fail). `npm run check:access-live` extended: 4/4 incl. element-scoped offsite_seat snapshotting `scope_element_id`.
3. **Paths** — named policy presets + product toggles on the rules engine. NOT STARTED.

NB: the full conference wipe removed the 2027/99 fixture, so `npm run check:commerce-live` (which depended on it) now fails at fixture lookup — make it self-contained like the access check, or reseed, when convenient.

## 6d. Catalog-v3 — the canonical model (2026-06-13, supersedes facets)

Arrived at by asking, not assuming (full Q&A with the user). **This supersedes the facet model of slice 2** — facets are gone.

**The primitive set (complete):**
- **Kinds** — named types, each with its own fields and its own "what do I need to know" questions: Day, Venue, Floorplan, Meal, Session, Event, Networking, Audience, Booth category, Policy. (User chose separate kinds over one typed "Activity".)
- **Attributes** — the typed fields on a kind.
- **References** — the ONE linking concept: any entity → any entity, carrying optional **quantity** + **role**. This single thing is composition + "packaging" + grants + "who attends" + "where". No separate "grant".
- **Sellable** — a *capability* any entity can wear (price + a who-can-buy Policy), NOT a kind. Product and Package collapsed into this; a thing for sale is called an **Offer**. A single Session can be an Offer; a "Connected Exhibitor" is an Offer that references other entities (incl. other Offers).
- **Policy** — just a kind (eligibility + price rule + flow); referenced by sellables. "Path" is gone as a word.
- **Reference-or-create** — the universal input gesture: pick a canonical entity or define a new one inline. Defining once makes it canonical; reference it anywhere.

So: **no facet, no grant, no path, no product/package** as primitives. Just kinds, attributes, references, the sellable capability (Offer), policies, and reference-or-create.

**Engineering backbone (my call, veto-able):** one `entities` table (id, kind, name, sellable price/policy) so a reference's target is a single FK; one `references` table (from_id, to_id, role, quantity); per-kind detail tables for typed attributes; `grant_balances` becomes "references snapshotted at sale". Deferred small defaults: role vocabulary is per-kind-pair; composition is live until sold then snapshotted; references carry qty+role.

**What survives the facet→v3 reshape:** conference_instances, conference_orders/order_items, the money-path RPCs, the atomic-write discipline, grant_balances (→ snapshotted references), the launch-gate idea, the resolver PRINCIPLE (access rides with the purchase), conference_days (Day is a kind). **What gets replaced:** conference_elements + facet tables → per-kind entity tables + entities/references; product_grants + scope tables → references; conference_products → sellable capability; PackageManager/DescribeManager → reference-or-create UI.

**UX target (the cockpit, the thing that was missing):** a guided, in-place interview — "add a day → what happens on it → add a Session → where? (reference-or-create a Venue) → who's it for? (reference an Audience) → for sale? (make it an Offer)". A living checklist of open questions, answer in any order. Stages = progress, not tabs.

**Proof thread DONE 2026-06-13 (isolated, adopt-or-discard).** Migration `20260613160000`: `conference_entities` (+ sellable capability) + `conference_entity_refs` (universal reference, role+quantity) + per-kind detail (`entity_session`/`entity_venue`/`entity_audience`). Generic actions in `lib/actions/conference-entities.ts` (createEntity/updateEntity/setEntityReferences/getSessionWorkspace). UI: `/admin/conference/[id]/build` ("Build (v3 proof)" tab) → `SessionBuilder.tsx` — the 5W1H interview (What/When/Where/Who/Why/How) with a `RefOrCreate` combobox for Where(Venue) and Who(Audience) and a for-sale Offer toggle. `npm run check:entities-live` 5/5: define-once Venue, Session references it + audiences, sellable Offer, kind-detail intact. **Facet code untouched** — this sits alongside it. If the interaction feels right in the browser, migrate the remaining kinds onto this pattern and retire the facet tables/composer/Describe editor; if not, discard one thread.

**To exercise it:** create a conference (`/admin/conference/create`), open its **Build (v3 proof)** tab, add a session, create a venue inline, mark it for sale.

**Backward reference added 2026-06-15.** reference-or-create rolls *backward* too: the conference already knows its dates, so they exist as referenceable `day` entities (migration `20260613170000` adds `entity_day`; `ensureDayEntities` idempotently mirrors `conference_instances.start_date..end_date` into `kind='day'` entities). The Session **When** is now a chip-picker over those days (role `when`), not a blank date field — plus inline "add a date" for an off-schedule day. `check:entities-live` 6/6 (adds the When→Day backward-ref assertion). **Cross-system backward pull added 2026-06-15.** The "people we know from the website" the user meant = the **permission tiers** (Public→Partner→Member→Org Admin→Admin→Super Admin, `lib/auth/types.ts` PERMISSION_LEVELS), not a list of individuals. A conference *inherits* them as audiences and can define its own on top. Migration `20260615120000` adds `entity_audience.source_role` (the tier it inherits from; null = conference-defined); `ensureAudienceEntities` seeds one audience per tier idempotently; Session **Who** renders inherited tiers as chips + create-conference-specific. `check:entities-live` 7/7. So the backward pull now works for both pool sources — within-conference (days from the conference's dates) and cross-system (audiences from the website's role tiers) — via the identical gesture. `source_role` also hands each audience a permission *level*, which the resolver / Offer eligibility can use later.

**Composition rebuild + loop closed (2026-06-15).** The kind-grid/5W1H UI was scrapped (it re-created the tab problem) for **one list + "add a thing"**: kinds are free labels (CHECK dropped, `20260615140000`); per-kind scalars live in `conference_entities.attributes` jsonb (`20260615130000`, no per-kind tables); the core gesture is **composition** — plug things into things via typed, quantified references (`includes`/`involved_in`/`when`/`where`/`who`/`about`/`instance_of`). **Type → instances** (`stampInstances`, `instance_of`) replaces the dozens-of-copies spreadsheet. **Open-questions loop** (`needs_definition`, `20260615150000`): coining a thing inline flags it a stub until defined; the worklist is kind-aware (`requiredRoles`, Offer-needs-who/price). Pure, tested logic in `lib/conference/entity-graph.ts` (effectiveRefs inheritance, openQuestions, wouldCycleIncludes) + `lib/conference/entity-commerce.ts` (expandOffer, resolveAccess) — 21 unit tests. **Loop closed** (`20260615160000`, isolated from the live Stripe/product engine): `mint_entity_offer_purchase` (recursive `includes` expansion w/ quantity) + `resolve_holder_access` (includes+involved_in reachability) RPCs; `check:entity-commerce-live` 6/6 proves buy-Booth→mint-4-regs+Day×4 and a non-member holding a bundled reg gets Trade Show access (the bundling/"bankruptcy" scenario, native). Remaining before adoption: collapse instances under type, search/filter, bidirectional "everything about X", retire old tabs/facets, and unify this commerce path with the real order/Stripe flow.

## 7. Decisions (resolved 2026-06-12)

1. **Booth packages: nuke and rebuild as grants.** The `metadata.day_pattern` / color / feature JSON conventions on booth products are replaced: day patterns become `day_access` grants with per-day `access_kind` (`floor` | `meeting`); presentation attributes become explicit product display columns. The `booth_product_id` FK linkage on `conference_booths` is kept.
2. **Wishlist/board-decision flow mints balances on charge.** `runWishlistBilling` → successful charge goes through the same fulfillment path as checkout (order → items → `grant_balances`). One minting code path, two entrances.
3. **Swap eligibility stays in the rules engine.** Swaps consume `resolveEffectiveAccess` for what a person *has* (Phase 4) but the rules engine decides what swaps are *allowed*.
4. **Registration custom questions re-home under Fulfill obligations.** The existing registration-schema builder is kept; its questions become data obligations attached to grant assignment (answered during drip-feed, tracked alongside built-in obligations like emergency contact).
