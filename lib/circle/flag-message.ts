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
  const said = quoted(input.note, 600);
  const lookingAt = input.elementContent
    ? `\n\nThey were on: "${oneLine(input.elementContent, 160)}"`
    : "";

  return input.survey
    ? `${input.priorityLabel} — ${input.who} flagged a question while filling the benchmarking survey.${said}${lookingAt}\n\n` +
      `Answer them directly, or work it in the queue: ${input.issuesUrl}`
    : `${input.priorityLabel} — ${input.who} flagged something on the site.${said}${lookingAt}\n\n` +
      `Review: ${input.reviewLink}`;
}

