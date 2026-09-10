# QBO customer match — 21 unlinked active orgs
Read-only pass · 294 QBO customers scanned · 2026-08-21

## Root cause

CSC's QuickBooks file stores most customers with the **contact person as `DisplayName`**
and the **institution/company as `CompanyName`**:

| QBO Id | DisplayName | CompanyName |
|---|---|---|
| 79 | Jill Lewis | University of Guelph |
| 143 | Aesha Brown | Sheridan College |

`findQBCustomer()` (lib/quickbooks/client.ts) queries `WHERE DisplayName = '<org name>'`
**only**. It can never match these records. That is why these 21 orgs were never linked —
not a failed sync, a lookup that searches the wrong field.

## Confirmed matches — CompanyName exactly equals our org name (18)

| Our org | QBO Id | DisplayName | Matched on |
|---|---|---|---|
| Lakehead University | 43 | Kimberly Zuback | CompanyName ⚠ dup, see below |
| Mount Royal University | 55 | Jason Unsworth | CompanyName |
| Sheridan College | 143 | Aesha Brown | CompanyName |
| Toronto Metropolitan University | 66 | Kelly Abraham | CompanyName (already renamed from Ryerson) |
| University of Guelph | 79 | Jill Lewis | CompanyName |
| University of Lethbridge | 80 | Kari Tanaka | CompanyName |
| Agency 1008 | 178 | Catherine Dupuis | CompanyName = "Agency 1008" ✓ your billing-name call |
| Ahead | 95 | Chris Tamas | CompanyName |
| Cesium | 105 | Adam Raisin | CompanyName |
| Craftwell | 188 | Margaret Tavares | CompanyName |
| Dubwear | 109 | Paul Dub | CompanyName ⚠ dup, see below |
| Dynasty Sportswear Inc. | 316 | Dynasty Sportswear | DisplayName (suffix) |
| EZ Passport Studio | 344 | EZ Passport Studio | exact |
| G&G Brands | 217 | Jaime Bryant, Jessica German | CompanyName |
| JPT America, Inc. | 180 | Tasuku Fuke | CompanyName |
| JPT Sales Ltd | 116 | Chuck Tukrel | CompanyName |
| Sock Rocket | 345 | Sock Rocket | exact — **exists already**, not new |
| WillLand Outdoors | 137 | Patrick Jing | CompanyName |

## Genuinely new — zero QBO records (3)

`Momentec`, `RAINS Sales Canada Inc.`, `Stanfield's` — confirmed by substring search on
both DisplayName and CompanyName. Nothing to link; they'll be created on first export.

## Pre-existing duplicates in QBO — need a decision (2)

| Our org | Candidate A | Candidate B |
|---|---|---|
| Lakehead University | **43** Kimberly Zuback / "Lakehead University" — holds the invoice history | 256 "Lakehead University (Bookstore)" |
| Dubwear | **109** Paul Dub / "Dubwear" | 323 "Dubwear Clothing Co." |

## Member dues history — does "paid through Aug 31, 2026" hold?

| Org | QBO evidence | Open 2026-27 invoice | Verdict |
|---|---|---|---|
| Lakehead | Invoice #691 · 2025-11-11 · $830.55 · paid | $830.55 | ✅ matches |
| Toronto Metropolitan | #STRIPE-RIb8Ue76 · 2025-11-27 · $1,130.00 · paid | $1,130.00 | ✅ matches |
| Lethbridge | Invoice #00726 · 2025-12-18 · $771.75 · paid | $771.75 | ✅ matches |
| Mount Royal | SalesReceipt · 2025-11-24 · $939.75 | $939.75 | ✅ matches |
| Sheridan | SalesReceipt · 2026-01-22 · **$734.48** | $1,130.00 | ⚠ does not match |
| Guelph | SalesReceipt · 2025-11-18 · **$2,231.72** | $1,130.00 | ⚠ does not match |

Four of six paid a 2025-26 amount in Nov–Dec 2025 that exactly equals their 2026-27
assessment — consistent with "covered through Aug 31, 2026." Sheridan and Guelph need
the receipt detail opened before assuming the same.

## Recommended code fix

`findQBCustomer` should search `CompanyName` as well as `DisplayName`, otherwise the
next unlinked org to pay still spawns a duplicate.

---

# Duplicates created by 2026 activity (scan 2026-08-21)

294 QBO customers. **45 created in 2026; 17 of those between Aug 5–20, 2026** — i.e. after
the Aug 2 membership invoice run and during conference sales.

## Two generations, and why the second exists

- **Gen 1 (Oct–Dec 2025, ids ~3–260):** filed with the **contact person as DisplayName**,
  institution in CompanyName. e.g. `36 Tina Shannon / Dalhousie University`.
- **Gen 2 (2026, ids 267–352):** filed with the **org name as DisplayName**, CompanyName empty.

`findQBCustomer` searched DisplayName only → never saw Gen 1 → `createQBCustomer` minted
Gen 2. Every Gen-2 record with a Gen-1 twin is a duplicate this pipeline created.

## Our orgs pointing at a duplicate — 13

| Our org | Points at | Created | Balance on dup | Older twin (Gen 1) |
|---|---|---|---|---|
| McMaster University | **336** | 2026-08-05 | **$130.00** | 50 Zachary Fisher; also 268 Diane Warwick |
| OntarioTech University | **337** | 2026-08-05 | **$95.55** | 61 Melissa Price |
| University of Saskatchewan | **338** | 2026-08-06 | **$52.50** | 84 Christine Smith |
| Jacor Marketing Inc. | 340 | 2026-08-12 | $0.00 | 114 Stewart Robinson |
| Milburn Universal Designs | 341 | 2026-08-12 | $0.00 | 162 Frank Paletta |
| Boxercraft | 342 | 2026-08-13 | $0.00 | 101 Ericka Shipp |
| MV Sport | 346 | 2026-08-17 | $0.00 | 119 Mary Schwike |
| Dalhousie University | 348 | 2026-08-18 | $0.00 | 36 Tina Shannon |
| Redeemer University | 349 | 2026-08-18 | $0.00 | 64 Kristel Forcier ("Redeemer College") |
| Bookware | 351 | 2026-08-19 | $0.00 | 102 Peter Osborne |
| NAIT | 352 | 2026-08-20 | $0.00 | 56 Kim Allen; also 291 Bridget McLean |
| Thompson River University | 287 | 2026-01-21 | $0.00 | 74 Sheandra Stewart |
| Campus Outfitters *(canceled)* | 313 | 2026-03-08 | $0.00 | 145 Caitlin Pirtovshek |

## 2026-created and genuinely NOT duplicates — leave alone

`339 Crestar` · `343 DGN Apparel - Layer` · `344 EZ Passport Studio` · `345 Sock Rocket`
· `347 Ambassador Education Solutions` · `316 Dynasty Sportswear`

## Unlinked 2026 orphans that duplicate a Gen-1 record

`350 Niagara River Trading Company` (twin 123) · `323 Dubwear Clothing Co.` (twin 109)
· `274 DGN Marketing` (twin 107)

## Why the code fix alone does not clear these

For all 13, our DB already stores the **duplicate's** id, so `resolveQBCustomer` takes the
`knownId` path and keeps posting to the duplicate. The CompanyName fallback only prevents
*new* ones. These need: merge in QBO first, then repoint `quickbooks_customer_id` to the
surviving id.

Also note the pre-2026 clusters (~30 more) — Gen 1 already contained person+org pairs for
the same institution (e.g. `54 Karen Mathieu` and `193 Mount Saint Vincent`). Those predate
this year and are a separate cleanup.
