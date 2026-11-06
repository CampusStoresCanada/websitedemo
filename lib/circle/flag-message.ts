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
  /**
   * The queue entry for THIS flag, not the queue.
   *
   * ⛔ Was the bare queue URL. Sean Bell had three Butler messages about three
   * different questions, and all three links opened the same undifferentiated
   * list, so there was no way to tell which row any of them meant. "I can click
   * the links but it isn't bringing me to something that I can work with."
   */
  issueLink: string;
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
      `Reply here and we can sort it out. This one in the queue: ${input.issueLink}`
    : `${input.priorityLabel} — ${input.who} raised this on the site.${said}${lookingAt}\n\n` +
      `Reply here and we can sort it out. What they were looking at: ${input.reviewLink}`;
}

/**
 * What the room hears when somebody decides a flag.
 *
 * ⛔ Nothing used to say this. decideSurveyFlag wrote the row and returned, so
 * a member who flagged something was told it had been raised and then never
 * told anything again. Steve fixed Jackie Nguyen's question and had to message
 * Sean by hand to say so, because, in his words, "Butler ghost has no idea".
 *
 * ⛔ The resolution note is NOT in here, deliberately. The box that collects it
 * says "The store does not see this", and the reporter is in this room, so
 * putting it in the message would publish an internal note to the person it was
 * written about. This announces the OUTCOME; the note stays in the queue.
 *
 * ⛔ Addressed to the reporter, not to the responders. They are the one waiting
 * to hear, and a decision announced over their head is the shape that made
 * every flag feel like a form submission.
 *
 * Pure, so the wording can be asserted without a Circle client.
 */
export function buildFlagDecisionDm(input: {
  status: "acknowledged" | "resolved" | "dismissed";
  /** The reporter's first name where we have it, for a message aimed at them. */
  who: string;
  /** Who made the call, so this reads as a person rather than a status change. */
  actor: string | null;
  elementContent: string | null;
}): string | null {
  const on = input.elementContent
    ? `\n\nOn: "${oneLine(input.elementContent, 160)}"`
    : "";
  /*
    ⛔ "We" when nobody is named, never an empty prefix. Dropping the actor left
    the sentence as "marked it resolved", with no subject at all. A test caught
    it; a member would have read it.
  */
  const didIt = (verb: string) => (input.actor ? `${input.actor} ${verb}` : `We ${verb}`);

  switch (input.status) {
    case "acknowledged":
      return (
        `${input.who}, we have your flag and it is with the committee.${on}\n\n` +
        `${didIt("picked it up")}. Nothing needed from you for now.`
      );
    case "resolved":
      return (
        `${input.who}, that one is sorted.${on}\n\n` +
        `${didIt("marked it resolved")}. If it still looks wrong from where ` +
        `you are sitting, say so here and we will open it back up.`
      );
    case "dismissed":
      return (
        `${input.who}, we looked at this one and we are leaving the question ` +
        `as it stands.${on}\n\n` +
        `${didIt("made that call")}. If that does not sit right, reply here ` +
        `and we will go round again.`
      );
  }
}
