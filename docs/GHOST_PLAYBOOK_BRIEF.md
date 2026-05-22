# Ghost Playbook System — Product Brief

**Status:** Scoped, not started  
**Depends on:** Partner Intelligence Layer (signals engine), Circle API credentials for Butler + Suggestion  
**Priority:** Post-launch, after signals engine V1

---

## The Concept

The website knows a lot about every logged-in user — their org type, benchmarking status, event history, peer group, Circle activity. Right now that knowledge just sits in the database. The Ghost Playbook system is the layer that surfaces it as action.

Two ghosts. Two distinct contracts with the user:

**Butler Ghost — "We know"**  
Facts about your specific situation derived from data we have. Neutral, informational. Not alarming, not guessing. "Here is the state of your world." Members trust Butler because Butler doesn't speculate.

**Suggestion Ghost — "We're suggesting"**  
Inferences, matches, and opportunities derived from comparing you to the rest of the network. Light, invitational. "Here is something worth your attention." Members understand Suggestion is a recommendation, not a fact.

This distinction matters because it tells the user *why* they're being told something. The trust contract is implicit in which ghost is speaking.

---

## Signal Taxonomy

### Butler's domain — things that are true about you

| Signal | Example prompt |
|--------|---------------|
| Profile recency | "Your partner profile hasn't been updated in 14 months. Members search by category — is it still accurate?" |
| Benchmarking submission | "Your store is the only one in your peer group that hasn't submitted this cycle." |
| Event attendance gap | "You haven't attended a CSC event since [year]." |
| Conference registration | "Conference is 7 weeks out. You're not registered." |
| Circle inactivity | "You haven't posted in the partner space in 4 months." |
| Profile completeness | "Your listing is missing product categories — the fields members filter by most." |
| Catalogue staleness | "Your catalogue was last updated 14 months ago." |

### Suggestion's domain — things that might be relevant to you

| Signal | Example prompt |
|--------|---------------|
| Event tag matching | "There's a webinar next week on Course Materials. Matches your categories — worth a look." |
| New members in category | "6 campus stores joined CSC since you last engaged. Some are in your product category." |
| Circle discussion match | "There's an active thread in the partner space about POS systems this week." |
| Peer store activity | "3 stores similar to yours in size and mandate just submitted benchmarking." |
| Structural peer finder | "University of X looks a lot like your store — same size, same mandate, same province. You've never crossed paths here." |
| Partner activity benchmarking | "Most active partners in your category have posted twice this cycle. You haven't posted yet." |

---

## Architecture

### Data layers

**Real-time queries (run at page load, cheap):**
- Conference countdown + user's RSVP status
- New members since user's last login/engagement
- Upcoming events matching user's tag profile
- Active Circle discussions in user's category

**Pre-computed scores (nightly job → stored in `ghost_signals` table):**
- Profile completeness score
- Days since last profile update
- Days since last Circle post
- Submission status vs. peer group
- Engagement score relative to peer partners
- Network density (how many relevant orgs has this user ever had a touchpoint with)

Reading pre-computed scores at render time keeps the Playbook surface fast. The nightly job does the heavy lifting.

### Delivery channels

**On the website (primary)**  
The Playbook surface — a personalized action strip that appears for logged-in users. Butler and Suggestion each have distinct visual treatment. Butler = status indicator weight. Suggestion = dismissible recommendation card weight. Ghost avatars are the visual vocabulary.

**In Circle (secondary push)**  
When a signal fires and the user isn't on the website, Butler or Suggestion DMs them in Circle. The website is the brain. The ghost is the voice. This requires Circle API credentials for each ghost bot account.

---

## Ghost Roles (confirmed)

| Ghost | Status | Domain |
|-------|--------|--------|
| Butler Ghost | Already wired | Factual context — "we know" |
| Suggestion Ghost | Wire in | Recommendations — "we're suggesting" |
| Confession Ghost | Keep manual | Anonymous posting (user-initiated) |
| Rant Ghost | Keep manual | Anonymous posting (user-initiated) |
| Helpful Ghost | Defer | TBD |

Confession and Rant stay manual because they're reactive — someone has to decide to use them. The website can surface "post this anonymously" as a UI affordance that directs users to DM the right ghost, without any automation needed.

---

## Naming Convention

**Retire "Toolkit"** as a general term — it now means two different things (the modal management panel on events/documents, and the partner action page).

- Modal management panel → **Manage** (contextual: "Manage this event", "Manage this document")
- Partner action page (`/toolkit`) → **Playbook** (`/playbook`)
- The system as a whole → **Ghost Playbook**
- Individual signals → **Butler says** / **Suggestion says**

---

## What Needs to Be Built

### Phase 1 — Foundation (prerequisite for everything)

1. **`ghost_signals` table** — stores pre-computed scores per user/org
   - `user_id`, `org_id`, `signal_type`, `value`, `computed_at`, `expires_at`
   
2. **Nightly signals job** — computes and writes scores
   - Profile completeness, recency, Circle activity gap, peer comparison
   - Runs as a scheduled Edge Function or cron

3. **Signal query layer** — reads pre-computed + real-time signals and returns an ordered list for a given user

### Phase 2 — Website surface

4. **`PlaybookStrip` component** — server-rendered, appears for logged-in users
   - Reads signal query output
   - Renders Butler signals with Butler avatar + factual tone
   - Renders Suggestion signals with Suggestion avatar + invitational tone
   - Max 2-3 signals shown at once, ranked by urgency

5. **`/playbook` page** — full aggregated view
   - All signals for this user, grouped by Butler / Suggestion
   - Dismissible items (stored in `ghost_signal_dismissals` table)
   - Links to relevant actions

6. **Rename `/toolkit` → `/playbook`** and update all references

### Phase 3 — Circle push

7. **Butler Circle DM trigger** — when a high-priority Butler signal fires (e.g. conference < 14 days, no registration), DM the user via Butler Ghost in Circle
8. **Suggestion Circle DM trigger** — weekly digest of top Suggestion signals, delivered via Suggestion Ghost

### Phase 4 — Member-side signals

9. Same architecture, different signal set — benchmarking peer gaps, event matching, peer finder suggestions
10. Playbook strip appears on member pages with member-relevant signals

---

## Scope for Stub (now)

- Rename `/toolkit` → `/playbook` + update ThreeDoors CTA
- Rename modal management panel references from "Toolkit" to "Manage"
- Add placeholder Playbook strip (dashed border, ghost avatars, "personalized signals coming soon" copy)
- Document confirmed Circle credentials needed for Butler + Suggestion API posting

---

## Open Questions

1. Does Butler Ghost have its own Circle API token, or does it post via the community admin key? Determines whether we can post *as* Butler or just *about* Butler.
2. What's the right dismissal UX — does a dismissed signal come back after a set time, or stay dismissed until the underlying condition changes?
3. For members (vs. partners), which signals are highest priority? The data exists for both but member signals need separate prioritization.
4. Is the Playbook strip global (appears on every page when logged in) or page-specific?
