# CSC Sponsorship Platform

**Status:** Planned — ready to build  
**Date:** 2026-04-15  
**Revenue target:** $70k/year ($30k Platinum + $20k × 2 Gold)

---

## Strategic Context

Sponsorship is not a conference feature. It is a **platform** that the conference, website, and Circle community all consume. The goal is to make a $20–30k sponsorship demonstrably worth the ask — not through logo placement alone, but through year-round presence, intelligence tools, and genuine community standing.

The audience is what makes this valuable: campus store decision-makers at Canadian colleges and universities. Hard to reach, specific, and controlling purchasing budgets. No other channel gives a vendor this access.

---

## Tier Structure

### Platinum — $30k (1 sponsor, likely CANCOLL)

CANCOLL is a buying group: they negotiate rates with suppliers and member institutions receive dividends. Their sponsorship is a **data and intelligence play**, not recognition.

**Conference:**
- Sponsors member travel to/from the conference (travel host attribution on registration + communications)
- Premium booth placement
- Matchmaking priority in the scheduler

**Data tools (the real product):**
- Private CANCOLL data portal — member vs. non-member purchasing aggregations, SKU/category-level analysis, dividend ROI evidence
- Built on the same benchmarking infrastructure, using CANCOLL-flagged orgs as the lens
- Annual private "State of the Industry" report tailored to their intelligence needs

**Year-round:**
- Top-tier recognition on all sponsor surfaces
- Circle: elevated community standing, ability to post in community spaces
- Named presenting sponsor of the public partner report (see below)

---

### Gold — $20k each (2 sponsors, one per offsite event)

Gold sponsors are **existing partners** who already know the campus store market. This tier is about depth, not breadth — deepening relationships with people they already do business with, being visibly woven into the community fabric year-round.

Exclusivity: two slots, one per offsite. A sponsor may not purchase both slots (community diversity matters more than the revenue premium). If they ask, push back.

**Conference:**
- Named host of their offsite event
- Recognition in all conference materials, schedule, and signage

**Year-round:**
- Circle: dedicated partner space, "Community Partner" tag, one sponsored AMA or event per year
- Website: Gold tier badge on partner profile + featured placement on `/partners` directory
- Annual partner "State of the Industry" report — full access (see below)

---

## The Partner Report — Shared Anchor Asset

One infrastructure build, two audiences:

| Version | Audience | Content |
|---|---|---|
| **Private (Platinum)** | CANCOLL | Member vs. non-member data, SKU-level purchasing, dividend ROI evidence |
| **Public (Gold + CSC marketing)** | Partners + prospects | Market size, how members buy, what they value, where the industry is going |

The public version doubles as CSC's best recruitment tool for new partners and members. It is the partner-facing equivalent of what benchmarking is for financially-minded members.

---

## Architecture

### Core Principle

> The sponsorship system is neutral. It knows about tiers, agreements, and placements. Everything else — the conference, Circle, the website — hooks into it as a consumer.

### Data Model

```
sponsor_tiers          → what you're selling (admin-configurable)
sponsor_agreements     → who bought what, when, at what tier
sponsor_placement_slots → registry of WHERE sponsors can appear
sponsor_placements     → active placements per agreement
```

Benefits bridge tiers and effects. They live in two places:
- **Code registry:** typed map of what each benefit key means and what it does
- **Database (on tiers):** which benefit keys belong to which tier, with per-benefit config

This means an admin can add/remove benefits from a tier in the GUI without a deploy. Adding a new benefit *type* with a new coded effect requires a deploy — but wiring it to a tier is GUI-only from that point forward.

### Schema

```sql
sponsor_tiers (
  id uuid PK,
  name text,               -- "Platinum", "Gold"
  slug text UNIQUE,        -- "platinum", "gold"
  description text,
  price_cents integer,
  color text,              -- for badges and UI chrome
  display_order integer,
  is_active boolean,
  max_sponsors integer,    -- null = unlimited
  benefits jsonb,          -- array of { key, label, config } objects
  created_at, updated_at
)

sponsor_agreements (
  id uuid PK,
  organization_id uuid → organizations,
  tier_id uuid → sponsor_tiers,
  status text,             -- draft | active | expired | cancelled
  start_date date,
  end_date date,
  signed_at timestamptz,
  signed_by_contact_id uuid → contacts,
  custom_benefits jsonb,   -- per-agreement overrides/additions to tier defaults
  notes text,
  created_at, updated_at
)

sponsor_placement_slots (
  id uuid PK,
  key text UNIQUE,         -- "homepage_featured", "partners_page", etc.
  label text,
  description text,
  location text,           -- 'website' | 'email' | 'circle' | 'conference'
  config_schema jsonb,     -- drives what fields appear in placement editor
  is_active boolean,
  display_order integer,
  created_at
)

sponsor_placements (
  id uuid PK,
  agreement_id uuid → sponsor_agreements,
  slot_id uuid → sponsor_placement_slots,
  logo_url text,
  link_url text,
  config_json jsonb,       -- slot-specific overrides
  display_order integer,
  start_date date,
  end_date date,
  is_active boolean,
  created_at, updated_at
)
```

Also needed on `organizations`:
```sql
ALTER TABLE organizations ADD COLUMN is_cancoll_member boolean DEFAULT false;
ALTER TABLE organizations ADD COLUMN cancoll_tier text; -- e.g. 'member', 'preferred'
```

### Benefit Key Registry

| Key | Category | Provisioning |
|---|---|---|
| `logo_homepage_featured` | website | automatic |
| `logo_partners_page` | website | automatic |
| `logo_conference_page` | conference | automatic |
| `partner_report_access` | report | automatic |
| `cancoll_report_access` | report | automatic |
| `circle_partner_space` | circle | triggered (sync queue) |
| `circle_community_tag` | circle | triggered (sync queue) |
| `circle_ama_slots` | circle | manual + tracked (`{ count: N }`) |
| `conference_exhibitor` | conference | links to conference instance |
| `conference_offsite_host` | conference | links to offsite event id |
| `conference_travel_host` | conference | manual + tracked |
| `conference_speaking_slot` | conference | links to program item |
| `job_board_posts` | website | automatic (quota) |
| `email_broadcast_slots` | email | manual + tracked (`{ count: N }`) |

Conference-specific benefits take a `reference_id` in their config pointing to the specific conference instance or offsite event. This is how a Gold agreement gets wired to a specific year's offsite without hardcoding anything.

### How the Conference Consumes Sponsorship

- Conference page queries `sponsor_placements` for slot key `logo_conference_page`, filtered to active agreements covering the conference's date range
- The `sponsorship_ops` schedule module (already exists in the codebase) references `agreement_id` rather than storing sponsor data as freeform JSON
- Offsite events (`is_sponsored`, `sponsor_name`, `sponsor_tier`) are populated from the linked agreement, not entered manually

### How Circle Consumes Sponsorship

When an agreement transitions to `active`:
1. Each triggered benefit enqueues a `circle_sync_queue` operation (existing infrastructure)
2. New operation type: `provision_sponsor_space` — creates the dedicated Circle space with org branding
3. When agreement expires: reverse operations are enqueued automatically

Existing Circle operations already available: `add_to_space`, `add_tag`, `add_to_access_group`, `update_profile`, `send_dm`.

---

## Admin GUI — `/admin/sponsorships`

Four panels, all GUI-managed, no deploys needed for content changes:

**1. Tiers**  
Full CRUD. Name, slug, price, color, max sponsors, display order. Benefit builder: add/remove benefits from the registry with per-benefit config (e.g., `circle_ama_slots: { count: 2 }`). Toggle active/inactive.

**2. Agreements**  
Create agreement: select org + tier + dates. Status workflow (draft → active → expired). Per-agreement benefit overrides. Notes field. Signed document URL. Activating triggers provisioning queue for triggered benefits.

**3. Placements**  
Per active agreement: all placement slots the tier entitles them to. Admin configures logo URL, link URL, display order, date range per slot. Can activate/deactivate individual placements without touching the agreement.

**4. Placement Slots**  
Registry of WHERE things can appear. Admin can add a new slot (e.g., `conference_2027_registration_page`) without a deploy. Config schema field drives what appears in the placement editor.

### What Admin Can Change Without a Deploy
- Tier names, prices, descriptions, colors, ordering
- Which benefits each tier includes and their per-benefit configuration
- Which orgs are sponsors and at what tier
- Every placement: logo, link, order, dates, active state
- New placement slot definitions
- Agreement notes, status, custom benefit overrides

### What Requires a Deploy
- Adding a new benefit key that has a new coded effect (new Circle operation type, new report type, etc.)
- New UI components for new placement slot types

---

## Build Order

### Phase 1 — Foundation
1. Schema migration: `sponsor_tiers`, `sponsor_agreements`, `sponsor_placement_slots`, `sponsor_placements`
2. Add `is_cancoll_member`, `cancoll_tier` to `organizations`
3. Seed initial tiers (Platinum, Gold) and placement slots
4. TypeScript types + server actions for CRUD
5. `/admin/sponsorships` — four-panel admin UI

### Phase 2 — Surface
6. Sponsor tier badges on org profiles and partner directory
7. Homepage sponsor section (featured, distinct from general logo carousel)
8. `/sponsors` public page
9. Conference page consumption (query placements by slot key + date range)
10. Wire `sponsorship_ops` schedule module to agreements instead of freeform JSON

### Phase 3 — Circle & Year-Round
11. `provision_sponsor_space` Circle operation type
12. Benefit provisioning on agreement activation/expiry
13. Sponsor AMA and broadcast slot tracking UI

### Phase 4 — Intelligence
14. CANCOLL data portal (benchmarking infrastructure, CANCOLL-flagged orgs as lens)
15. Partner "State of the Industry" report infrastructure
16. Import CANCOLL membership data from Notion

### Phase 5 — ROI & Reporting
17. Sponsor portal (gated section of org profile or `/me`)
18. Engagement metrics collection
19. Quarterly report generation

---

## Open Questions (to revisit)
- Gold price confirmed at $20k? (implied by $40k for both = pushback threshold)
- Job board: sponsor-exclusive perk or open to all partners/members?
- CANCOLL report cadence: annual, or quarterly digest?
- Public "State of the Industry" report: CSC-branded with CANCOLL as presenting sponsor, or co-branded?
