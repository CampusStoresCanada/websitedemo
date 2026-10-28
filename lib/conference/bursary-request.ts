/**
 * The travel bursary request: its questions, what makes it complete, and
 * whether it is open.
 *
 * Pure module, read by the form, the save and the staff queue alike, for the
 * same reason benchmarking's field-registry is: a question list kept in two
 * places drifts, and a school picks a valid answer on screen that the server
 * then refuses.
 *
 * The rules (Steve, 2026-10-28): every member school may ask for hotel nights,
 * travel, or both, for one delegate who is "substantially in charge of the
 * purchase of General Merchandise for their institution". One request per
 * school. Reimbursement after the conference is preferred to CSC paying in
 * advance. The Travel Bursary Terms must be accepted to submit.
 */

export const BURSARY_PAYMENT_PREFERENCES = ["reimburse", "prepay"] as const;
export type BursaryPaymentPreference = (typeof BURSARY_PAYMENT_PREFERENCES)[number];

export const BURSARY_PAYMENT_LABELS: Record<BursaryPaymentPreference, string> = {
  reimburse: "Reimburse us after the conference (preferred)",
  prepay: "CSC pays in advance",
};

/** The exact wording of the eligibility rule, shown wherever it is confirmed. */
export const GM_BUYER_RULE =
  "substantially in charge of the purchase of General Merchandise for their institution";

/** The fields a school can save on its request, and nothing else. */
export const BURSARY_REQUEST_FIELDS = [
  "delegate_contact_id",
  "covers_hotel",
  "covers_travel",
  "payment_preference",
  "gm_buyer_confirmed",
] as const;
export type BursaryRequestField = (typeof BURSARY_REQUEST_FIELDS)[number];

export type BursaryRequestAnswers = {
  delegate_contact_id: string | null;
  covers_hotel: boolean | null;
  covers_travel: boolean | null;
  payment_preference: BursaryPaymentPreference | null;
  gm_buyer_confirmed: boolean | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isBursaryRequestField(field: string): field is BursaryRequestField {
  return (BURSARY_REQUEST_FIELDS as readonly string[]).includes(field);
}

/** Validate one answer. Null always clears a field. */
export function validateBursaryAnswer(
  field: BursaryRequestField,
  value: unknown
): { valid: true; clean: string | boolean | null } | { valid: false; error: string } {
  if (value === null) return { valid: true, clean: null };
  switch (field) {
    case "delegate_contact_id":
      return typeof value === "string" && UUID.test(value)
        ? { valid: true, clean: value }
        : { valid: false, error: "Pick the delegate from your school's people." };
    case "covers_hotel":
    case "covers_travel":
    case "gm_buyer_confirmed":
      return typeof value === "boolean"
        ? { valid: true, clean: value }
        : { valid: false, error: "That answer should be yes or no." };
    case "payment_preference":
      return typeof value === "string" && (BURSARY_PAYMENT_PREFERENCES as readonly string[]).includes(value)
        ? { valid: true, clean: value }
        : { valid: false, error: "Choose how you'd like to be paid." };
  }
}

/**
 * What still stands between this request and submitting it, in the school's
 * terms. Empty means it can be submitted.
 */
export function bursaryRequestGaps(answers: BursaryRequestAnswers, termsAccepted: boolean): string[] {
  const gaps: string[] = [];
  if (!answers.delegate_contact_id) gaps.push("Choose who the support is for.");
  if (!answers.covers_hotel && !answers.covers_travel) gaps.push("Choose hotel, travel, or both.");
  if (!answers.payment_preference) gaps.push("Choose how you'd like to be paid.");
  if (answers.gm_buyer_confirmed !== true) gaps.push(`Confirm the delegate is ${GM_BUYER_RULE}.`);
  if (!termsAccepted) gaps.push("Read and agree to the Travel Bursary Terms.");
  return gaps;
}

/**
 * Is the request open? `closesAt` is an EXCLUSIVE instant, the same convention
 * as benchmarking_surveys.closes_at, so the last day shown to a school is the
 * day before it (see lib/benchmarking/deadline.ts). No deadline set: open.
 */
export function bursaryRequestOpen(closesAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!closesAt) return true;
  const boundary = Date.parse(closesAt);
  return Number.isNaN(boundary) ? true : now.getTime() < boundary;
}
