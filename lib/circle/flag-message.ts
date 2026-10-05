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
  issuesUrl: string;
  reviewLink: string;
}): string {
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

