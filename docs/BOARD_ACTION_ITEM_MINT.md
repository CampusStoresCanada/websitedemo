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
| 2 | **A completable verb** | The lead verb denotes an act that ends | The lead verb is continuous or stative |
| 3 | **A finish line** | A date, or a named deliverable | No date and no observable output |

### Verb lists

**Fail (continuous / stative)** — `continue`, `maintain`, `monitor`, `oversee`, `support`, `promote`, `explore`, `revisit`, `consider`, `prioritize`, `ensure`, `keep`, `be aware`, `look at`, `work on`, `discuss`

**Pass (completable)** — `send`, `call`, `draft`, `write`, `confirm`, `remove`, `add`, `invite`, `book`, `sign`, `publish`, `create`, `deliver`, `present`, `report back`, `bring back`, `circulate`, `schedule`

The lists are a starting point and will be argued about. That is intended; see §10.

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

An intention can be promoted to an action later — by a human giving it an owner, a verb, and a finish line. That promotion is the moment the board actually decides something, and it should be logged.

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

## 10. Open questions

1. **The verb lists are a judgement call.** `discuss` and `review` are the contentious ones — "review the draft policy and report back" is a real task; "review our approach to advocacy" is not. Options: keep them on the fail list and let the finish-line test rescue the good ones, or drop them and rely on tests 1 and 3.
2. **The eight existing collective items.** Mint as intentions against their original meetings, or leave them out entirely and let them die with the spreadsheet? They are the evidence in §9, which argues for importing them.
3. **Who sees intentions?** Admin-only, or on the board-facing meeting record? Visible is more honest and makes the case faster; it may also read as public criticism of the board's habits.
4. **Promotion logging.** When an intention becomes an action, is that an `board_action_item_updates` row, or does it warrant its own audit action?
5. **Pre-April 2026 minutes** are not in the system, so nothing before then can be minted. Confirmed out of scope.

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
| Un-ownable items indistinguishable from real tasks | Graded, routed, and counted |
