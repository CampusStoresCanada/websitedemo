# Board Action Items — Mint from Minutes

**Status:** Spec for review · 2026-08-19
**Premise:** Action items are minted from the minutes — the only source that already exists and is already structured — graded against a three-test rubric at mint time, and carried forward until they close. The rubric does not block anything. It routes, and it counts.

---

## 0. Why this shape

Three findings from the existing data drove every decision below.

**The spreadsheet is a hand-copy of the minutes.** The 23 June minutes contain exactly three `ACTION:` lines, and they are the same three rows in the action-items spreadsheet, near-verbatim. The sheet was never a second source of truth — it is a lossy transcription with a status column bolted on, which is why it duplicates, drifts, and accumulates cruft. Minting from the minutes makes the sheet unnecessary rather than something to migrate.

**Collective assignment has a zero percent completion rate.** In the spreadsheet, eight items are assigned to "The Board" or "All Board Members". None has ever been completed; the oldest has been open since June 2025. Every item marked COMPLETE — all six — had a named individual owner. That is fourteen months of the board's own evidence, and it is currently invisible.

**We do not make the assignments.** Nobody building this system decides who owns what, and a tool that refuses bad input just gets worked around. So the rubric's job is not enforcement. It is to make the gap legible, monthly, on the meeting record, for the people who *do* decide.

---

## 1. The source contract

The `csc-board-minutes` skill produces minutes containing lines of the form:

```
ACTION:   <owner> to <do the thing>[ by <when>].
```

Observed in production, after HTML tags are stripped:

| Meeting | Form used |
|---|---|
| 2026-05-28 | `ACTION: @Jason Kack to respond to Brent (CEI), acknowledging the oversight…` |
| 2026-06-23 | `ACTION: S. Thomas to remove CEI's access to Circle.` |

Both forms parse. The parser accepts:

- `ACTION:` (case-insensitive), followed by arbitrary whitespace and `&nbsp;` runs
- one action per line; a line ends at `.` followed by whitespace-and-a-digit (the next numbered agenda item) or at a block-level tag
- the owner is the text before the first ` to ` — this is the convention the skill already enforces

**This skill's output format is the contract.** Changing the ACTION line shape breaks the mint. Any edit to the skill should be checked against `parseActionLines()` fixtures.

> The skill currently sources transcripts via a Notion page, which is deliberate — it is how Google Meet transcription is obtained at no cost. That is unrelated to the Notion *board page* creation retired in `547c5a5`, and should not be removed.

---

## 2. Name resolution

Runs on minutes **save**, rewriting bare names to canonical mentions so the stored minutes and the minted items agree.

**Key on surname, not first name.** All twelve directors and staff have distinct surnames, so surname alone resolves uniquely. First names do not: two live aliases would break naive matching.

| Display name | Login email | Trap |
|---|---|---|
| Kevin Liu | `huikai.liu@unb.ca` | Kevin ≠ Huikai |
| Trish Linden-Teasdale | `tlinden@stfx.ca` | board calendar carries `patricia.linden-teasdale@` |

Accepted input forms, all collapsing to one profile:

- `@Stephen Thomas` — already canonical, left alone
- `Stephen Thomas` — full name
- `S. Thomas`, `S Thomas` — initial + surname
- `Thomas` — bare surname
- compounds split on `and`, `&`, `/`, `,` → multiple owners

**Ambiguity is never guessed.** If a surname matches two or more profiles, or matches none, the name is left untouched and the proposed item is flagged `owner_unresolved` for the human. The resolver's candidate pool is the same one the assignee picker uses (`global_role in ('admin','super_admin')`), so the two can never disagree.

---

## 3. The rubric

Three independent tests. Each proposed item passes or fails each one.

| # | Test | Passes when | Fails when |
|---|---|---|---|
| 1 | **One named human** | Resolves to exactly one profile | "Board", "All Board Members", unresolved, or empty |
| 2 | **A completable verb** | *Any* verb in the item denotes an act that ends | *No* completable verb appears anywhere |
| 3 | **A finish line** | A date, or a named deliverable | No date and no observable output |

### Verb lists

**Fail (continuous / stative)** — `continue`, `maintain`, `monitor`, `oversee`, `support`, `promote`, `explore`, `revisit`, `consider`, `prioritize`, `ensure`, `keep`, `be aware`, `look at`, `work on`, `discuss`, `review`

**Pass (completable)** — `send`, `call`, `draft`, `write`, `confirm`, `remove`, `add`, `invite`, `book`, `sign`, `publish`, `create`, `deliver`, `present`, `report back`, `bring back`, `circulate`, `schedule`

**The test is "any", not "lead".** `discuss` and `review` are on the fail list by decision, but a compound item must not be condemned by its opening word:

- *"review the draft policy and report back by the 30th"* — `review` fails, `report back` passes → **action**
- *"review our approach to advocacy"* — no completable verb anywhere → **intention**

Scoring on the lead verb alone would misclassify the first of those, which is a real and common shape in these minutes. Scoring on "any" keeps `review` on the fail list without punishing items that also say what arrives and when.

### Finish line

A date in any parseable form (`by June 30`, `by the next meeting` → resolves to the next meeting's date, `end of March 2026`) **or** a named deliverable the board would recognise as arriving ("bring finalized pricing back to the Board", "circulate the draft"). Language like "at a future meeting" is not a finish line.

### Worked examples, from real records

| Item | 1 | 2 | 3 | Outcome | Actual fate |
|---|:-:|:-:|:-:|---|---|
| `S. Thomas to remove CEI's access to Circle` | ✓ | ✓ | ✓ | **action** | Completed |
| `S. Blackadder to invite Ambassador Education Solutions to present to the Board` | ✓ | ✓ | ✓ | **action** | Completed |
| `S. Thomas to begin building out the registration structure and bring finalized pricing back to the Board by June 30, 2026` | ✓ | ✓ | ✓ | **action** | Completed |
| `Board to continue to promote CSC membership` | ✗ | ✗ | ✗ | **intention** | — |
| `Board to revisit vendor/member value-add concepts at a future meeting` | ✗ | ✗ | ✗ | **intention** | Open since Jan 2026 |
| `The Board to prioritize recruitment efforts, particularly Montreal market` | ✗ | ✗ | ✗ | **intention** | Open since Nov 2025 |

The rubric was written before this table was filled in. Every item that passes all three tests was completed; no item that fails all three ever was.

---

## 4. Routing — action vs intention

A proposal that fails any test is still recorded. It is **not** silently downgraded and **not** discarded.

- **Action** — passes all three. Enters the task system. Notifies.
- **Intention** — fails one or more. Recorded against the meeting, visible on the meeting record and in the minutes, counted in the monthly quality line. **Never notifies anyone, ever.**

**Implement the bucket as a status value, not a parallel flag.** Every existing reminder query whitelists status (`.in("status", ["open","in_progress"])`), so a new status outside that set is silent *by construction* — no query needs changing, and no future query can forget to exclude it. A separate `kind` column would require every notification path to remember a filter, and one omission would mail the board a pile of un-owned intentions.

```sql
-- board_action_items_status_check currently allows: open, in_progress, complete, deferred
ALTER TABLE board_action_items DROP CONSTRAINT board_action_items_status_check;
ALTER TABLE board_action_items ADD CONSTRAINT board_action_items_status_check
  CHECK (status IN ('open','in_progress','complete','deferred','intention'));
```

**Intentions are public and labelled.** They appear on the board-facing meeting record alongside real action items, marked with what they are missing. An item with no owner and no due date is a wish, and the record should say so plainly.

The label is factual, not editorial: **`No owner · No due date`**, not "wish" or any other adjective. The arithmetic in §9 is what lands — a category with a zero percent completion rate over fourteen months is unarguable, whereas a pointed word invites a conversation about tone instead of about the item. Let the record be flat and let the reader draw the conclusion.

**Promotion is clerical and never notifies.** An intention becomes an action when a human gives it an owner and a finish line. The status change itself is not news to anybody — "this is no longer malformed" is not worth a DM. The notification fires on **assignment**, because that is the moment a named person acquires an obligation. In practice the two coincide, since promotion requires an owner; the distinction matters because it means the trigger lives on the assignment, not on the status transition, and a clerical re-grade of an already-owned item stays silent.

---

## 5. Schema changes

| Column / table | Type | Why |
|---|---|---|
| `status` | extend CHECK | Adds `intention`; silent by construction (§4) |
| `quality_flags` | `text[]` default `'{}'` | Which tests failed: `no_owner`, `owner_unresolved`, `uncompletable_verb`, `no_finish_line`. Drives the count in §9 |
| `source` | `text` default `'manual'` | `minutes` \| `manual` \| `backfill` — provenance of the mint |
| `source_excerpt` | `text` nullable | The verbatim ACTION line. Traceability back to the minutes; also the diff target if minutes are re-saved |
| `due_date_original` | `date` nullable | Set once on first mint. Revising `due_date` no longer erases the original commitment (the sheet's REVISED DATE column) |
| `board_action_item_updates` | new table | `(id, item_id, note, author_id, created_at)`. Where the spreadsheet's Update narrative lands — append-only, timestamped, attributed |

No change to `meeting_id`. See §8.

---

## 6. The mint screen

Lives on the meeting detail page, appearing once `minutes_html` is non-empty.

1. **Parse** — extract ACTION lines from the saved minutes. Idempotent: re-running matches on `source_excerpt` and does not duplicate items already minted from the same line.
2. **Propose** — one row per line, each showing the verbatim excerpt, the resolved owner, a parsed due date, and the rubric result with failed tests named in plain language ("no named owner", "'continue' can't be completed").
3. **Edit in place** — the reviewer can assign an owner, set a date, or rewrite the title. The rubric re-evaluates live, so the row visibly flips from intention to action as it is fixed. This is the moment the system teaches the standard.
4. **Confirm** — creates the selected items. Anything not fixed is created as an intention, not dropped.

**Nothing is written until Confirm.** Parsing and grading are pure functions over the minutes text.

---

## 7. Notification safety

The pre-meeting reminder sweep selects **every** open/in_progress item with no due-date filter and sends on two channels. It is the single most dangerous path in this system.

- Items created as `intention` are silent by construction (§4).
- **Backfill and re-mint of historical meetings must stamp `reminder_sent_at` and `pre_meeting_reminder_sent_at` to `now()` at insert.** Without this, minting three past meetings on a Monday before a board meeting mails every assignee once per item.
- The mint screen must set these stamps automatically for any meeting whose date has passed, with no reliance on the reviewer remembering.
- New items minted from a *future* meeting's minutes are left unstamped and notify normally.

---

## 8. Carry-forward — no migration required

`meeting_id` is already correct. It records **where an item was raised** — provenance, immutable. The bug is that the UI reads it as **ownership**, so an item appears at exactly one meeting and vanishes from every subsequent agenda.

Provenance and currency are two different questions, and both are already stored: `meeting_id` and `status`. The fix is a query change, not a column.

```
Agenda for meeting N
  = items where meeting_id = N                        (raised here)
  + items where meeting_id < N and status in (open, in_progress)   (carried)
```

Carried items should render with their origin ("from 27 April, 4 meetings ago"), because age is the signal that matters.

---

## 9. What gets counted

The lever. One line on every meeting record, and a figure on the board widget:

> **June 23 — 3 action items, 4 intentions.** 4 items carried from earlier meetings, oldest raised 11 months ago.

Plus a standing figure that needs no interpretation:

> **Items assigned to "the Board": 8 raised, 0 completed.**

Neither is an opinion about how the board works. Both are arithmetic over the board's own record, surfaced monthly, in front of the people who set assignments. That is the entire theory of change in this document.

---

## 10. Decisions and remaining questions

**Settled 2026-08-19:**

1. **`discuss` and `review` stay on the fail list.** Test 2 scores on "any completable verb", not the lead verb, so compound items that name a deliverable still pass (§3).
2. **Intentions are public and labelled**, on the board-facing meeting record. Label is factual (`No owner · No due date`); the zero-completion figure does the persuading (§4).
3. **Promotion does not notify.** Assignment notifies (§4).
4. **Still-open pre-April items are imported**, anchored as described below.

### Importing the pre-April backlog

`meeting_id` is `NOT NULL`, and the meetings those items were raised at do not exist in the system. Rather than fabricate nine historical meeting rows — which would immediately trip `board_minutes_overdue` for every one of them — anchor them to the earliest real meeting (27 April 2026) and mark the true origin:

- `source = 'backfill'`
- `source_excerpt` carries the original spreadsheet row, including its stated date
- the UI renders provenance from `source_excerpt`, not from `meeting_id`: *"carried in from the action-items spreadsheet, originally raised 27 Nov 2025"*

This fabricates no meetings, tells the truth about age, and keeps the eight collective items visible — which matters, because they are the evidence in §9. Only items still open are imported; anything marked COMPLETE stays in the spreadsheet as history.

All backfilled rows are stamped per §7 and are therefore silent.

**Still open:**

5. **Promotion logging** — is an intention→action promotion a `board_action_item_updates` row, or its own audit action? Leaning update row; it is the same shape as any other progress note.
6. ~~**Ongoing/standing work** has no representation.~~ **Resolved** — see §11.8.

---

## Appendix — what this replaces

| Today | After |
|---|---|
| Action items typed into a spreadsheet from the minutes | Minted from the minutes, sheet retired |
| Status as free text in an Update column (10 spellings observed) | Four statuses plus `intention`, CHECK-constrained |
| Priority typed into the Update column; PRIORITY column empty | Not modelled. Deliberately deferred — see the as-built map |
| Progress narrative overwritten on each edit | Append-only update log |
| Revised dates erase the original | `due_date_original` preserved |
| An item lives at one meeting | Carried forward until closed |
| Un-ownable items indistinguishable from real tasks | Graded, routed, publicly labelled, and counted |
| Pre-April backlog stranded in a spreadsheet | Still-open items imported, provenance preserved |

---

## 11. Sorting and the checklist widget

The widget is a checklist, not a dashboard. The goal is to get items **cleared**,
not to get them read, so the ordering question is "what should this person tick
next" rather than "what is most important in the abstract".

### 11.1 Tiers are lexicographic

Urgency and age must never compete inside one number — that is how a
million-year-old item that should never have been raised outranks something due
on Friday. Items sort into bands first, and **nothing ages into a higher band.**

| Tier | Contents | Sorted by |
|---|---|---|
| 1 · Running out | Dated, due within the urgency window | Soonest first, priority breaks ties |
| 2 · Live work | Dated with runway, or in progress | priority × urgency × ageBoost |
| 3 · Undated / stalled | No date, not started | priority × ageBoost |
| 4 · Held | On hold | Hold date; **does not age** |
| 5 · Unclaimed | Intentions, no owner | Adoptability: shortest and clearest first |

Held items do not age. On Hold carries a stated reason; aging it punishes
honesty and teaches people to leave work quietly rotting in Not Started instead.

Tier 5 sorts differently on purpose. Nobody owns these, so nothing is late and
urgency is meaningless — they compete on how easy they are to adopt. The
volunteer should get a win, so short and well-formed comes first. "Do this one?"
lands very differently when the suggestion is a twenty-minute job than when it
is "explore reviving CRAM".

### 11.2 The saturating age curve

```
ageBoost(days) = 1 + AGE_CEILING × (1 − e^(−days / AGE_TAU))
```

Defaults `AGE_CEILING = 0.5`, `AGE_TAU = 60` days:

| Days open | 0 | 7 | 30 | 60 | 90 | 114 | 365 | ∞ |
|---|---|---|---|---|---|---|---|---|
| Multiplier | 1.00 | 1.06 | 1.20 | 1.32 | 1.39 | 1.43 | 1.50 | 1.50 |

Linear aging is unbounded and reproduces the zombie problem. A hard cap creates
a cliff where every old item collapses to an identical score with no ordering
left. The exponential keeps moving — just less and less — and, crucially,
**earns most of its boost in the first month**, which is when a nudge can still
work. Past that, aging has said all it usefully can and escalation takes over.

### 11.3 Escalation: age produces a verdict, not a bigger number

An item open across `ESCALATION_MEETINGS` board meetings (default 3) with no
movement is not urgent. It is **doubtful**. The honest response is not "do this
today" but *"this has been open across four meetings — is it still real?"*, and
the place that question gets answered is the agenda.

Escalation therefore sets a flag that is **orthogonal to sort position**. The
item does not climb the list; it gets tabled. Deciding an item is no longer real
is a completion too — clearing the list by killing something still clears it.

### 11.4 Row states

The bar is a countdown, not a percentage. It fills as runway disappears, so a
full bar means out of time, not nearly done.

| State | Status value | Bar |
|---|---|---|
| Not started | `open` | Empty |
| In Progress | `in_progress` | Fills from `started_at` toward `due_date` |
| On Hold | `deferred` | Frozen at its fill, 50% saturation |
| Completed | `complete` | Grey, pill filled |

Two mechanics this implies:

- **Starting stamps `started_at`.** A countdown needs a start as well as an end;
  without it, "60% full" means nothing. This also puts the demand for a due date
  at the natural moment — you picked it up, so say when.
- **Holding banks the remaining time.** `held_at` freezes the fill. On resume,
  `due_date` advances by exactly the held duration, so a hold cannot be used to
  quietly buy a month, and the bar resumes where it paused.

Undated items render the due date as **Open** (no date yet) or **Ongoing**
(standing work — the parser's vague-timing flag already tells these apart).
Never blank; blank reads as broken, and both of these are true statements.

### 11.5 Claiming — where malformed work gets repaired

An intention has no owner by definition. Claiming one is therefore the exact
moment the missing pieces must be supplied, and the claim dialog requires them:
an owner (the claimant), a completable phrasing, and a finish line.

You cannot claim "continue to promote CSC membership" into being a task without
fixing it first. The unowned pile stops being a graveyard and becomes the one
place malformed work gets repaired — by a volunteer, at the moment they are most
willing, with nobody being told off in a meeting.

### 11.6 Stats

The third tab. Not a dashboard — the answer to "is any of this working", and the
home for the countable badness that §9 argues is the whole theory of change.

**Completion by assignment** — the finding that carries the argument:

| Assignment | Raised | Completed | Rate |
|---|---|---|---|
| Named owner | 29 | 7 | 24% |
| No named owner | 5 | 0 | **0%** |

**Raised vs cleared, per meeting** — whether the backlog is accumulating:

| Meeting | Actions | Intentions | Cleared |
|---|---|---|---|
| 2026-04-27 | 23 | 5 | 3 |
| 2026-05-28 | 3 | 0 | 1 |
| 2026-06-23 | 3 | 0 | 3 |

April raised 28 items and cleared 3. June raised 3 and cleared 3. The meeting
that raised fewer, better-formed items cleared all of them.

**Also here:** the aging distribution, the escalation queue ("is this really even
a thing?"), and median time from raised to cleared. All of it is arithmetic over
the board's own record, which is what makes it usable in a room.

### 11.7 Constants

All exposed as policy values so weights are tunable without a deploy:

| Key | Default | Meaning |
|---|---|---|
| `board_age_ceiling` | 0.5 | Most that age can ever be worth |
| `board_age_tau_days` | 60 | How fast it gets there |
| `board_urgency_window_days` | 7 | Tier 1 boundary |
| `board_escalation_meetings` | 3 | Meetings open before an item is tabled |
| `board_priority_weights` | high 3, medium 2, low 1, unset 1.5 | Unset sits mid so it is neither buried nor rewarded |

### 11.8 Recurring series

Standing work — *"announce new members in Circle consistently"*, *"provide the
Board with monthly updates on renewals"* — has no finish line, so it grades as
an intention forever. That is honest but useless. Recurrence converts it into
something finishable **repeatedly**: do X, due the 27th, and again next meeting.

**Completion-triggered, never clock-triggered.** The next instance appears when
the current one is ticked. This matters because recurrence multiplies whatever
it is fed: put a task nobody does on a monthly timer and a year of neglect
produces twelve zombies instead of one — the same amplification argument that
kept push notifications off the table.

With completion as the trigger:

- a series can only ever have one open instance, so it cannot pile up
- if the work stops happening the series quietly stops, and that silence is the
  signal
- no cron is required at all

The apparent objection — "if I never complete it, it never recurs" — is not
one. The open instance sits there aging and the escalation flag catches it at
three meetings, which is a better outcome than twelve unread copies.

| Cadence | Next due date |
|---|---|
| `each_meeting` | The next real board meeting after this one |
| `monthly` | Same day next month, clamped for short months |
| `quarterly` | Same day in three months |

`each_meeting` reads the actual calendar rather than approximating four weeks —
the board's series is last-Thursday but December is deliberately pulled forward,
so an interval would drift off the real meetings. When the calendar runs out the
series ends rather than inventing a date the board never agreed to.

The spawned instance is left **unstamped**, unlike a backfill: it is genuine new
work with a real due date, so the ordinary reminder should fire as it approaches.

### 11.9 Closing something that is not real

"Still real?" was a question the system could not accept a *no* to. An item
that is dead but unfinished had nowhere honest to go: **complete** is a lie
that inflates the very completion rate §11.6 exists to make credible, **on
hold** promises a return, **intention** means malformed rather than abandoned,
and **delete** erases the record that is the whole point.

So there is a fourth ending — `dropped` — and it **costs a reason**, because
the reason is the record. The reason is written to `dropped_reason` and also
appended to the progress log, so the item's own history says why it ended.

Dropped items stay in the denominator of the completion rate on purpose.
Removing them would mean the rate could be improved by closing things, which
is exactly the gaming the number exists to resist. Stats therefore reads
"7 of 29 done · 4 closed unfinished" rather than folding the two together —
and the closed count is itself a measure of how much of what the board raises
never mattered.

**Two escalation corrections found in use:**

- `meetingDates` carries the whole calendar, including *future* sittings, so
  counting every meeting after the raise date made a brand-new item look like
  it had already survived four. Every item escalated on day one. Only meetings
  that have actually happened count.
- Three meetings can be scheduled close together, so there is now a floor in
  real time as well: `board_escalation_min_days`, default 90. Nothing raised
  this month gets asked whether it is still real.

Answering **yes, still real** stamps `escalated_at`, which restarts the clock.
Without that the badge nags forever after the first honest answer, and people
stop reading it — which costs more than the reminder is worth.
