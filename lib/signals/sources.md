# Signal sources — the ingestion contract, applied

Every producer answers the same eight questions (`lib/signals/ingest.ts`) and writes one
`signal_events` row shape. A new source never gets its own table, its own scale, or its own
free-text verb — that is how seven incompatible scorers happened the first time.

**Store the act, never the interpretation.** Always populate `rawText`. The resolver will
get better and old rows must stay re-resolvable.

**`occurredAt` is the act's own time**, never ingestion time. A backfill of 870 Circle posts
stamped "today" turns fourteen months of history into one day.

---

## ⛔ The engine must never eat its own output

| The engine did it | A person did it |
|---|---|
| ranked a partner 3rd → `recommendation_impressions` | clicked into that partner → `signal_events` |
| **scheduled a meeting** → `recommendation_impressions` | **swapped out of it / kept it / typed a reason** → `signal_events` |
| showed a recommended list → `recommendation_impressions` | picked one → `signal_events` |

A meeting the solver created is evidence of the solver, not of affinity. Ingest it and the
score rises because the score was high; two cycles later the engine is measuring its own
echo and the numbers look excellent throughout. `assertNotEngineCaused()` exists to make
this a loud failure rather than a quiet drift.

---

## Circle — RSVP, response, membership

`circle_member_mapping` (236 rows vs 986 contacts) decides how much of this can be
attributed — **not whether it is worth keeping**. An act nobody can be matched to is stored
with a null actor: it never reaches the org rollups, but it still counts as demand, and
"someone asked for this" is a fact whether or not we know who.

**⚠️ The same act resolves differently depending on where it happened.** A Circle space is
either a category or a company, and the producer must check which:

| Space | Resolution |
|---|---|
| "Course Materials", "Operations" | `resolveSpaceName()` → taxonomy terms, `termSource: "space"` |
| "Merangue", "VitalSource", "The SomCan Group" | `objectOrgId` = that partner — an affinity edge |
| "General Merchandise" (149 posts) | ⚠️ **neither** — off-taxonomy legacy value, genuinely ambiguous. Resolves to nothing. Auto-mapping it is what produced the legacy mess. |
| "Say Hello", "Announcements" | social, no signal |

| Act | verb | stance | polarity | object |
|---|---|---|---|---|
| Posted in a space | `posted` | implicit | positive | space terms **and/or** the space's org |
| Commented on a post | `commented` | implicit | positive | as above |
| Joined a space | `joined` | implicit | positive | as above — a position held, half-life 730d |
| RSVP'd to an event | `rsvped` | implicit | positive | host org **and** terms from the event title/description |

⚠️ **Dedupe keys are per ACT, not per OBJECT.** A post is written once, but likes and
comments accrue to it for months. `circle:post:{id}` records the post and then skips it
forever, so all later engagement is invisible. Each like is its own act, by its own actor,
at its own time:

    circle:post:{post_id}                     the post
    circle:like:{post_id}:{member_id}         each like, separately
    circle:comment:{comment_id}               each comment
    circle:space_member:{space_id}:{member_id}

Keying on the object is how a system quietly stops noticing that the world moved.

---

## Events — RSVP vs attendance

**Both, always.** They are the same object under two verbs, and the *gap between them is
itself signal*: RSVP'd and never showed is weak interest, and you only learn that by holding
both.

| Act | verb | weight | half-life |
|---|---|---|---|
| RSVP | `rsvped` | 2 | 180d |
| Turned up | `attended` | 3 | 365d |

An exhibitor's event resolves to **two** things — the host org (affinity) and the session's
subject (terms). Producers that record only the org throw away the more transferable half.

---

## Conference badge scans

**A consented, mutual, deliberate act — one of the few in the whole system.**

The QR lives on the **back** of the badge and consent is taken up front, so there are no
drive-by scans. Someone physically turned their badge around. That makes a scan high-intent,
not the ambient noise a trade-show scan usually is.

**Both directions count.** A member scanning a partner is signal in its own right, not the
inverse of the partner's scan:

    actorOrgId = whoever scanned    objectOrgId = whoever was scanned
    verb = "scanned"                stance = implicit, polarity = positive

⚠️ **Not the same act as a printed-directory QR scan**, and they can never merge — a print
scan is anonymous by deliberate design (`lib/publication/scan-tracking.ts` records no person
even when it could), so it has **no `actorOrgId`** and fails validation. Print scans stay in
`directory_scan_events`. `scanned` in `signal_events` therefore means a badge scan, always.

## Website

| Act | verb | stance | object | notes |
|---|---|---|---|---|
| Search | `searched` | implicit | terms via `resolveText()` | `/api/search/partners` already receives this and discards it — the cheapest capture in the system |
| Filter click | `filtered` | implicit | terms, `termSource: "category"` | strongest term source: they picked it out of our own list |
| Opened an org profile | `viewed` | implicit | that org | cheap act, half-life 60d |
| Catalogue / outbound click | `clicked` | implicit | that org | followed through — intent, not a glance |

`source: "website"` is not replayable, so no `dedupeKey` is required.

---

## Conference module (emitted by the scheduler session)

Explicit preference only. Everything here is `stance: "explicit"`.

| Act | verb | polarity |
|---|---|---|
| Declared refusal (`org_meeting_refusals`) | `refused` | negative |
| Top-5 preference | `preferred` | positive |
| Chose a replacement in a swap | `selected` | positive |
| Shown in `alternatives_generated` and passed over; the dropped slot | `rejected` | negative |

`occurredAt` for a refusal = `reaffirmed_at`, falling back to `first_declared_at`.

⛔ **Only `retired_at` ends a refusal.** A stale timestamp means nobody asked, not that the
grudge softened — never infer lapse from silence. The decay on `refused` affects its use as
a *training feature* only; enforcement reads the declaration and never a weight.

⚠️ `admin_override` rows are skipped: a human overruling the system is not the person's
preference.

---

## Email

⚠️ Currently produces nothing — opens and clicks are both 0 because the Resend endpoint was
never re-enabled after the signature fix.

When it is: `opened` is weighted 0.5 and deserves it. Image proxies and Apple Mail Privacy
Protection open mail nobody read. `clicked` is the only email act worth much.

---

## Deliberately NOT signal

- **Anything the engine caused** — see above.
- **Absence.** Not clicking is not dislike. There is no implicit-negative; the validator
  rejects it.

⚠️ Note what is NOT on this list: unattributed behaviour. Every act by a human on these
surfaces is signal, from a page load to a like. Only two things are excluded, and both are
excluded because they are not human acts at all — one is the engine's own output, and the
other never happened.
- **Admin actions on behalf of an org.** A CSC staffer editing a member's profile is not
  that member expressing anything.
- **`audit_log`.** 15,189 of its 25,584 rows are one cron writing to itself and 8,616 are
  auth errors. It is ops telemetry, not member behaviour.
