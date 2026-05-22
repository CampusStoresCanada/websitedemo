# Partner Intelligence Layer — Product Brief

**Status:** Scoped, not started  
**Stub shipped:** Yes — `/toolkit` page exists as a placeholder  
**Priority:** Post-launch

---

## The Problem

When a logged-in vendor partner hits the Resources page today, they get a CTA that sends them to their own org profile. The org profile is a read-only view of information they already know. We're not telling them to do anything.

More broadly: CSC has enough data about every partner to have a genuine point of view about what they should do next. We're not using it.

---

## The Concept

A personalized action surface for logged-in partners (and eventually members) that surfaces **signals** — observations derived from what we know — and translates them into specific, timely prompts.

The goal is not a nudge list. It's one or two observations that are genuinely true about this partner's situation right now, with a clear action attached.

> *"The market you came here to reach has grown and you've been invisible to all of it."*

That is a different thing than a countdown timer.

---

## Signal Types

### Recency signals — things that have gone stale
- Partner profile last updated (we have `updated_at` on organizations)
- Last Circle post (via circle_member_mapping + Circle API)
- Last event attended (RSVP table)
- Last time they appeared in any member-facing context

### Gap signals — things that should exist but don't
- No conference booth registration while event date approaches
- In the partner directory but no presence in Circle spaces where their category is discussed
- Contacts listed but profiles incomplete (no bio, photo, role)
- Product categories empty or generic

### Opportunity signals — things happening in the network right now that are relevant to them
- New member stores joined since their last engagement — stores with zero prior touchpoint
- Active Circle discussion in their product category in the last 30 days
- A member store in their buyer profile just submitted benchmarking for the first time (they're leaning in)
- Conference registration open with fewer than N weeks remaining

### Comparative signals — how they stand relative to peers in the partner network
- Most active partners in their category have posted X times this cycle; they've posted zero
- Other exhibitors from last conference have already registered for this one
- Peer partners have X contacts listed; they have Y

---

## Why Signals Compound

A partner who:
- Hasn't updated their profile in 18 months
- AND hasn't posted since before the last conference
- AND there are 6 new member stores in their exact category that joined in the last year

...is not experiencing four separate problems. They have one situation: the market they came here to reach has changed and they've been absent from it. The signal engine should produce one observation, not four badges.

---

## Architecture (When We Build It)

**Real-time queries (cheap, run at page load):**
- Conference countdown + RSVP status
- New members since last engagement
- Recent Circle activity in partner's category

**Pre-computed scores (run on schedule, stored):**
- Engagement score relative to peer partners
- Profile completeness score
- Network density (how many relevant member stores have any touchpoint with this partner)

The pre-computed layer avoids a 400ms+ query on every toolkit page load. Scores get written to a `partner_signals` table on a nightly job and read instantly at render time.

---

## Scope for V1 (Post-Launch)

1. Define the signal schema — what fields/scores get stored and how they're computed
2. Build the nightly signals job
3. Build the `PartnerSignals` component that reads pre-computed scores and renders 1–3 contextual prompts
4. Replace the stub section in `/toolkit` with the live component

**Not in V1:**
- Member-side signals (same concept, different data — scope separately)
- AI-generated signal copy (rules-based is fine to start)
- Push notifications or email triggers off signals (later)

---

## Member-Side (Future)

The same architecture applies to campus store members:
- "Your peer group all submitted benchmarking — you're the only one missing"
- "There are 5 stores structurally similar to yours you've never connected with"
- "You haven't attended an event since [year]"

Scope separately after partner signals are proven.
