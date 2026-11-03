/**
 * What a flag notification says.
 *
 * ⛔ A plain module, for the same reason flag-routing.ts is one: flag-notify.ts
 * reaches lib/email/send.ts, which constructs a Resend client at module scope
 * and throws without an API key, so anything living there cannot be imported by
 * a test. That note is written at the top of flag-routing.ts. I put this
 * function in flag-notify.ts anyway, hit precisely that error, and worked around
 * it by mocking four modules instead of reading the warning sitting next to me.
 */

/**
 * The staff-only message beside an Ask CSC room: everything the asker does not
 * need to see — priority, who they are and where to find them, and the War Room
 * record to resolve. Sent to CSC staff without the asker.
 */
export function buildAskStaffNote(input: {
  priorityLabel: string;
  who: string;
  note: string | null;
  details: string | null;
  reviewLink: string;
}): string {
  const details = input.details?.trim() ? `\n\n${input.details.trim().slice(0, 600)}` : "";
  return (
    `${input.priorityLabel} — ${input.who} asked CSC.${quoted(input.note, 600)}${details}\n\n` +
    `They're in a Butler room with us; reply there. Mark it Done in the War Room once it's sorted: ${input.reviewLink}`
  );
}

/** One line, collapsed and clipped. Page text arrives with layout whitespace in it. */
export function oneLine(text: string, max: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/** A quoted block, or nothing at all when there is nothing to quote. */
export function quoted(text: string | null, max: number): string {
  const t = text?.trim();
  return t ? `\n\n"${t.slice(0, max)}"` : "";
}

/**
 * The direct message a flag produces.
 *
 * Pure and exported so it can be asserted on. The reason it is worth asserting:
 * this message carried neither what the member wrote nor who they were, for
 * every flag ever raised, and nothing failed — the DM sent, the delivery
 * succeeded, and it simply had no content anybody could act on. A test is the
 * only thing that notices that.
 */
export function buildFlagDm(input: {
  priorityLabel: string;
  who: string;
  note: string | null;
  elementContent: string | null;
  survey: boolean;
  /**
   * "Ask CSC" at a conference. `elementContent` is then who they are and where
   * they are — store, booth, phone, what they're in now and next — written as
   * lines, so it is printed whole rather than as one clipped line.
   */
  conferenceAsk?: boolean;
  issuesUrl: string;
  reviewLink: string;
}): string {
  if (input.conferenceAsk) {
    // ⛔ Their question and nothing else: the asker is in this room. Priority,
    // their details and the War Room link are ours (Stephen, 2026-10-22) and go
    // to CSC staff alone — buildAskStaffNote.
    return quoted(input.note, 600).trim() || `${input.who} asked CSC.`;
  }
  /*
    ⛔ Written to a ROOM that contains the person who raised it, not to a
    committee about them. They can read it, so it cannot be a report on their
    conduct — it is the opening line of a conversation they are part of. Hence
    "raised this", their words quoted as theirs, and an invitation to talk here
    rather than an instruction to go and process it somewhere else.
  */
  const said = quoted(input.note, 600);
  const lookingAt = input.elementContent
    ? `\n\nOn: "${oneLine(input.elementContent, 160)}"`
    : "";

  return input.survey
    ? `${input.priorityLabel} — ${input.who} raised this while filling the benchmarking survey.${said}${lookingAt}\n\n` +
      `Reply here and we can sort it out. The queue, for the record: ${input.issuesUrl}`
    : `${input.priorityLabel} — ${input.who} raised this on the site.${said}${lookingAt}\n\n` +
      `Reply here and we can sort it out. What they were looking at: ${input.reviewLink}`;
}

