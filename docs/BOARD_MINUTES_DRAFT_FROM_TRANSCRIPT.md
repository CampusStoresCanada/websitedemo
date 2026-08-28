# Board Minutes — Draft from Transcript

**Status:** Spec for review · 2026-08-28 (rev. 2 — Notion transcript access CONFIRMED; no MCP needed; roll call agreed)
**Depends on:** `docs/BOARD_RECAP_POST_MINT.md` (this feeds it), `docs/BOARD_ACTION_ITEM_MINT.md` (same source, same philosophy)
**Premise:** The last manual seam in the board-minutes chain is a human moving text between two apps. The skill already turns a transcript into minutes; the website already holds the agenda, the previous minutes and the roster. This closes the gap between them with one button and one pasted URL.

---

## 0. Why this shape

Three things make this smaller than it first looks.

**Two of the skill's three inputs are already in the database.** `SKILL.md` §1 asks for the transcript, the agenda for *this* meeting, and (helpfully) the previous meeting's minutes. `board_meetings.agenda_html` and the previous meeting's `minutes_html` are both already loaded on the meeting page — `prevMeeting` is fetched and passed to `MinutesTabs` today (`app/admin/board/meetings/[id]/page.tsx`). Only the transcript comes from outside.

**Notion exposes meeting notes and transcripts over the REST API — verified 2026-08-28.** `POST /v1/blocks/meeting_notes/query` with `Notion-Version: 2026-03-11` returns `meeting_notes` block objects carrying `title`, a processing `status`, `calendar_event` and `recording` metadata, and a `children` object holding the block IDs for the summary, notes and **transcript** tabs. The transcript is then fetched by its own block ID — not inline.

Probed against the live `NOTION_API_KEY`: the endpoint returned **200**, which is the meaningful result. The documented failure mode is a **400 when AI meeting notes aren't available for the integration's user** — so a 200 says the capability is live on this workspace. It returned zero results only because the existing "Test Integration" token is shared with the Contacts database and nothing else.

**The `status` field is the completion signal**, which the earlier design assumed did not exist. Notion's *webhooks* still can't tell you a transcript is finished — `page.content_updated` fires while it is still landing and again on every later edit — but this endpoint reports processing state directly. That turns "did they click too early?" from a guess into a check.

That also deletes a whole section of the skill. `SKILL.md` currently carries search heuristics for finding the page ("search for a page titled like `CSC Board Meeting - MM-DD-YY`… if that naming pattern doesn't turn up a match, don't give up… cross-check candidates against the agenda's date"). The query endpoint filters on `title`, `attendees` and `created_time`, so the app can list the two or three candidates near the meeting date, show their status, and let a human pick — no heuristics, no mis-identification.

**The transcript is the only thing that is "okay".** Notion's speaker labelling resolves to *"Steve Thomas and Others"* — confirmed by inspection on 2026-08-28 — which is why `board_roster.md` reconstructs Present/Absent from context clues. That does not change here. What helps is a **process** fix rather than a tooling one: a verbal roll call at call to order, and movers named aloud, put the names in the words where the skill can read them. Worth trying before any further tooling spend, because CSC's own motion convention is impersonal ("In a motion duly moved and seconded, it was resolved that…"), so attribution matters in fewer places than it appears.

## 1. The three inputs

| Input | Source | Status |
|---|---|---|
| Agenda for this meeting | `board_meetings.agenda_html` | already in the DB |
| Previous meeting's minutes | previous `board_meetings.minutes_html` | already fetched on the page |
| Board roster + staff | `profiles` / `governance_role_assignments` | **live**, unlike the skill's static file |
| Transcript | Notion `meeting_notes` query → `transcript_block_id` | the one new input |

The roster is worth calling out. The skill carries `references/board_roster.md`, a hand-maintained file that goes stale the moment the board changes. The website knows who currently holds a governance role. Passing the live roster into the prompt makes the Present/Absent reconstruction better *and* removes a maintenance burden — the static file keeps only the part the database cannot know: the running list of proper nouns the transcription reliably mangles (CANCOLL → "CanCall", CSC → "CSE").

## 2. Where the drafting guidance lives — decide this first

The skill's judgment — how to map a transcript onto an agenda, when a decision is a motion, what belongs in a `DECIDED:` line — currently lives in `SKILL.md` and `references/`, under Claude's plugin directory, **outside this repo**. The website cannot read it in production.

Three options, in order of preference:

1. **Move the canonical skill into the repo** (`skills/csc-board-minutes/`) and have CoWork load it from there. One copy, version-controlled, deployable, reviewable in a PR. It also fixes a problem that already exists: today the plugin copy is overwritten if the skill is ever re-saved from a package, silently discarding edits.
2. **Upload it via the Skills API** and reference by `skill_id`. Anthropic hosts it, but CoWork still loads its local copy — so this does not solve the drift, it just relocates one of the copies.
3. **Copy the guidance into the app** as a prompt constant. Fastest, and the worst: two sources of truth for the same judgment, which is precisely the failure mode `BOARD_ACTION_ITEM_MINT.md` §0 diagnosed in the old action-items spreadsheet.

**Recommendation: (1).** The skill stops being a personal artifact and becomes part of the product.

## 3. The call

This would be **the app's first LLM integration** — there is no `@anthropic-ai/sdk` in `package.json` and no call to the Anthropic API anywhere in `lib/` or `app/`. That means a new dependency, a new secret (`ANTHROPIC_API_KEY`), a new failure mode, and a new cost line. Small, but it is a new surface rather than an extension of an existing one.

**MCP is not needed, and should not be used here.** MCP is a client-side connector protocol — it is how a Claude *application* (CoWork, Claude Code) reaches tools on the user's behalf. A server route is not a Claude client: it makes two ordinary HTTPS calls, one to `api.notion.com` with `NOTION_API_KEY` and one to `api.anthropic.com` with `ANTHROPIC_API_KEY`. If the REST API had *not* exposed transcripts, the fallback would have been attaching Notion's hosted MCP server to the Messages request via the MCP connector — real, but strictly more machinery. Since §0 confirms REST works, that branch is closed.

- **Model:** `claude-opus-5`. This is a judgment task on a long, messy input — the tier matters.
- **Structured outputs, not prose parsing.** `output_config.format` with a JSON schema derived from `references/data_schema.md` means the model *cannot* return a shape the renderer can't consume. The schema already exists as documentation; this makes it enforceable.
- **Effort:** start at `high`. Re-baseline once there are a few real runs.
- **Context:** a board transcript runs tens of thousands of tokens. Opus 5's 1M window swallows it whole — the skill's guidance about handing oversized Notion transcripts to a subagent to read in slices is a workaround for a constraint that no longer binds on this path.
- **Cost:** cents per meeting at ~$5/M input, roughly twelve times a year. Not a budget line.

Output is `data.json` and nothing else. The model does the judgment; it does not render.

## 4. Rendering

`scripts/build_html.js` is already standalone and dependency-free — that split was made precisely so it could run somewhere other than a Claude session. It takes `data.json` and produces the website's minutes HTML.

**The `.docx` stays in CoWork.** The app does have a DOCX path (`lib/board/docx-export.ts`), but it uses `html-to-docx` and would not reproduce the CSC letterhead — the logo, blue section headers, boxed motion language and footer rule that `build_minutes.js` renders with the `docx` library. Trying to recreate that server-side is a bigger job than this feature, and Greg's formal copy is not the thing under time pressure. The website path produces `minutes_html`; the formal document continues to come from the skill run.

## 5. The flow — one write path

```
[Meeting page ▸ Minutes tab]
  paste Notion transcript URL  →  "Draft from transcript"
                                        │
              agenda_html + prev minutes + live roster + transcript
                                        │
                            Claude (schema-constrained)  →  data.json
                                        │
                                 build_html.js  →  html
                                        │
                    LOADED INTO THE EDITOR, UNSAVED
                                        │
                    human reads, edits, clicks Save
                                        │
        existing PATCH route: rewriteMentions → recap tags consumed
                    → Butler drafts the recap → DMs Steve
```

**The generate step must not write to the database.** It returns HTML into the editor and stops. Everything downstream — mention rewriting, recap-tag consumption, the Butler draft, the DM — already runs on save, and routing the generated minutes through that same path means there is exactly one way minutes get written and one place the pipeline fires. A second write path would duplicate the normalisation and quietly diverge from it.

It also keeps the human where every other gate in this system already puts them: reading the thing before it becomes the record.

## 6. Failure modes

| Case | Behaviour |
|---|---|
| Notion URL malformed, or the page isn't shared with the integration | Refuse with the reason. Do not fall back to searching Notion. |
| Transcript still processing | Read `meeting_notes.status` and refuse with it, rather than drafting from a partial transcript or from the summary. The AI-generated summary is someone else's lossy interpretation; `SKILL.md` is explicit about using the verbatim transcript only. |
| Minutes already present for this meeting | Refuse by default and require an explicit overwrite. Generated minutes must never silently replace edited ones. |
| Model returns a valid but poor draft | Human catches it — that is what the unsaved-editor step is for. |
| Transcript enormous | Fits the 1M window; if it ever doesn't, fail loudly rather than truncating silently. |

## 7. What this deliberately does not do

- **No automatic triggering.** No webhook, no cron, no transcript polling. Minutes are a governance artifact and the person who was in the meeting starts the draft — the same reasoning that keeps election cycles and recap publishing human-initiated.
- **No Notion search.** One explicit URL, or nothing.
- **No writing to `minutes_html` directly.** See §5.
- **No `.docx` generation.** See §4.
- **No change to the recap pipeline.** It already runs on save and does not care where the minutes came from.

## 8. Open questions — resolved 2026-08-28

1. ~~Can the Notion REST API return the transcript?~~ **Yes.** `POST /v1/blocks/meeting_notes/query` (`Notion-Version: 2026-03-11`) → `meeting_notes` block → `children.transcript_block_id` → fetch that block. Verified reachable with the existing key (200, not the documented 400-when-unavailable).

   **The one remaining action is sharing, and it is not a code task.** The current `NOTION_API_KEY` belongs to "Test Integration", which is connected to the Contacts database only — `/search` returns nothing but contact pages, and the stored May meeting page 404s with *"Make sure the relevant pages and databases are shared with your integration."* Someone with Notion admin rights must connect the board meeting notes to an integration. Consider a **separate integration for board minutes** rather than widening the contacts one: it keeps the blast radius of that token to board material, and it can be revoked independently.

2. ~~Where does the skill live?~~ **Move it into the repo** (`skills/csc-board-minutes/`). One version-controlled copy that both CoWork and the website read, and it fixes the existing hazard that re-saving the skill from a package silently discards edits.

3. ~~Roll call?~~ **Agreed.** Add a roll call at call to order and name movers aloud. This puts attendance and attribution into the words, where the skill can read them — necessary because Notion's speaker labelling resolves to *"Steve Thomas and Others"* (confirmed by inspection). Two consequences for this spec: the prompt should be told the roll call is spoken, and `board_roster.md`'s Present/Absent reconstruction guidance can shrink to the proper-noun correction list.

## 8b. The Notion side — one page per meeting

Verified 2026-08-28 against the live integration: the **Board Meetings** page (`3caa69bf-0cfd-8018-a2f9-e67d2e7c6bc1`) and its child data source (`3caa69bf-0cfd-80f7-9182-000b373cca67`, parent database `3caa69bf-0cfd-80ff-ae0b-e8fa00ce614a`) are both readable by the existing token. The data source is empty and currently has a single `Name` (title) property.

**A pre-created page is a valid host for meeting notes.** AI Meeting Notes attaches to an existing page — the microphone icon converts a page and inserts the note-taking block at the top, and `/meet` inserts one inline. So the app can create the row before the meeting and the transcript lands on the page that already exists, rather than Notion spawning a second page that then has to be reconciled.

**Schema.** Add one property before using it:

| Property | Type | Why |
|---|---|---|
| `Name` | title | `CSC Board Meeting — 2026-09-24` |
| `Meeting date` | date | so a human can sort and scan the database; not load-bearing for the app |

The website↔Notion link does **not** need a Notion property. `board_meetings.notion_page_id` and `notion_page_url` already exist and already hold a Notion pointer — they simply stop pointing at an ad-hoc scratchpad and start pointing at the meeting's row in this database. One authoritative pointer, owned by the side that owns the record.

That is what retires the skill's page-search heuristics for good: the app never looks for the page, it already knows the ID.

**Creation trigger.** A small cron that ensures a Notion row exists for every board meeting inside the next N days, keyed on `notion_page_id is null`. Idempotent by construction, forgiving of a meeting added late, and it never invents a meeting — it only mirrors one that already exists in `board_meetings`. Do not generate these from a recurrence rule; the meeting record is the source, as it is everywhere else in the board workflow.

**Identity stays in the database.** This makes Notion the third place a meeting appears (Google Calendar → `board_meetings` → Notion page), which is fine *because the Notion page is derived*: `board_meetings` owns the record, `notion_page_id` is the pointer, and nothing reads the Notion page for anything except the transcript. If the transcript source later moves — to Meet, or anywhere else — only the fetch behind that pointer changes.

## 9. Build order

1. Add a `Meeting date` property to the Board Meetings data source, and name the database (it is currently "New database").
2. Record one real meeting into a page in it; re-run the `meeting_notes` query probe and confirm a real transcript comes back with a `status` of complete.
3. Add the cron that mirrors upcoming `board_meetings` into Notion rows and stores `notion_page_id`.
4. Move the skill into the repo.
5. Add `@anthropic-ai/sdk`, `ANTHROPIC_API_KEY`, and a `lib/board/minutes-draft.ts` that takes a meeting id and returns `data.json`.
6. Wire `build_html.js` into the app and render to HTML.
7. Add the button to the Minutes tab: generate → load into the editor unsaved → human saves → existing recap pipeline fires.
