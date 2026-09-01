/**
 * Mint board action items from meeting minutes.
 *
 * The minutes are the only source that already exists and is already
 * structured — the `csc-board-minutes` skill emits `ACTION:` lines, and the
 * action-items spreadsheet turned out to be a hand transcription of those same
 * lines. See docs/BOARD_ACTION_ITEM_MINT.md.
 *
 * Everything here is pure: HTML in, graded proposals out. Nothing is written
 * to the database, and nothing notifies. That happens only when a human
 * confirms on the mint screen.
 */

// ─────────────────────────────────────────────────────────────────────────
// Rubric vocabulary
// ─────────────────────────────────────────────────────────────────────────

/**
 * Verbs that describe a state rather than an act with an end. `discuss` and
 * `review` are here by decision — "review our approach to advocacy" never
 * finishes. Compound items are rescued by ANY_COMPLETABLE below, so
 * "review the draft and report back by the 30th" still grades as an action.
 */
export const UNCOMPLETABLE_VERBS = [
  "continue", "maintain", "monitor", "oversee", "support", "promote",
  "explore", "revisit", "consider", "prioritize", "prioritise", "ensure",
  "keep", "be aware", "look at", "work on", "discuss", "review",
];

/** Verbs denoting an act that visibly ends. */
export const COMPLETABLE_VERBS = [
  "send", "call", "draft", "write", "confirm", "remove", "add", "invite",
  "book", "sign", "publish", "create", "deliver", "present", "circulate",
  "schedule", "establish", "provide", "contact", "define", "announce",
  "complete", "submit", "prepare", "obtain", "deny", "address", "develop",
  "secure", "arrange", "update", "produce", "share", "distribute", "collect",
  "finalize", "finalise", "respond", "approve", "purchase", "launch",
];

/**
 * Phrasal verbs whose particle separates from the verb in real minutes —
 * "bring finalized pricing back to the Board" is one act, not two words that
 * happen to be nearby. Matched with a bounded gap so the particle still has
 * to belong to the same clause.
 */
export const SEPARABLE_COMPLETABLE: [string, string][] = [
  ["report", "back"],
  ["bring", "back"],
  ["reach", "out"],
  ["follow", "up"],
  ["set", "up"],
  ["write", "up"],
];

/** Timing language that promises nothing. Presence alone fails test 3. */
const VAGUE_TIMING = [
  "at a future meeting", "in due course", "at some point", "eventually",
  "when possible", "as needed", "on an ongoing basis", "on a regular basis",
  "consistently", "regularly", "tbd", "to be determined",
];

/** Owner strings that name a body rather than a person. */
const COLLECTIVE_OWNERS = [
  "board", "the board", "all board members", "board members", "all directors",
  "executive", "executive committee", "committee", "everyone", "all",
];

/** An action item is a sentence or two, never a page. */
const MAX_ACTION_CHARS = 400;

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

// ─────────────────────────────────────────────────────────────────────────
// Text extraction
// ─────────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'",
  "&lt;": "<", "&gt;": ">", "&rsquo;": "'", "&lsquo;": "'",
  "&ldquo;": '"', "&rdquo;": '"', "&ndash;": "-", "&mdash;": "—", "&#8217;": "'",
};

/** HTML minutes → flat text, entities decoded, whitespace collapsed. */
export function stripMinutesHtml(html: string): string {
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");
  for (const [entity, char] of Object.entries(ENTITIES)) {
    text = text.split(entity).join(char);
  }
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Pull the ACTION lines out. Each runs from after `ACTION:` to whichever
 * comes first: the next ACTION, a numbered agenda marker (" 7. "), or the end.
 */
export function extractActionLines(html: string): string[] {
  const text = stripMinutesHtml(html);
  const marker = /ACTION\s*:/gi;

  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = marker.exec(text)) !== null) starts.push(m.index + m[0].length);

  return starts
    .map((start, i) => {
      const hardEnd = i + 1 < starts.length ? text.lastIndexOf("ACTION", starts[i + 1]) : text.length;
      let chunk = text.slice(start, hardEnd);

      // A numbered agenda heading ends the action. Multi-level numbers are
      // common ("8.4 JCWG Toronto Retail Store Tour Proposal"), so match a
      // dotted sequence, and require a sentence break before it — otherwise
      // "the 3.5 percent increase" would truncate here.
      // The heading itself may begin with a digit ("8.  2027 Conference
      // Planning"), so accept a capital OR a digit after the number. The
      // agenda number is capped at two digits so a stray year can't pose as one.
      const agenda = chunk.search(/[.;]\s+\d{1,2}(?:\.\d{1,2})*\.?\s+[A-Z0-9]/);
      if (agenda !== -1) chunk = chunk.slice(0, agenda + 1);

      chunk = chunk.replace(/\s+/g, " ").trim();

      // Safety net. Not every set of minutes uses numbered headings — the May
      // minutes don't, so without a cap the action absorbs the rest of the
      // document (2,933 characters in practice). An action item is a sentence
      // or two; cut at the last sentence boundary inside the cap so the
      // reviewer gets something editable rather than an essay.
      if (chunk.length > MAX_ACTION_CHARS) {
        const window = chunk.slice(0, MAX_ACTION_CHARS);
        const lastStop = window.lastIndexOf(". ");
        chunk = lastStop > 60 ? window.slice(0, lastStop) : window;
      }

      return chunk.replace(/[\s.;,]+$/, "");
    })
    .filter((line) => line.length > 0);
}

// ─────────────────────────────────────────────────────────────────────────
// Name resolution
// ─────────────────────────────────────────────────────────────────────────

export interface DirectoryEntry {
  id: string;
  displayName: string;
}

export interface ResolvedOwners {
  /** Profile ids, in the order they appeared. */
  ids: string[];
  /** Canonical display names, for rewriting the minutes to @mentions. */
  names: string[];
  /** Name fragments that matched nobody, or matched more than one person. */
  unresolved: string[];
  /** True when the owner text names a body ("the Board") rather than people. */
  collective: boolean;
}

function surnameOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

/**
 * Resolve an owner string to profiles, keyed on surname.
 *
 * Surname rather than first name because all twelve directors have distinct
 * surnames, while first names carry live aliases that naive matching gets
 * wrong — Kevin Liu logs in as huikai.liu@, and Trish Linden-Teasdale appears
 * as patricia.linden-teasdale@ on the board calendar.
 *
 * Ambiguity is never guessed: a surname matching two people resolves to
 * nobody and is reported in `unresolved` for a human to settle.
 */
export function resolveOwners(ownerText: string, directory: DirectoryEntry[]): ResolvedOwners {
  const cleaned = ownerText.replace(/@/g, " ").replace(/\s+/g, " ").trim();

  if (!cleaned) return { ids: [], names: [], unresolved: [], collective: false };

  const normalized = cleaned.toLowerCase().replace(/[^a-z\s-]/g, "").trim();
  if (COLLECTIVE_OWNERS.includes(normalized)) {
    return { ids: [], names: [], unresolved: [], collective: true };
  }

  const bySurname = new Map<string, DirectoryEntry[]>();
  for (const entry of directory) {
    const key = surnameOf(entry.displayName);
    bySurname.set(key, [...(bySurname.get(key) ?? []), entry]);
  }

  const fragments = cleaned
    .split(/\s+and\s+|\s*&\s*|\s*\/\s*|\s*,\s*/i)
    .map((f) => f.trim())
    .filter(Boolean);

  const ids: string[] = [];
  const names: string[] = [];
  const unresolved: string[] = [];
  let collective = false;

  for (const fragment of fragments) {
    const norm = fragment.toLowerCase().replace(/[^a-z\s-]/g, "").trim();
    if (COLLECTIVE_OWNERS.includes(norm)) {
      collective = true;
      continue;
    }

    // Last token is the surname; "S. Thomas", "Stephen Thomas" and "Thomas"
    // all reduce to the same key.
    const tokens = norm.split(/\s+/).filter(Boolean);
    const key = tokens[tokens.length - 1] ?? "";
    let matches = bySurname.get(key) ?? [];

    // Minutes name people both ways — "S. Thomas and Carolyn". Fall back to
    // first name when the surname matches nobody. Safe for the same reason
    // surnames are: all twelve are distinct, and ambiguity still refuses.
    if (matches.length === 0 && tokens.length === 1) {
      matches = directory.filter(
        (d) => d.displayName.trim().split(/\s+/)[0].toLowerCase() === key
      );
    }

    if (matches.length === 1) {
      if (!ids.includes(matches[0].id)) {
        ids.push(matches[0].id);
        names.push(matches[0].displayName);
      }
    } else {
      unresolved.push(fragment);
    }
  }

  return { ids, names, unresolved, collective };
}

// ─────────────────────────────────────────────────────────────────────────
// Rubric
// ─────────────────────────────────────────────────────────────────────────

export type QualityFlag =
  | "no_owner"
  | "owner_unresolved"
  | "uncompletable_verb"
  | "no_finish_line";

function containsPhrase(haystack: string, phrase: string): boolean {
  // Word-boundary match so "add" doesn't fire inside "additional".
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

export function hasCompletableVerb(text: string): boolean {
  if (COMPLETABLE_VERBS.some((v) => containsPhrase(text, v))) return true;
  return SEPARABLE_COMPLETABLE.some(([verb, particle]) =>
    // Up to six words may sit between the verb and its particle.
    new RegExp(`\\b${verb}\\b(?:\\W+\\w+){0,6}\\W+\\b${particle}\\b`, "i").test(text)
  );
}

export function hasUncompletableVerb(text: string): boolean {
  return UNCOMPLETABLE_VERBS.some((v) => containsPhrase(text, v));
}

export function hasVagueTiming(text: string): boolean {
  return VAGUE_TIMING.some((p) => containsPhrase(text, p));
}

/** A date the board would recognise as a deadline. */
export function extractDueDateText(text: string): string | null {
  const patterns = [
    // "end of March 2026" must be tried before the by-month-day form, whose
    // day group would otherwise swallow the first two digits of the year.
    new RegExp(`\\b(?:end\\s+of|beginning\\s+of|mid)\\s+(?:${MONTHS})(?:\\s+\\d{4})?`, "i"),
    new RegExp(`\\bby\\s+(?:the\\s+)?(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?!\\d)(?:,?\\s*\\d{4})?`, "i"),
    new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?!\\d),?\\s*\\d{4}`, "i"),
    /\bby\s+\d{4}-\d{2}-\d{2}\b/i,
    /\bby\s+the\s+next\s+(?:board\s+)?meeting\b/i,
    /\bwithin\s+\d+\s+(?:days?|weeks?|months?)\b/i,
    /\bby\s+\d{1,2}\/\d{1,2}\/\d{2,4}\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

export interface Grade {
  flags: QualityFlag[];
  isAction: boolean;
}

/**
 * Three tests. An item is an action only when it passes all of them;
 * otherwise it is an intention — recorded and counted, but never notified.
 */
export function grade(params: {
  text: string;
  owners: ResolvedOwners;
  dueDateText: string | null;
}): Grade {
  const { text, owners, dueDateText } = params;
  const flags: QualityFlag[] = [];

  // 1 — a named human. Two named people is still accountable; a body is not.
  if (owners.collective || owners.ids.length === 0) flags.push("no_owner");
  if (owners.unresolved.length > 0) flags.push("owner_unresolved");

  // 2 — any completable verb anywhere, not merely the lead verb.
  const completable = hasCompletableVerb(text);
  if (!completable) flags.push("uncompletable_verb");

  // 3 — a finish line. Vague timing fails outright; otherwise a date or an
  // act that visibly ends will do.
  if (hasVagueTiming(text) || (!dueDateText && !completable)) {
    flags.push("no_finish_line");
  }

  return { flags, isAction: flags.length === 0 };
}

// ─────────────────────────────────────────────────────────────────────────
// Proposals
// ─────────────────────────────────────────────────────────────────────────

export interface ProposedItem {
  /** The verbatim ACTION line, used for traceability and dedupe. */
  sourceExcerpt: string;
  /** Owner text as written in the minutes. */
  ownerText: string;
  /** The action, with the owner prefix removed. */
  title: string;
  ownerIds: string[];
  ownerNames: string[];
  unresolvedOwners: string[];
  dueDateText: string | null;
  flags: QualityFlag[];
  isAction: boolean;
}

/** Split "S. Thomas to remove CEI's access" into owner and action. */
function splitOwnerAndAction(line: string): { ownerText: string; title: string } {
  // [\s\S] rather than . with the dotAll flag, which needs es2018.
  const match = line.match(/^([\s\S]{1,80}?)\s+to\s+([\s\S]+)$/i);
  if (!match) return { ownerText: "", title: line };
  return { ownerText: match[1].trim(), title: match[2].trim() };
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function proposeFromMinutes(
  minutesHtml: string,
  directory: DirectoryEntry[]
): ProposedItem[] {
  return extractActionLines(minutesHtml).map((line) => {
    const { ownerText, title } = splitOwnerAndAction(line);
    const owners = resolveOwners(ownerText, directory);
    const dueDateText = extractDueDateText(line);
    const { flags, isAction } = grade({ text: line, owners, dueDateText });

    return {
      sourceExcerpt: line,
      ownerText,
      title: sentenceCase(title),
      ownerIds: owners.ids,
      ownerNames: owners.names,
      unresolvedOwners: owners.unresolved,
      dueDateText,
      flags,
      isAction,
    };
  });
}

/** Plain-language reasons, shown on the mint screen next to each proposal. */
export const FLAG_LABELS: Record<QualityFlag, string> = {
  no_owner: "No named owner",
  owner_unresolved: "Owner not recognised",
  uncompletable_verb: "No verb that can be completed",
  no_finish_line: "No due date or deliverable",
};

// ─────────────────────────────────────────────────────────────────────────
// Mention rewriting (runs on minutes save)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Rewrite bare names in the minutes to canonical `@Display Name` mentions, so
 * the stored minutes and the minted items agree on who is who.
 *
 * Only rewrites unambiguous surname matches, and never touches a name already
 * written as a mention.
 */
export function rewriteMentions(html: string, directory: DirectoryEntry[]): string {
  let output = html;

  for (const entry of directory) {
    const parts = entry.displayName.trim().split(/\s+/);
    const surname = parts[parts.length - 1];
    const first = parts[0] ?? "";
    if (!surname || !first) continue;

    // Only rewrite when this surname belongs to exactly one person.
    const sameSurname = directory.filter(
      (d) => surnameOf(d.displayName) === surname.toLowerCase()
    );
    if (sameSurname.length !== 1) continue;

    const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const forms = [
      `${esc(first)}\\s+${esc(surname)}`,
      `${esc(first.charAt(0))}\\.?\\s+${esc(surname)}`,
    ];

    for (const form of forms) {
      // Capture the preceding character rather than using a lookbehind — the
      // TS target predates es2018, where lookbehind became available. The
      // guard keeps an already-canonical "@Name" from being doubled up.
      output = output.replace(
        new RegExp(`(^|[^@\\w])(${form})\\b`, "g"),
        `$1@${entry.displayName}`
      );
    }
  }

  return output;
}

// ─────────────────────────────────────────────────────────────────────────
// Recap tags — READ AND REMOVE (see docs/BOARD_RECAP_POST_MINT.md)
// ─────────────────────────────────────────────────────────────────────────

/**
 * `DECIDED:` / `OUTSTANDING:` / `NEXT MEETING:` lines are addressed to the
 * machine, not to the board. Unlike `ACTION:` lines — which are durable, stay
 * in the minutes forever, and are re-read on demand by the mint screen — these
 * are CONSUMED: parsed once on save, moved onto the recap draft, and removed
 * from the stored minutes.
 *
 * That makes this the only parser in this file that has to EDIT the minutes
 * rather than flatten them, and it is why the removal below is deliberately
 * conservative. A missed tag leaves a visible line in the minutes that a human
 * can delete. An over-eager removal deletes the board's record of a meeting.
 * When those two are the choices, always miss.
 */

export type RecapKind = "decided" | "outstanding" | "next_meeting";

export interface RecapLine {
  kind: RecapKind;
  /** The line with its tag removed. HTML-stripped, mentions already canonical. */
  text: string;
  /** The whole line as written, tag included — traceability on the draft. */
  raw: string;
}

export interface RecapParse {
  lines: RecapLine[];
  /** The minutes with every consumed tag element removed. */
  strippedHtml: string;
  /** What was removed, verbatim. The only surviving copy — store it. */
  removedHtml: string;
}

/**
 * `NEXT MEETING` is tested first: it is the only two-word tag, and testing a
 * one-word tag first would never mis-fire but leaves the ordering looking
 * accidental. Whitespace inside the tag is tolerated because `&nbsp;` between
 * the words survives entity decoding as a plain space.
 */
const RECAP_PATTERNS: [RecapKind, RegExp][] = [
  ["next_meeting", /^NEXT\s+MEETING\s*:\s*/i],
  ["decided", /^DECIDED\s*:\s*/i],
  ["outstanding", /^OUTSTANDING\s*:\s*/i],
];

function matchRecapTag(flatText: string): { kind: RecapKind; body: string } | null {
  const trimmed = flatText.trim();
  for (const [kind, pattern] of RECAP_PATTERNS) {
    if (pattern.test(trimmed)) return { kind, body: trimmed.replace(pattern, "").trim() };
  }
  return null;
}

/** Block elements a tag line is plausibly wrapped in by the editor. */
const BLOCK_TAGS = ["li", "p", "h1", "h2", "h3", "h4", "h5", "h6", "div"];

interface BlockMatch {
  start: number;
  end: number;
  html: string;
  inner: string;
}

/**
 * Every block element whose own text begins with a recap tag.
 *
 * Deliberately NOT "find the first tag and truncate to the end of the
 * document" — that assumes the block is always last and always contiguous, and
 * a stray footer or an interleaved tag would silently take real minutes with
 * it. An element containing no tag is never touched.
 */
function findRecapBlocks(html: string): BlockMatch[] {
  const found: BlockMatch[] = [];

  for (const tag of BLOCK_TAGS) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const inner = m[1];
      // Non-greedy matching cannot pair nested same-name tags, so a <div>
      // wrapping other blocks is skipped and its inner blocks are matched
      // instead. Without this a nested <div> would match up to the WRONG
      // closing tag and removal would leave stray markup behind.
      if (tag === "div" && /<(?:div|p|li|h[1-6])\b/i.test(inner)) continue;
      if (!matchRecapTag(stripMinutesHtml(inner))) continue;
      found.push({ start: m.index, end: m.index + m[0].length, html: m[0], inner });
    }
  }

  // Innermost wins — a <li> inside a matched <div> should be the thing removed.
  const innermost = found.filter(
    (a) =>
      !found.some(
        (b) => b !== a && b.start >= a.start && b.end <= a.end && b.end - b.start < a.end - a.start
      )
  );

  innermost.sort((a, b) => a.start - b.start);

  // Any remaining overlap would corrupt the splice below.
  const disjoint: BlockMatch[] = [];
  for (const m of innermost) {
    if (disjoint.length && m.start < disjoint[disjoint.length - 1].end) continue;
    disjoint.push(m);
  }
  return disjoint;
}

/**
 * Removing every `<li>` of a list leaves `<ul></ul>`, which renders as a stray
 * gap. An empty list is never intentional, so it is safe to drop.
 *
 * Empty `<p>` is deliberately NOT cleaned up: blank paragraphs are real
 * spacing in the minutes, and we never create one (whole elements are removed,
 * not their contents).
 */
function dropEmptyLists(html: string): string {
  const blank = "(?:\\s|&nbsp;|<br\\s*/?>)*";
  let out = html;
  for (let i = 0; i < 3; i++) {
    const next = out.replace(new RegExp(`<(ul|ol)\\b[^>]*>${blank}</\\1>`, "gi"), "");
    if (next === out) break;
    out = next;
  }
  return out;
}

/** Minutes pasted as plain text, with no block markup around the tag lines. */
function parsePlainTextRecap(source: string): RecapParse {
  const kept: string[] = [];
  const removed: string[] = [];
  const lines: RecapLine[] = [];

  for (const line of source.split(/\r?\n/)) {
    const flat = stripMinutesHtml(line);
    const tag = matchRecapTag(flat);
    if (tag) {
      lines.push({ kind: tag.kind, text: tag.body, raw: flat.trim() });
      removed.push(line);
    } else {
      kept.push(line);
    }
  }

  if (!lines.length) return { lines: [], strippedHtml: source, removedHtml: "" };

  return {
    lines,
    strippedHtml: kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd(),
    removedHtml: removed.join("\n"),
  };
}

/**
 * Pull the recap tags out of the minutes and hand back the minutes without
 * them.
 *
 * Returns the source untouched when there is nothing to consume, so a caller
 * can treat "no tags" as "change nothing" without a special case.
 */
export function parseRecapLines(minutesHtml: string): RecapParse {
  const source = minutesHtml ?? "";
  if (!source.trim()) return { lines: [], strippedHtml: source, removedHtml: "" };

  const blocks = findRecapBlocks(source);
  if (!blocks.length) return parsePlainTextRecap(source);

  const lines: RecapLine[] = [];
  for (const block of blocks) {
    const flat = stripMinutesHtml(block.inner);
    const tag = matchRecapTag(flat);
    if (tag) lines.push({ kind: tag.kind, text: tag.body, raw: flat.trim() });
  }

  // Splice from the end so earlier offsets stay valid.
  let stripped = source;
  for (let i = blocks.length - 1; i >= 0; i--) {
    stripped = stripped.slice(0, blocks[i].start) + stripped.slice(blocks[i].end);
  }

  return {
    lines,
    strippedHtml: dropEmptyLists(stripped),
    removedHtml: blocks.map((b) => b.html).join(""),
  };
}

/** Group parsed lines by kind, preserving document order within each. */
export function groupRecapLines(lines: RecapLine[]): Record<RecapKind, RecapLine[]> {
  return {
    decided: lines.filter((l) => l.kind === "decided"),
    outstanding: lines.filter((l) => l.kind === "outstanding"),
    next_meeting: lines.filter((l) => l.kind === "next_meeting"),
  };
}
