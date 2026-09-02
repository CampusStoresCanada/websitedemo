/**
 * Strip personal contact details before anything is embedded or cached.
 *
 * ── Why, when the text was public to the community anyway ───────────────────
 *
 * An audit of the Circle corpus found 480 email addresses and 74 phone numbers
 * sitting in post and comment bodies — people answering each other with "email
 * me at …" and "our rep is 416-…". Nobody did anything wrong: they shared a work
 * contact in a members-only space, which is what the space is for.
 *
 * They are stripped anyway, for two reasons that both stand on their own:
 *
 *   1. They are NOISE. "julie.forgie@ubc.ca" contributes a direction built from
 *      a username and a domain. It cannot make a match better and it can make
 *      one worse.
 *   2. A derived corpus is a SECOND copy, in a different place, under different
 *      rules, that nobody consented to. Circle can revoke access, delete a post,
 *      honour a request to be forgotten. A 57MB JSON file on a laptop and a pile
 *      of vectors cannot. Not copying it is free; explaining why we did is not.
 *
 * ⛔ Redact at INGEST, not at display. Once a personal detail is inside an
 * embedding it cannot be taken out — the vector is derived from it and there is
 * no edit that removes it short of re-embedding the corpus.
 *
 * ⚠️ This is not anonymisation. WHO said a thing is retained deliberately: the
 * whole engine is person-level. This removes contact details from the text, so
 * the corpus says "Karin recommended a vendor" and never "Karin's number is …".
 */

/** Email addresses, including the "name+tag@" and multi-dot-TLD shapes. */
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * North American phone numbers as people actually type them.
 *
 * ⚠️ Deliberately narrow. A greedy digit pattern eats order quantities, prices
 * and product codes — "we ordered 100pc at 11.50" is the substance of a
 * procurement corpus and must survive.
 */
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;

export const EMAIL_MASK = "[email]";
export const PHONE_MASK = "[phone]";

/**
 * Replace contact details with a neutral marker.
 *
 * A marker rather than deletion: "email me at [email]" still reads as an offer
 * to take something offline, which is a real act, while "email me at" reads like
 * a truncation bug.
 */
export function redactContactDetails(text: string): string {
  if (!text) return text;
  return text.replace(EMAIL, EMAIL_MASK).replace(PHONE, PHONE_MASK);
}

/** What a redaction pass removed — for reporting a run, never for storage. */
export interface RedactionCount {
  emails: number;
  phones: number;
}

export function countRedactions(text: string): RedactionCount {
  return {
    emails: (text.match(EMAIL) ?? []).length,
    phones: (text.match(PHONE) ?? []).length,
  };
}

/**
 * Circle spaces whose content is never procurement signal.
 *
 * ⛔ **Board Stuff is governance, not commerce.** 405 documents of directors
 * deliberating — motions, reservations about a decision, who is voting which
 * way. It is the association's own internal reasoning, it says nothing about
 * what any store buys, and it has no business in a matching corpus. Same
 * principle as excluding CSC's own announcements: an association talking about
 * itself is not a member expressing demand.
 *
 * ⚠️ A curated list, and defensibly so — this is a governance boundary, which is
 * a human decision and not something to infer from the data. Add to it by
 * asking whether the space is people TALKING ABOUT THE ASSOCIATION rather than
 * about their stores.
 */
export const EXCLUDED_SPACES: ReadonlySet<string> = new Set([
  "Board Stuff",
  "Manager & Director Summit Meeting",
]);

export function isExcludedSpace(space: string | null | undefined): boolean {
  return space != null && EXCLUDED_SPACES.has(space);
}
