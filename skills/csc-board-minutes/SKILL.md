---
name: csc-board-minutes
description: Draft CSC (Campus Stores Canada) board meeting minutes from a meeting transcript, formatted to match the established CSC minutes letterhead exactly (logo, Present/Absent block, BUSINESS ITEMS/DISCUSSION ITEMS/OTHER BUSINESS sections, boxed motion language, ACTION items, footer), plus a matching HTML version for the CSC website. Use this whenever the user asks for CSC board minutes, mentions turning a CSC board meeting transcript or recording into minutes, references a Notion page like "CSC Board Meeting - MM-DD-YY", or attaches a CSC board agenda and asks for the minutes to go with it — even if they don't say "skill" or name this skill explicitly.
---

# CSC Board Minutes

Turns a CSC board meeting transcript into formal minutes that are
indistinguishable in format from the CSC board's existing minutes archive.
This is a recurring task (roughly monthly) — the board, letterhead, and
formatting stay constant; only the agenda and what was actually discussed
change each time.

## Why this is more than "summarize the transcript"

Raw meeting transcripts (usually auto-transcribed by Notion) are messy in
ways that matter for official minutes: speakers aren't labeled, casual
side-conversation is mixed in with substantive board business, proper nouns
get mangled, and the same person's name can come out spelled two different
ways. Official minutes also follow a specific formal register (motions get
boxed formal language, not paraphrase; items not reached get said so
explicitly) and must map onto that specific meeting's agenda numbering, not
a generic template. Treat this as a drafting task requiring judgment, not a
mechanical transform — and flag your judgment calls to the user rather than
silently guessing.

## Workflow

### 1. Get your inputs

You need three things: the **transcript**, the **agenda** for this specific
meeting, and (helpful but not required) the **previous meeting's minutes**
for continuity on carried-forward items. The agenda is different every
meeting — always ask for it if it's not already attached, since the item
numbering in the minutes must match it exactly.

For the transcript, **ask the user where to get it** rather than assuming —
some meetings' transcripts are pasted/attached directly, others live in
Notion. Don't default silently to Notion.

If pulling from Notion: search for a page titled like `"CSC Board Meeting -
MM-DD-YY"` first. If that exact naming pattern doesn't turn up a match,
don't give up — board-adjacent working sessions in Notion are sometimes
auto-titled by content instead (e.g. a page titled after a discussion topic
rather than "Board Meeting"). Cross-check candidates against the agenda's
date and discussion topics before treating one as the source transcript, and
confirm with the user if it's not a clean match.

When fetching a Notion meeting-notes page, request `include_transcript:
true` and use the content **between the `<transcript>` tags only** — not the
AI-generated `<summary>` section. The summary is someone else's lossy
interpretation; you want the verbatim source so your own read of what
happened (and what actually got moved/seconded/carried) is trustworthy.
Notion transcript fetches are often too large for one context window — if
the result gets truncated or saved to a side file, hand it to a subagent
with explicit instructions to read the *entire* file in slices and write out
just the `<transcript>...</transcript>` content verbatim to a plain text
file, excluding the summary/action-items sections. Then read that file
yourself.

### 2. Read `references/board_roster.md`

This has the current voting board members, non-voting staff, and — 
importantly — a running list of proper nouns the transcription reliably
mangles (e.g. the organization CANCOLL comes out as "CanCall", CSC itself
sometimes comes out as "CSE"). Apply those corrections. Also watch for *new*
patterns as you read — if something is clearly a mis-transcription of a
name, org, or term you can tell from context, fix it and flag the fix to the
user; offer to add it to the roster file for next time.

That file also has guidance on reconstructing the Present/Absent list from
context clues, since the transcript doesn't attribute speakers by name. Pay
particular attention to any two board members whose names are easily
confused in speech-to-text (the file flags the current known pair) — don't
assume attendance from how a name happens to be spelled in one line; check
who is actually being addressed or is actually speaking.

### 3. Draft the minutes content

> **The judgment rules for this step live in `references/drafting_contract.md`.**
> That file is the single model-facing contract, shared with the CSC website,
> which runs the same step automatically from a meeting's Notion transcript.
> Change the rules there, not here, so the two never drift apart.

Map what actually happened onto the **current meeting's agenda**, item by
item, in the agenda's own numbering and titles — not last meeting's. For
each agenda item:

- If it was substantively discussed, summarize it in formal minutes prose
  (third person, past tense, no direct quotes, no verbatim back-and-forth).
  Multi-part agenda items (e.g. "8. 2027 Conference Planning" with several
  sub-bullets in the agenda) typically become numbered sub-items (8.1, 8.2,
  ...) in the minutes, matching how previous minutes have split similar
  items.
- If an actual motion was moved, seconded, and voted on, render it in the
  boxed motion format (see `references/data_schema.md`) — reserve this for
  real motions, not just any decision or agreement the Board reached
  informally.
- Substantive follow-ups the Board assigned to someone become an `ACTION:`
  line, formatted like precedent minutes (bold label, tab, then the text,
  attributed by initials — e.g. "S. Thomas to ...").
- Separately from the minutes prose, decide what belongs in the **recap tags**
  (`recap` in data.json — see `references/data_schema.md`): what the Board
  DECIDED, what is still OUTSTANDING, and what comes back NEXT MEETING. This is
  the same judgment you have already made while writing the minutes, written
  down once more in one-sentence form. It feeds the board's recap post on the
  website and appears only in the .html output, never in the .docx. Italicise
  the named thing each line is about with `*asterisks*`, and give any
  supporting document a `[descriptive label](url)` — see
  `references/data_schema.md`.
- If the agenda listed an item the Board never got to, say so plainly
  ("The Board did not reach this item due to time; it will be carried
  forward...") rather than omitting it or inventing content.
- Skip the small talk, technical difficulties, and off-topic banter that
  real transcripts are full of — minutes record board business, not the
  meeting verbatim.

Where the transcript is genuinely ambiguous — who moved a motion, an
unclear date, a decision that wasn't clearly finalized — make your best
editorial call the way a human minute-taker would, but tell the user about
it afterward rather than presenting a guess as settled fact.

### 4. Build the document

Read `references/data_schema.md` for the JSON content schema, then write a
`data.json` describing this meeting's minutes and run:

```bash
node scripts/build_minutes.js data.json output.docx
```

This writes **two** files from the one data.json:

| File | For | Recap tags |
|---|---|---|
| `output.docx` | Greg's records and the board — exact CSC letterhead | **no** |
| `output.html` | pasting into the CSC website's minutes editor | **yes** |

The .docx uses the exact CSC letterhead (logo from `assets/csc_logo.jpeg`, blue
section headers, boxed motion language, Present/Absent block, footer rule). The
.html matches the markup the website already stores — `<h1><strong>` sections,
`<h2><strong>` items, `<blockquote>` motions, `<ul><li><p>` bullets — so it
pastes in looking like every previous set of minutes instead of needing to be
reformatted by hand. Both are handled entirely by the script; your job is just
accurate, well-organized content in the JSON.

The recap tags are the ONLY difference between the two outputs. They are
machine-readable lines the website consumes and then deletes, so they must not
reach the formal document.

If you only need to regenerate the website copy (say, after fixing a typo), the
HTML emitter is standalone and needs no Word toolchain:

```bash
node scripts/build_html.js data.json output.html
```

### 5. Verify visually before delivering

Render to PDF and look at it — don't skip this, formatting bugs (bad page
breaks inside a motion box, awkward text wraps, a missing section) are easy
to introduce and easy to catch by eye:

```bash
python <path-to-docx-skill>/scripts/office/soffice.py --headless --convert-to pdf output.docx
pdftoppm -jpeg -r 100 output.pdf page
```

Then read the resulting page images back before sending the file.

### 6. Deliver and disclose assumptions

Send **both** files, and say which is which: the **.docx** is the formal
minutes for the board and Greg's records; the **.html** is what goes into the
website's minutes editor. Mention that the recap tags at the end of the HTML
disappear on save — otherwise they look like a formatting mistake and someone
will helpfully delete them before pasting, which silently kills the recap.

In your reply, call out (briefly) any editorial judgment
calls you made — assumed movers/seconders, ambiguous attendance, an
agenda item you inferred content for from a loosely-matched source, any new
transcription-error corrections you applied. This mirrors how a human
minute-taker would flag drafts for board review before they're finalized;
don't present uncertain reconstructions as fact.

## Keeping the roster/format current

If the user tells you the board membership changed, or confirms a new
recurring transcription error, update `references/board_roster.md`
accordingly. Since this skill lives in the user's saved skill library, you
can't edit their saved copy directly from a future session — after updating
the file here, repackage it (see the skill-creator's `package_skill.py`) and
send the updated `.skill` file so they can re-save it.
