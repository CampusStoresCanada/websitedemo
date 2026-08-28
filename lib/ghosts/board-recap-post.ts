/**
 * Butler Ghost's board meeting recap.
 *
 * Turns the tagged lines consumed from the minutes into the post that goes
 * into the private board space. Pure — no I/O — so it can be unit tested and
 * previewed without touching Circle.
 *
 * Output is always a DRAFT. Nothing here publishes; a human reads it, edits
 * it, and approves it first. See `ghost_announcements.status`.
 *
 * VOICE — Butler, not Helpful. Butler states facts about the reader's own
 * situation: this is the board's own meeting, reported back to the board. No
 * welcome, no editorialising, no enthusiasm. It says what was decided, what is
 * still open, and what is coming — and stops.
 *
 * Node vocabulary is the verified set only: `heading`, `paragraph`, `text`
 * (bold / link marks), `bulletList` / `listItem`, `horizontalRule`, `cta`.
 * `bulletList` was verified against the Board Stuff space on 2026-08-27 — see
 * the header of `new-partner-post.ts` for the verification method and the two
 * traps that make an unverified node look identical to a rejected one.
 */

export type PMNode = Record<string, unknown>;

const text = (value: string, bold = false): PMNode =>
  bold ? { type: "text", text: value, marks: [{ type: "bold" }] } : { type: "text", text: value };

const italic = (value: string): PMNode => ({
  type: "text",
  text: value,
  marks: [{ type: "italic" }],
});

const hardBreak = (): PMNode => ({ type: "hardBreak" });

const link = (label: string, href: string): PMNode => ({
  type: "text",
  text: label,
  marks: [{ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow" } }],
});

const para = (...content: PMNode[]): PMNode =>
  content.length ? { type: "paragraph", content } : { type: "paragraph" };

const heading = (value: string): PMNode => ({
  type: "heading",
  attrs: { level: 2 },
  content: [text(value)],
});

const rule = (): PMNode => ({ type: "horizontalRule" });

const cta = (label: string, url: string): PMNode => ({
  type: "cta",
  attrs: {
    url,
    label,
    color: "#B92026",
    text_color: "#FFFFFF",
    alignment: "center",
    full_width: false,
  },
});

/** A bullet's inner paragraph is required — Circle stores `listItem > paragraph`. */
const bullets = (items: PMNode[][]): PMNode => ({
  type: "bulletList",
  content: items.map((content) => ({
    type: "listItem",
    content: [para(...content)],
  })),
});

// ─────────────────────────────────────────────────────────────────────────
// Inline rendering
// ─────────────────────────────────────────────────────────────────────────

const MARKDOWN_LINK = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?]/g;
/**
 * `*Big Ideas Day*` → italic. Named things get emphasised in the recap so a
 * reader scanning the bullets can find the subject before reading the sentence.
 * Deliberately only single-asterisk: `**bold**` is not offered, because bold is
 * already doing a job in this post (the draft notice) and two weights of
 * emphasis in a six-bullet list reads as noise.
 */
const EMPHASIS = /\*([^*\n]+)\*/g;

/**
 * Turn one recap line into inline nodes, promoting links.
 *
 * `@Carolyn Potter` is deliberately left as plain text rather than rendered as
 * a Circle mention node. A real mention needs the member's Circle id, which
 * nothing here has, and an invented mention node is exactly the kind of
 * unverified structure Circle accepts with HTTP 200 and silently drops.
 */
export function renderRecapLine(line: string): PMNode[] {
  const nodes: PMNode[] = [];
  let rest = line;

  // Markdown links first — otherwise the bare-URL pass would consume the URL
  // out of the middle of the markdown form and leave the brackets behind.
  const mdParts: { label: string; href: string; index: number; length: number }[] = [];
  let m: RegExpExecArray | null;
  MARKDOWN_LINK.lastIndex = 0;
  while ((m = MARKDOWN_LINK.exec(line)) !== null) {
    mdParts.push({ label: m[1], href: m[2], index: m.index, length: m[0].length });
  }

  if (mdParts.length) {
    let cursor = 0;
    for (const part of mdParts) {
      if (part.index > cursor) nodes.push(...renderPlainWithUrls(line.slice(cursor, part.index)));
      nodes.push(link(part.label, part.href));
      cursor = part.index + part.length;
    }
    if (cursor < line.length) nodes.push(...renderPlainWithUrls(line.slice(cursor)));
    return nodes.length ? nodes : [text(line)];
  }

  rest = line;
  const out = renderPlainWithUrls(rest);
  return out.length ? out : [text(line)];
}

function renderPlainWithUrls(segment: string): PMNode[] {
  if (!segment) return [];
  const nodes: PMNode[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  BARE_URL.lastIndex = 0;
  while ((m = BARE_URL.exec(segment)) !== null) {
    if (m.index > cursor) nodes.push(...renderEmphasis(segment.slice(cursor, m.index)));
    // Shown without the scheme; a full URL as link text reads as noise.
    nodes.push(link(m[0].replace(/^https?:\/\//i, "").replace(/\/+$/, ""), m[0]));
    cursor = m.index + m[0].length;
  }
  if (cursor < segment.length) nodes.push(...renderEmphasis(segment.slice(cursor)));
  return nodes;
}

/** Split a plain run on `*emphasis*`, leaving everything else as-is. */
function renderEmphasis(segment: string): PMNode[] {
  if (!segment) return [];
  const nodes: PMNode[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  EMPHASIS.lastIndex = 0;
  while ((m = EMPHASIS.exec(segment)) !== null) {
    if (m.index > cursor) nodes.push(text(segment.slice(cursor, m.index)));
    nodes.push(italic(m[1]));
    cursor = m.index + m[0].length;
  }
  if (cursor < segment.length) nodes.push(text(segment.slice(cursor)));
  return nodes.length ? nodes : [text(segment)];
}

// ─────────────────────────────────────────────────────────────────────────
// The post
// ─────────────────────────────────────────────────────────────────────────

export interface BoardRecapPostInput {
  /** "Thursday, August 27, 2026". */
  meetingDateLong: string;
  /** The Board Only event page. Omitted → no button. */
  eventUrl?: string | null;
  decided: string[];
  outstanding: string[];
  nextMeeting: string[];
  /** True while the minutes have not yet been approved by the board. */
  minutesAreDraft: boolean;
}

export interface BoardRecapPost {
  title: string;
  tiptap_body: { body: { type: "doc"; content: PMNode[] } };
}

/** A section with no lines renders nothing at all — see the note below. */
function section(title: string, lines: string[]): PMNode[] {
  if (!lines.length) return [];
  return [heading(title), bullets(lines.map((l) => renderRecapLine(l)))];
}

export function buildBoardRecapPost(input: BoardRecapPostInput): BoardRecapPost {
  const content: PMNode[] = [];

  // The button leads. There is no prose introduction: the title already says
  // which meeting this is, and a sentence restating it is a line every reader
  // skips. Anyone who wants the detail wants the meeting page, so that is the
  // first thing offered.
  if (input.eventUrl?.trim()) {
    content.push(cta("See the full board meeting", input.eventUrl.trim()));
  }

  // Said up front rather than in a footnote: everything below is provisional
  // until the board approves the minutes, and a reader who skims the bullets
  // and stops should still have been told that. The leading break is spacing
  // under the button.
  if (input.minutesAreDraft) {
    content.push(
      para(
        hardBreak(),
        text("Note: ", true),
        text("these minutes are still in draft and have not yet been approved by the board.")
      )
    );
  }

  // An empty "Still outstanding" heading would read as a claim that nothing is
  // outstanding. That is a different statement from "the minutes didn't tag
  // anything", and only one of them is true — so an empty section is omitted
  // rather than rendered bare.
  const sections = [
    ...section("Decided", input.decided),
    ...section("Still outstanding", input.outstanding),
    ...section("Agenda for next meeting", input.nextMeeting),
  ];

  if (sections.length) {
    content.push(rule());
    content.push(...sections);
  }

  return {
    title: `Board meeting recap — ${input.meetingDateLong}`,
    tiptap_body: { body: { type: "doc", content } },
  };
}
