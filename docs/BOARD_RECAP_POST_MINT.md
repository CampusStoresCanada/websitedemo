# Board Recap Post — Mint from Minutes

**Status:** BUILT 2026-08-27 (rev. 3). Migration applied to production; code on `feat/publication-engine`, uncommitted.
**Review surface:** `/admin/board/recaps`
**Depends on:** `docs/BOARD_ACTION_ITEM_MINT.md` (same source, same philosophy — read that one first)
**Premise:** The Circle recap post ("Decided / Still outstanding / Agenda for next meeting") is minted from the same saved minutes that already mint Action Items. The LLM's job stays exactly where it already is — writing good minutes via the `csc-board-minutes` skill. The website's job is turning structured, tagged lines into a Circle post deterministically, the same way it already turns `ACTION:` lines into rows in `board_action_items`. No second data channel, no separate LLM call at post time.

**What changed in rev. 2** (both from Steve, 2026-08-27):
1. The tagged block is **machine-readable scaffolding, not minutes content**. It is consumed on save — parsed, moved onto the draft, and removed from the stored minutes. It is not part of the record of the meeting and should not survive in it.
2. Butler Ghost **drafts and then reports**. Publishing on approval stays, but nothing is approved until Butler has told Steve a draft is waiting. See §6.

**Read §9 before building.** One node type this post depends on is not in the verified Circle vocabulary, and Circle fails silently on unverified nodes.

---

## 0. Why this shape

`BOARD_ACTION_ITEM_MINT.md` already answered the hard question — where does structured data live when the only real source is prose minutes a human reads? Answer: the minutes carry deterministic tags (`ACTION:`), the skill's output format *is* the contract, and a pure parser reads them on save. The recap post is the same problem with three more tags instead of one. There is no reason to invent a parallel JSON file, a second upload location, or a second LLM step — that would just be a second source of truth to keep in sync with the first, which is the exact failure mode §0 of the action-item doc diagnosed in the old spreadsheet.

Where the recap **departs** from the action-item pipeline is what happens to the tags afterward, and this is the one genuinely new mechanic in the whole feature:

- `ACTION:` lines are **durable**. They stay in the minutes forever, and the mint screen re-reads them on demand whenever a human opens it. The parser only ever reads.
- Recap tags are **consumed**. They are addressed to the machine, they read as clutter in a document the board will actually open, and once they have become a draft they have no further job. The parser reads *and the route writes the minutes back without them*.

That asymmetry is deliberate and is the source of every subtlety below. In particular it means the parser is the first thing in this codebase that has to **edit** the minutes HTML rather than flatten it — see §2.

## 1. The source contract — extend the skill's output

Today the skill emits minutes containing `ACTION:` lines (parsed by `parseActionLines()` in `lib/board/action-mint.ts`). Add three sibling tags, same rules (case-insensitive, `&nbsp;`-tolerant, one per line, HTML-stripped before parsing — see `docs/BOARD_ACTION_ITEM_MINT.md` §1 for the exact boundary rule):

```
DECIDED:      <what the board resolved or locked in>
OUTSTANDING:  <what is still open, ideally with an owner named inline>
NEXT MEETING: <what's expected to come back to the board>
```

Placed as a short block at the end of the minutes, after Adjournment. Example:

```
DECIDED: Conference Samples Shipping ("Conference in a Box") confirmed at $750 for non-Connected partners.
DECIDED: Town Hall (Sept 23, 10am) and Rush Retrospective (Oct 7, 10am) dates locked for members.
OUTSTANDING: Wednesday evening event venue — still comparing downtown vs. closer-to-hotel options. @Carolyn Potter
OUTSTANDING: Call for Nominations opening soon; Board to explore adding co-chair / non-voting director roles to share workload.
NEXT MEETING: Big Ideas Day pricing and room decision.
NEXT MEETING: Recap of the September 23 Town Hall.
```

**This is a `csc-board-minutes` skill change, not a website change.** The skill already knows what's decided vs. still open vs. deferred to next time — that judgment call is *why* the LLM step exists at all. Adding three tags it already has the answer for costs it nothing. Anything the skill doesn't explicitly tag simply doesn't appear in the recap — no inference happens on the website side, same as an untagged decision never becomes an action item today.

**These lines are transient.** The skill should emit them knowing they will not appear in the saved minutes. They are a delivery mechanism, not a section of the document. Two consequences for whoever updates the skill:

- Do **not** introduce a visible heading for the block ("Machine block", "For Circle", etc.). A heading is minutes content and would survive the strip in §2, leaving an empty section in the record. The tagged lines stand alone.
- Do **not** put anything in these lines that exists nowhere else in the minutes. After the strip, the only surviving copy lives on the draft row (§3). A decision worth recording belongs in the body of the minutes *as well as* in a `DECIDED:` line — the tag is a pointer for the post, not the archive.

Name resolution reuses `rewriteMentions()` exactly as-is — `@Carolyn Potter` in an `OUTSTANDING:` line resolves the same way it already does inside `ACTION:` lines, since both run through the same minutes-save normalization pass in `app/api/admin/board/meetings/[id]/content/route.ts`. Ordering matters: mentions are rewritten **before** the recap block is parsed, so the text captured onto the draft is already canonical. See §5.

## 2. Parser — reads *and* locates

New sibling to `parseActionLines()` in `lib/board/action-mint.ts` — same file, same HTML-stripping approach for reading. But because the block has to be removed, the parser must also report **where it was**, which `extractActionLines()` never needs to do:

```ts
export interface RecapLine {
  kind: "decided" | "outstanding" | "next_meeting";
  text: string;       // HTML-stripped, mentions already canonical
  raw: string;        // verbatim source line, for source_excerpt / diffing
}

export interface RecapParse {
  lines: RecapLine[];
  /** The minutes with every consumed tag element removed. Empty-string-safe. */
  strippedHtml: string;
  /** The removed block, verbatim HTML, preserved onto the draft row. */
  removedHtml: string;
}

export function parseRecapLines(minutesHtml: string): RecapParse
```

No rubric here — unlike action items, there's no pass/fail grading question for a recap line. Every tagged line goes in verbatim. The only "quality" concern is the same one flagged in §1 of the action-item doc: garbage in, garbage out, and the fix is the skill's fixtures, not a website-side heuristic.

**Strip by block element, never "cut to end of document."** The tempting implementation — find the first tag, truncate everything after it — assumes the block is always last and always contiguous. Neither is guaranteed: a stray footer, a signature line, or a skill regression that interleaves tags would silently delete real minutes content. Instead, remove **only block-level elements whose own text begins with one of the three tags** (`<p>`, `<li>`, `<div>`, `<h1>`–`<h6>`), matched non-greedily, then clean up any element left empty by the removal. An element that contains no tag is never touched, so the worst case of a parser miss is a leftover tag line in the minutes — visible, harmless, and fixable by hand — rather than deleted minutes.

This is the highest-consequence code in the feature. `extractActionLines()` can afford to be approximate because a bad parse produces a bad *proposal* that a human rejects on the mint screen. A bad strip mutates the board's record of the meeting. Unit-test it against the real fixtures with the same rigour, plus a case for each of: no tags present, tags with `&nbsp;`, a tag inside a list item, and a tag line that also contains an `@mention`.

## 3. Where it lives — reuse `ghost_announcements`, don't invent a table

`ghost_announcements` is already exactly this shape: `kind`, `status` (`draft` → `approved` → `published`), `title`, `body_tiptap`, `circle_space_id/post_id/url`, approval attribution. Extend rather than duplicate.

Note the real schema (`supabase/migrations/20260820150000_ghost_announcements.sql`): `kind` has a default of `'new_partner'` and a single-value check; `organization_id` is `not null`; uniqueness is the table-level `unique (kind, organization_id)`, not an index — so it is dropped by constraint name, not `drop index`. There is also a `summary_text` column added in the same migration, whose documented contract ("reviewers edit prose, never markup — `body_tiptap` is regenerated from it on save") is worth preserving for the recap; see §4.

```sql
alter table public.ghost_announcements
  drop constraint ghost_announcements_kind_check,
  add constraint ghost_announcements_kind_check
    check (kind in ('new_partner', 'board_recap'));

alter table public.ghost_announcements
  drop constraint ghost_announcements_kind_organization_id_key;

alter table public.ghost_announcements
  alter column organization_id drop not null,
  add column if not exists meeting_id uuid references public.board_meetings(id) on delete cascade,
  -- The consumed tag block, verbatim. This is the ONLY surviving copy once the
  -- minutes are stripped (§2), so it is what regeneration re-parses and what a
  -- human reads to see what Butler was given. Not optional.
  add column if not exists source_block text;

-- Restores the new_partner idempotency guarantee the dropped table constraint
-- provided, and adds the board_recap one: one recap draft per meeting.
create unique index if not exists ghost_announcements_new_partner_org_idx
  on public.ghost_announcements(organization_id)
  where kind = 'new_partner';

create unique index if not exists ghost_announcements_board_recap_meeting_idx
  on public.ghost_announcements(meeting_id)
  where kind = 'board_recap';

alter table public.ghost_announcements
  add constraint ghost_announcements_org_or_meeting_check
    check (
      (kind = 'new_partner' and organization_id is not null) or
      (kind = 'board_recap' and meeting_id is not null)
    );

comment on column public.ghost_announcements.source_block is
  'The DECIDED/OUTSTANDING/NEXT MEETING block consumed from the minutes on save. The minutes no longer contain it — this is the only copy. Regeneration re-parses this, not minutes_html.';
```

⚠️ **`source_block` is not a nicety.** Once §5 strips the minutes, re-saving them cannot regenerate the recap, because the tags are gone. Without this column the strip is destructive and the draft becomes unreproducible. With it, the tags are *moved* rather than deleted — out of the minutes, where they don't belong, and onto the draft, where they do.

Also note: `drop constraint ghost_announcements_kind_organization_id_key` assumes Postgres's default name for the table-level `unique (kind, organization_id)`. Confirm the actual name against the live database before running the migration rather than trusting the convention.

## 4. The builder — pure function, same shape as `buildNewPartnerPost`

New file `lib/ghosts/board-recap-post.ts`, structurally identical to `lib/ghosts/new-partner-post.ts`: pure, no I/O, unit-testable, produces `{ title, tiptap_body }` and nothing else.

```ts
export interface BoardRecapPostInput {
  meetingDateLong: string;       // "Thursday, August 27, 2026"
  eventUrl: string;              // the Board Only event page
  decided: RecapLine[];
  outstanding: RecapLine[];
  nextMeeting: RecapLine[];
  minutesAreDraft: boolean;      // per the user: always true at post time today
}

export function buildBoardRecapPost(input: BoardRecapPostInput): { title: string; tiptap_body: {...} }
```

A section with no lines renders no heading — an empty "Still outstanding" heading reads as a claim that nothing is outstanding, which is a different statement from "the skill didn't tag anything."

Doc-link bullets (Conference in a Box, Benchmarking) aren't a separate field — they're a `link` mark inside the bullet's text run, same as `new-partner-post.ts` already does for a partner's website.

**On node vocabulary, see §9 — do not treat `bulletList` as available until it has been verified.**

## 5. Trigger — draft on save, strip only what was consumed

New-partner announcements are cron-drafted because activation is a passive, ambient event nobody explicitly performs. Saving board minutes is the opposite — a human explicitly clicks Save once, for one meeting, at a known moment. So drafting happens synchronously inside `PATCH /api/admin/board/meetings/[id]/content`.

The order of operations is the whole design, because a failure in the middle of it can destroy the tags:

1. `rewriteMentions()` runs first, exactly as today — so `@Carolyn Potter` is canonical before anything is captured.
2. `parseRecapLines()` on the rewritten HTML. **If no tags are found, stop here** and save normally: do not touch, blank, or delete any existing draft. A minutes edit six weeks later must not wipe the recap.
3. Look up any existing `board_recap` row for this `meeting_id`.
   - **No row** → build and insert as `draft`, storing `source_block`.
   - **Row is `draft`** → regenerate `title`/`body_tiptap`/`source_block` from the new block. Steve re-saving corrected minutes should get a corrected draft.
   - **Row is `approved`, `published`, or `skipped`** → change nothing, and **do not strip** (see below).
4. **Only if step 3 wrote a row successfully**, replace the content to be saved with `strippedHtml`.
5. Save the minutes.
6. Raise the notification (§6) — after the save commits, so Butler never reports a draft for minutes that failed to save.

**Strip only what was consumed.** This is the safety rule that makes the destructive step defensible. The tags come out of the minutes precisely when a draft row now holds them, and never otherwise. If the insert fails, if the row is locked because a human already approved it, or if the parse found nothing — the tags stay exactly where they were. The failure mode is then "the tag block is still visible in the minutes," which Steve can see and act on, rather than "the tag block is gone and so is the draft," which is silent and unrecoverable.

⚠️ **Check the write result, not just the absence of an error.** A write that affects zero rows can return `error: null`. Step 4 must be gated on an actually-returned row (`.select().single()`), not on `!error`. This is the failure mode that has bitten this codebase before, and here it would trade the tags for nothing.

⚠️ **The editor will show stale text after save.** `MeetingDocumentEditor` holds the body in `useState(initialHtml ?? "")` and calls `router.refresh()` after a successful PATCH (`components/admin/board/MeetingDocumentEditor.tsx:32,60`). The refresh re-renders the server component, but the local `html` state is not re-synced from the new prop — so after saving, Steve keeps seeing the tag block on screen even though the database no longer has it. This is *already* true of `rewriteMentions()` today and nobody has noticed, because a rewritten mention looks almost identical to what was typed. A block that was supposed to vanish and visibly didn't is a different matter: it reads as a bug, and it invites a re-save.

The fix belongs with this change: have the PATCH return the normalized HTML (`{ ok: true, html, recap: { drafted: true, id } }`) and have `handleSave` call `setHtml(data.html)`. That also gives the UI the draft id it needs for §6. Re-saving without it is *safe* — step 3 is idempotent and step 4 won't re-strip an already-stripped document — but it looks broken, and "looks broken" is how a human ends up hand-editing minutes to work around a system that was working.

## 6. Reporting — Butler DMs, and never publishes

Nothing here publishes. What rev. 2 added was the missing half: a draft nobody knows about is the same as no draft. Rev. 3 corrects **where** that report lands and **what Butler does with the post**.

**Butler sends a Circle DM, not an ops alert.** Ops alerts are for conditions somebody has to go and resolve. This is one colleague telling another that a thing is ready, and it belongs in the same inbox as the rest of the board's conversation. `getCircleGhostClient()` is what makes it come from Butler: **DMs are attributed to the API KEY OWNER**, not to `user_email` the way posts are. That asymmetry is documented in `lib/circle/client.ts` and is easy to get backwards.

The recipient is **whoever performed the action** — `auth.ctx.userEmail` from the save route and from the approve action — not a hardcoded address. The person who did the thing is the person who wants to know it worked, and it means the feature keeps working when someone else takes over minutes.

**The ops alert survives only as a fallback.** If the DM cannot be delivered, `raiseAlertIfNotOpen` fires with the same content plus "(Circle DM could not be delivered.)" and `dmDelivered: false` in the details. A report that fails silently is the same as no report.

**Butler hands over a Circle DRAFT; the human publishes.** `publishBoardRecap` defaults to `asDraft: true`: the post is written into the board space with `status: "draft"` and `skip_notifications`, so nobody is told. The final publish is a human act inside Circle, where the recap can be read in place and edited with Circle's own editor first.

That changes what the row means, deliberately:

| | `status` | `published_at` | `circle_post_id` |
|---|---|---|---|
| drafted on the website | `draft` | null | null |
| approved, sitting in Circle as a draft | `approved` | **null** | set |
| actually published | `published` | set | set |

Leaving it `approved` with a `circle_post_id` says precisely what is true — a human approved it, it is in Circle, nobody has been notified — and keeps `published_at` null so the daily-cap counters never count it as a post. It also means **status alone can no longer tell you whether the recap has been sent**, so `publishBoardRecap` guards on `circle_post_id` instead; without that guard, a second click would post it twice.

Two things about the fallback alert, learned the hard way in this codebase:

- **Key it per meeting.** `raiseAlertIfNotOpen` dedupes on any non-resolved row with the same `rule_key` (`lib/ops/alerts.ts`). A bare key would mean September's recap raises nothing while August's alert is still open.
- **Keep it out of `PERIODIC_RULE_KEYS`.** That set is the auto-resolve sweep for conditions re-evaluated every pass. These are event-driven, like the QBO and board-export alerts.

`board_recap` is still classified `"timely"` in `posting-policy.ts`, so the ambient daily caps never apply. One recap a month into a private board space is not an attention-management problem.

## 7. Posting identity and destination

Already provisioned, no new credentials:

- **Space:** `CIRCLE_BOARD_SPACE_ID` (`lib/board/vote-service.ts`) — the private board space board votes already post into.
- **Identity:** `butler.ghost@campusstores.ca` (`BUTLER_EMAIL`, same file). Butler is already the board's voice for factual, "here's the state of things" posts (per `docs/GHOST_PLAYBOOK_BRIEF.md`'s Butler/Suggestion contract), which is exactly this post's register — and now also its voice for the review request in §6. Reuse it rather than minting a third ghost identity.

## 8. What this deliberately does not do

- **No inference on the website side.** If the skill doesn't tag a line, it doesn't appear in the recap.
- **No auto-publish without human review**, ever — same non-negotiable as every other ghost pipeline in this codebase (`new-partner-post.ts`'s own header: "nothing here publishes; a human reads it, edits it, and approves it first").
- **No change to the Action Items pipeline.** `ACTION:` lines keep doing exactly what they do today: they stay in the minutes, and they are read on demand by the mint screen. They are *not* consumed by this feature and must not be stripped by it.
- **No destructive strip.** The tags leave the minutes only once a draft holds them (§5).

## 9. ✅ Settled — `bulletList` renders (verified 2026-08-27)

Rev. 1 §4 asserted that `bulletList`/`listItem` were already verified. They were not — neither string appeared anywhere in `lib/` or `app/`, and the verified list in `new-partner-post.ts` did not include them. Since Circle silently discards unknown nodes (`poll`, per `lib/board/vote-post.ts`), the risk was a recap that published "successfully" with every bullet missing.

**Probed directly against the Board Stuff space (1749439) and confirmed working.** A post carrying `heading` + `paragraph` + `bulletList` (with a nested `paragraph` and a `link` mark) came back as:

```html
<div><h2>Decided</h2><p>PARAMARKER control line.</p><ul><li><p>BULLETMARKER one plain.</p></li><li><p>BULLETMARKER two with <a href="https://campusstores.ca" ...>a link</a></p></li></ul></div>
```

`tiptap_body` round-tripped with `bulletList`/`listItem` intact. §4 is built with real bullets. The probe post was deleted and the space re-checked to confirm nothing was left behind.

**Two traps found while probing, now recorded in the `new-partner-post.ts` header**, because either one reads as "the node type was rejected" when it wasn't:

1. `GET /posts/{id}` never hydrates `body.body` — it returns `""` for *every* post, including ones built only from known-good nodes. It cannot confirm anything. Read back from the POST response (it echoes rendered HTML) or `GET /posts?space_id=…`.
2. `tiptap_body` must be **nested** — `{ body: { type: "doc", content } }`, the shape `buildNewPartnerPost` returns. A bare `{ type: "doc", content }` is accepted with HTTP 200 and stored empty.

The general lesson, and the reason this section reached the right answer: **always post a control built only from verified nodes alongside the node under test.** The first probe run showed an empty body and looked like proof that bullets were discarded. The control was equally empty — which is what exposed the real fault as the payload shape, not the node type.

## 9b. What was actually built

Files, all uncommitted on `feat/publication-engine`:

| Piece | File |
|---|---|
| Parser (`parseRecapLines`, `groupRecapLines`) | `lib/board/action-mint.ts` (appended) |
| Post builder (`buildBoardRecapPost`, `renderRecapLine`) | `lib/ghosts/board-recap-post.ts` |
| Draft-on-save + the ops alert | `lib/ghosts/board-recap-draft.ts` |
| Publish to Circle as Butler | `lib/ghosts/board-recap-publish.ts` |
| Review actions | `lib/actions/board-recaps.ts` |
| Review screen | `app/admin/board/recaps/page.tsx`, `components/admin/board/BoardRecapReview.tsx` |
| Save route wiring | `app/api/admin/board/meetings/[id]/content/route.ts` |
| Editor: adopt normalised HTML, show Butler's report | `components/admin/board/MeetingDocumentEditor.tsx` |
| Migration (APPLIED to production) | `supabase/migrations/20260827193500_ghost_announcements_board_recap.sql` |
| Tests (28) | `lib/board/__tests__/recap-mint.test.ts`, `lib/ghosts/__tests__/board-recap-post.test.ts` |

**One deliberate departure from the spec.** §4 assumed an `eventUrl` for the button. There is no Circle event URL anywhere on `board_meetings` — `event_id` points at the internal `events` table, which has no Circle link column. Rather than invent a URL the builder renders **no button** when `eventUrl` is absent, and the draft path passes `null`. The input is still supported, so adding the button later is a one-line change once a link exists.

**The reviewer edits `source_block`, not the minutes.** This is the consequence of §5 that only became obvious once built: because the tags are consumed, "fix a line and re-save the minutes" is not available — the tags are gone from the document by design. So `/admin/board/recaps` makes the saved block editable and rebuilds the post from it, running the same parser and builder the save path does. That is what keeps the strip from being a one-way door.

**Verified against the live database** with scratch rows, since constraints are easy to write and easy to get wrong:

- a recap row with no `organization_id` is accepted
- a second recap for the same meeting is rejected
- a recap with a null `meeting_id` is rejected
- `new_partner` still requires an `organization_id`
- deleting a meeting cascade-deletes its recap

**Gates.** `npx tsc --noEmit` and `npx vitest run` (1329 passing) both clean for these files. `npm run build` was deliberately NOT run: it writes `.next`, which the shared dev server on :3000 is using, and four sessions are working in this checkout. The `"use server"` constraint it exists to catch was checked structurally instead — `lib/actions/board-recaps.ts` exports only `async function`s plus one erased `interface`, the same shape as `lib/actions/ghost-announcements.ts`, which is already in production.

## 10. What the skill needs (recap for whoever updates `csc-board-minutes`)

1. After the Adjournment block, emit a short tagged section using the three prefixes in §1 — with **no heading above it**, since the lines are removed on save and a heading would be left orphaned in the minutes.
2. Every `DECIDED`/`OUTSTANDING`/`NEXT MEETING` line should stand alone as one sentence — it goes straight into the post unedited, the same way an `ACTION:` line goes straight into a task title today.
3. Use `@Full Name` mentions inside these lines exactly as already done elsewhere in the minutes — the save-time `rewriteMentions()` pass normalizes them for free, before the block is captured.
4. A doc link belongs in the line as a plain URL or Markdown-style reference; the builder decides how to render it. Don't invent new syntax without updating §4.
5. **Treat the block as write-only.** It will not be in the saved minutes, so nothing in it should be the only record of anything. Anything that matters to the board belongs in the body of the minutes too.
