# Minutes data.json schema

Feed this JSON to `scripts/build_minutes.js` to produce the formatted .docx. See
`scripts/example_data.json` for a complete worked example (the June 23, 2026 minutes).

```jsonc
{
  "meetingTitle": "CSC Board Meeting",          // almost always this exact string
  "meetingDateLong": "Tuesday, June 23, 2026",  // shown under the title
  "footerDate": "June 23, 2026",                // shown in the footer, right-aligned

  // Present/Absent: each is an array of strings rendered as separate lines under
  // the bold "Present:"/"Absent:" label. Put the voting board members as one
  // comma-separated string (don't hand-wrap it — Word wraps long lines on its
  // own using the hanging indent), then a blank string "" as a spacer line, then
  // staff on their own lines.
  "present": [
    "Shannon Blackadder, Imelda May, Jason Kack, Kevin Liu, Karen Stonehouse, Patricia Linden Teasdale, Sam Willis, Sean Bell",
    "",
    "Greg McPherson, Executive Director",
    "Stephen Thomas – Association Administrator"
  ],
  "absent": [
    "Shawn Davies",
    "Carolyn Potter – Conference Manager"
  ],

  // The body of the minutes, in order. Each block is one of the types below.
  "blocks": [
    { "type": "sectionHeading", "text": "BUSINESS ITEMS" },

    { "type": "item", "num": "1", "title": "Call to Order" },
    { "type": "body", "text": "S. Blackadder called the meeting to order on Tuesday, June 23, 2026, at 12:04 p.m. ET." },

    { "type": "item", "num": "2", "title": "Approval of Agenda" },
    { "type": "body", "text": "The Board reviewed the agenda." },
    { "type": "motion", "lines": [
        { "text": "In a motion duly moved and seconded, it was resolved that:", "underline": true },
        { "text": "The agenda be approved as presented." },
        { "text": "The Motion was carried." }
    ]},

    { "type": "bullet", "text": "A bullet point under the current item, indent defaults to 1080." },

    { "type": "subitem", "num": "6.1", "title": "Venue Floorplan Mock-up" },
    { "type": "body", "text": "Sub-item body text.", "indent": 1080 },

    { "type": "action", "label": "ACTION", "text": "S. Thomas to remove CEI's access to Circle." },
    { "type": "action", "label": "MOTION", "text": "Moved by S. Blackadder to adjourn the meeting." }
  ],

  // OPTIONAL. Editorial judgment calls made while drafting — an assumed mover,
  // ambiguous attendance, an item whose content was inferred, a new
  // transcription correction applied. In a chat session these are said out loud
  // when handing over the file; when the website drafts automatically there is
  // no chat, so they go here and are shown to the reviewer above the draft.
  "assumptions": [
    "Assumed S. Blackadder moved the adjournment; the transcript does not name a mover."
  ],

  // OPTIONAL. Machine-readable recap tags for the website's Butler Ghost board
  // recap. Emitted into the .html ONLY — never into the .docx. See "Recap tags"
  // below before filling this in; it is a judgment task, not a summary.
  "recap": {
    "decided":     ["Conference samples shipping confirmed at $750 for non-Connected partners."],
    "outstanding": ["Wednesday evening event venue — still comparing options. @Carolyn Potter"],
    "nextMeeting": ["Big Ideas Day pricing and room decision."]
  }
}
```

## Block types

- `sectionHeading` — bold blue header, one of `BUSINESS ITEMS`, `DISCUSSION ITEMS`, `OTHER BUSINESS`.
- `item` — a top-level numbered agenda item (`1.`, `2.`, …) in bold. `num` is just the number, no period.
- `subitem` — a sub-numbered item (`6.1`, `8.2`, …) indented one level, bold. `num` should include the trailing tab-worthy text as-is (e.g. `"6.1"`).
- `body` — a plain paragraph. `indent` in twips (720 = top-level indent under an `item`; 1080 = one level deeper, under a `subitem`).
- `bullet` — a bulleted line. `indent` defaults to 1080.
- `motion` — the boxed, centered "In a motion duly moved and seconded…" language used ONLY for an actual motion that was moved, seconded, and voted on. `lines` is an array of `{ "text": "...", "underline": true/false, "bold": true/false }`. The convention across CSC minutes is: line 1 underlined ("In a motion duly moved and seconded, it was resolved that:"), line 2 the resolution itself, line 3 the outcome ("The Motion was carried." or "...defeated.").
- `action` — a bold label (`ACTION` or `MOTION`) followed by a tab and the text, hanging-indented so wrapped lines align. Use `ACTION` for board-assigned follow-ups and `MOTION` for the adjournment line, matching precedent minutes.

## Rendering

```bash
node build_minutes.js data.json output.docx
python scripts/office/soffice.py --headless --convert-to pdf output.docx   # from the docx skill
pdftoppm -jpeg -r 100 output.pdf page
```

Always read the rendered page images back before delivering — check for awkward
line wraps, overflowing tables, or a motion box that split across a page break.

## Recap tags (`recap`)

Optional, and only meaningful for the `.html` output. Each string becomes one
line at the very end of the HTML:

```html
<p>DECIDED: …</p>
<p>OUTSTANDING: …</p>
<p>NEXT MEETING: …</p>
```

**These are not minutes content.** The CSC website parses them when the minutes
are saved, mints Butler Ghost's board recap draft from them, and then REMOVES
them from the stored minutes. They exist to carry a decision from your head to
the recap post; a few seconds after the paste they are gone. That is why they
are kept out of the `.docx` entirely — the formal document that circulates to
the board should never show the machinery.

**Write each line to stand alone as one sentence.** It goes into a bullet on the
recap post unedited, exactly as an `ACTION:` line goes into a task title.

**Two bits of inline formatting are available, and nothing else:**

| You write | The recap shows |
|---|---|
| `*Big Ideas Day*` | *Big Ideas Day* in italics |
| `[Here's the description](https://docs.google.com/...)` | a link with that label |

A bare `https://…` also becomes a link, shown without the scheme. Emphasise the
NAMED THING a bullet is about — the conference stream, the survey, the event —
so a reader scanning the list finds the subject before reading the sentence.
There is no bold: bold is already carrying the draft notice at the top of the
post, and two weights of emphasis in a short list reads as noise. A lone `*`
between spaces is left alone, so "Budget * 2" is safe.

Put the descriptive label in the link text (`[Here's the full description](…)`),
not the raw URL — the recap is read by people, and a Google Docs URL is thirty
unreadable characters.

**What goes in each:**

- `decided` — what the Board actually resolved or locked in. A real motion
  belongs here in plain language, but so does a firm decision reached without a
  formal motion. If it is still being argued, it is not decided.
- `outstanding` — what is genuinely still open. Name the person inline as
  `@Full Name` where one owns it; the website resolves mentions on save.
- `nextMeeting` — what is expected to come back to the Board next time.

**What does NOT go in:** anything that exists nowhere else in the minutes. After
the strip, the only surviving copy lives on the recap draft. Anything that
matters to the Board belongs in the body of the minutes as well — the tag is a
pointer for the post, not the archive.

**Do not add a heading above the block**, and do not invent a fourth tag. The
website removes the tagged paragraphs and nothing else, so a heading would
survive the removal and leave an empty section behind in the record; an unknown
tag is simply ignored and silently never reaches the recap.

Overlap with `ACTION:` lines is expected and fine. They are different pipelines:
`ACTION:` lines are durable, stay in the minutes forever, and mint board action
items. Recap tags are consumed. The same follow-up can legitimately be both.

Omitting `recap` entirely is allowed — the website simply drafts no recap for
that meeting, and the script says so when it runs.
