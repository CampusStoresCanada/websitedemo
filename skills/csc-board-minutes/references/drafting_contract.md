# Drafting contract — transcript → data.json

**This file is the model-facing task, and it is the ONLY thing the website sends.**

`SKILL.md` describes the whole human workflow: finding a transcript, running the
build scripts, rendering to PDF, checking it by eye, delivering the files. None
of that applies when this runs on the website — the caller has already fetched
the inputs and will do the rendering itself. Sending those instructions to a
model that follows them literally would produce an attempt to do work it cannot
do. So the judgment lives here, the workflow stays in `SKILL.md`, and both read
from one place.

## Your task

You are given, in the request:

- the **transcript** of one CSC board meeting (verbatim, speaker labels poor)
- the **agenda** for that same meeting
- the **previous meeting's minutes**, for continuity on carried-forward items
- the **current board roster and staff**, from the association's own records

Produce **`data.json`** and nothing else — no prose, no commentary, no files.
The output shape is defined in `data_schema.md`; the response is schema-
constrained, so a shape that doesn't validate cannot be returned.

## Judgment rules

Map what actually happened onto the **agenda for this meeting**, item by item,
in the agenda's own numbering and titles — never the previous meeting's.

- **Discussed substantively** → summarise in formal minutes prose: third person,
  past tense, no direct quotes, no verbatim back-and-forth. Multi-part agenda
  items typically become numbered sub-items (8.1, 8.2, …).
- **A real motion** — moved, seconded, and voted on → the boxed motion format.
  Reserve it for actual motions, not for any decision or agreement the Board
  reached informally. CSC's convention is impersonal ("In a motion duly moved
  and seconded, it was resolved that:"), so a mover you cannot identify from
  the transcript is usually not needed.
- **A follow-up the Board assigned to someone** → an `ACTION:` line, attributed
  by initials ("S. Thomas to …").
- **Not reached** → say so plainly ("The Board did not reach this item due to
  time; it will be carried forward…"). Never omit it, never invent content.
- **Small talk, technical difficulties, off-topic banter** → leave it out.
  Minutes record board business, not the meeting verbatim.

## Names and attendance

`board_roster.md` carries the proper nouns the transcription reliably mangles —
apply those corrections. The roster of who currently serves is supplied in the
request from the association's records; prefer it over any list in that file.

**Speaker labels in the transcript are unreliable** — Notion attributes speech
to the recording account and everyone else as "Others". Reconstruct Present /
Absent from what is said rather than from labels: a roll call at call to order,
people addressing each other by name, someone speaking to their own report. Two
board members with names that are easily confused by speech-to-text are flagged
in `board_roster.md`; do not assume attendance from spelling alone.

## Recap tags

After the Adjournment block, emit the `DECIDED:` / `OUTSTANDING:` /
`NEXT MEETING:` lines described in `data_schema.md` under `recap`. These are
consumed and removed by the website on save — they are a delivery mechanism,
not minutes content, so nothing may live only there.

## Where you are uncertain

Make the editorial call a human minute-taker would make, and record what you
were unsure about in the `assumptions` field rather than presenting a guess as
settled fact: an assumed mover or seconder, ambiguous attendance, an agenda item
whose content you inferred from thin discussion, any new transcription-error
correction you applied. A person reads this draft before it becomes the record,
and that list is what they check first.
