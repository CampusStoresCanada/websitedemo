# CSC Platform — Onboarding Journey Reference

> **Purpose of this document:** A living reference for the onboarding journey system.
> Update this when step content changes, timing is adjusted, or new journeys are added.
> This document is also the basis for community feedback — when we ask org admins what
> worked and what didn't, this is what we're improving.

---

## The Problem This Solves

The old state: "If something's wrong, email Steve."

The new state: org admins understand they are the stewards of their institution's presence
on the platform. They have real tools — the Toolkit — to control what their members see,
what vendor partners see, and what's public. They don't need an intermediary.

Onboarding exists to make that transfer of understanding happen without overwhelming anyone.

---

## Design Principles

1. **Not all at once.** The journey runs over weeks, not a single session. One idea at a time.
2. **Earning the ask.** We give context and capability before we ask for photos and better descriptions.
3. **Familiar patterns.** Profile pages look like profiles. The FAB looks like FABs. Inline editing
   feels like Notion or Google Docs. We're not teaching a new system — we're pointing at
   familiar patterns and saying "yes, that's exactly what you think it is."
4. **Feel successful early.** The first thing they do should produce a visible result. Inline edit,
   instant save. That moment is the proof of concept for everything else.
5. **Keeners and stragglers both.** Fast movers get action-based triggers — we meet them where they
   are. Slow movers get time-based reminders — we keep nudging until it's done.
6. **Permanent infrastructure.** This is not a launch campaign. Every org admin who ever joins CSC
   goes through this journey. The journey is the standard, not the exception.

---

## Personas

Each persona gets a separate journey. They are genuinely different roles with different
capabilities, different things to learn, and different things we need from them.

| Persona | Journey Status |
|---|---|
| **Org Admin** | ✅ Defined (this document) |
| **Member** (individual) | 🔲 To be designed |
| **Vendor Partner** | 🔲 To be designed |
| **Board / Super Admin** | 🔲 To be designed |

---

## The Ecosystem Context

Before building or updating any step, keep this in mind:

The platform is **one connected ecosystem**, not a website with bolt-on tools.

- **The Toolkit** (floating button, bottom-right) is the universal interface. It follows every
  logged-in user across every page. Tools vary by permission but the instrument is the same.
  Tools: Edit, Create Event, Explain, Flag, Share, Export, Bookmark.
- **Circle / Member Space** is not a separate application. Same login, same identity, same
  notifications. When an org admin opens Member Space, they're still on the same platform.
- **Visibility is layered.** An org admin controls three audiences simultaneously: their own
  members, vendor partners, and the general public. What each sees is not the same.

The onboarding journey for an org admin is built around one core message:
> *"You're not just a user here. You're the steward of how your institution appears to the
> entire CSC network. You have real tools to manage that. Here's how."*

---

## Trigger Types

### Time-based
Fires on a schedule relative to `journey_started_at`. Fires regardless of platform activity.
Ensures slow movers still receive every step.

### Action-based
Fires when a specific action is detected (first visit to a page, first edit, first bookmark).
Meets keeners where they are — if they visit the Members map on Day 1, they get that
callout Day 1, not Week 2.

### Conditional
Some steps only make sense when platform state is right. Conference delegate nudge only fires
when a conference is active. Benchmarking nudge only fires when a survey is open.

### Reminder logic
Before any reminder fires, the cron checks the completion condition. If the step is already
done, the reminder is skipped and marked as such. Reminders never nag for something finished.

---

## Delivery Channels

| Channel | When to use |
|---|---|
| **In-app alert** | Contextual, page-specific callouts. First visit to a section. The Toolkit callout on their org page. |
| **Email (Resend)** | Drip nudges. The "did you know" and "have you sorted X yet" messages. Always conversational tone. |
| **Both** | High-priority steps where we need to make sure they see it. |

**Tone across all channels:** Conversational. Never instructional. "Did you know you can..."
not "Step 3: Configure visibility settings." Read like a colleague, not a manual.

---

## Org Admin Journey Map

### Session 1 — First Login
**Goal:** Feel at home. Make one thing happen. Nothing else.

| | |
|---|---|
| **Step key** | `session_1_welcome` |
| **Trigger** | Account first login (`users.onboarding_completed = false`) |
| **Channel** | In-app modal |
| **Reminder** | None |
| **Completion** | Modal dismissed or "Let's go" clicked |

**What they see:**
A single welcome screen. Personal — uses their name and org name. Sets the authority framing:
"You're the steward of [Institution]'s presence on CSC. You control what your members see,
what vendor partners see, and what's public. You have the tools to change any of it, right
now." One CTA: "Show me" → lands them on `/org/[slug]`.

On their org page: one subtle callout to the Toolkit FAB. "This follows you everywhere. Try it."
That's the entire first session. No list of features. No tour. Just the frame and the instrument.

---

### Days 1–3 — The Profile
**Goal:** Get the org description and visual identity in good shape.

| Step key | Nudge | Timing | Reminder |
|---|---|---|---|
| `profile_description` | "Your description is what members and partners read first — does it still say what you want?" | Day 2 | Day 7 if not done |
| `profile_logo` | "You haven't got a logo on here yet." / "Your logo could use an update." | Day 2 | Day 10 if not done |
| `profile_hero` | "A hero image makes your profile stand out in the directory." | Day 3 | Day 14 if not done |

**Channel:** In-app on their org page + email
**Completion condition:** Field is non-null / updated after journey start

---

### Days 3–7 — Your People
**Goal:** Get contacts added and sorted. Photos on the faces members actually call.

| Step key | Nudge | Timing | Reminder |
|---|---|---|---|
| `contacts_sorted` | "Who's the right person for partners to call? Make sure your contacts are sorted." | Day 4 | Day 14 if not done |
| `contact_photos` | "Contact photos make a difference — members check these before reaching out." | Day 5 | Day 21 if not done |
| `conference_delegates` | "Have you got staff sorted for the conference yet?" | Day 5 | Weekly until done |

**Channel:** Email primary, in-app on org page
**Note:** `conference_delegates` only fires if a conference is active or within 60 days of opening.

---

### Week 2 — Visibility Control
**Goal:** They understand that they're managing layered audiences, not one public profile.

| Step key | Nudge | Timing | Reminder |
|---|---|---|---|
| `visibility_intro` | "Did you know you control what vendor partners see about [Institution]? It's not the same view your members get." | Day 10 | Day 21 if not opened |

**Channel:** Email
**Completion condition:** They visit their org page after receiving this nudge (proxy for engagement)
**Note:** This is the most conceptually important nudge. The framing matters — it should feel like
a revelation, not a settings menu.

---

### Weeks 2–3 — The Network
**Goal:** They discover the people and organisations they're now connected to.

| Step key | Nudge | Timing | Reminder |
|---|---|---|---|
| `network_members` | Contextual callout on first visit: "These are your peers. [Province] has [X] other stores." | First visit to `/members` OR Day 14 | None — informational |
| `network_partners` | Contextual callout: "These are the vendors active on CSC. They can see your profile." | First visit to `/partners` OR Day 14 | None |
| `network_member_space` | "This isn't a separate login. Same you, same platform." | First visit to Member Space OR Day 17 | Day 28 if not visited |

**Channel:** In-app contextual (first visit) + email (time-based fallback)
**Completion condition:** Page visited

---

### Week 3+ — Events
**Goal:** They know events exist and that they're personalised to their institution.

| Step key | Nudge | Timing | Reminder |
|---|---|---|---|
| `events_discovery` | "There are [X] events coming up for [Province] stores." Pulls from their actual tags. | Day 18 | Day 30 if not visited |

**Channel:** Email (personalised — province, NACS dept, CanColl flag)
**Completion condition:** Visit to `/events`

---

### Ongoing — Conference *(conditional)*
**Trigger:** Conference status becomes active or opens for registration.

| Step key | Nudge | Reminder |
|---|---|---|
| `conference_delegates` | "Registration is open. Have you sorted your delegates yet?" | Weekly until delegates assigned |

**Channel:** Email + in-app alert

---

### Annual — Benchmarking *(conditional)*
**Trigger:** Benchmarking survey status becomes `open`.

| Step key | Nudge | Reminder |
|---|---|---|
| `benchmarking_survey` | "The survey is open. [X] peer institutions are already in." | 2 weeks before close if not submitted |

**Channel:** Email + in-app alert

---

## All Step Keys (Canonical List)

For implementation reference. These are the keys stored in `user_onboarding_progress`.

```
session_1_welcome
profile_description
profile_logo
profile_hero
contacts_sorted
contact_photos
conference_delegates
visibility_intro
network_members
network_partners
network_member_space
events_discovery
benchmarking_survey
```

---

## What "Complete" Looks Like

The journey has no hard finish line by design. Benchmarking and conference steps recur.
But for reporting purposes, an org admin is considered **onboarding-complete** when all
non-conditional steps are marked done:

```
session_1_welcome
profile_description
profile_logo
profile_hero
contacts_sorted
contact_photos
visibility_intro
network_members
network_partners
network_member_space
events_discovery
```

At that point `users.onboarding_completed = true` can be set.
Conditional steps (`conference_delegates`, `benchmarking_survey`) continue to fire independently.

---

## Feedback & Iteration

This document should be updated when:
- A nudge consistently goes unread (reconsider timing or channel)
- Completion rates for a step are low (reconsider the ask or the framing)
- The community flags something as confusing or missing
- A new platform capability is added that org admins should know about

Community feedback mechanism: TBD — potentially a periodic survey or a Circle discussion
thread asking org admins what they wish they'd known sooner.

---

*Last updated: 2026-05-26*
*Owner: CSC Platform Team*
