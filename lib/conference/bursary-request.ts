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
 *
 * Board, 2026-10-29 (confirmed by Steve 2026-11-02): a school whose cost is
 * still a barrier says what more it needs, and the board decides case by case.
 * That answer is optional and lives on the row's existing `notes` column,
 * which the staff queue already shows.
 *
 * Steve, 2026-11-02:
 *   * The request names one of the school's registration SEATS, not a person:
 *     whoever holds that seat is the supported delegate, and swapping the seat
 *     moves the support. Either order works, so a school can submit before it
 *     registers and pick the registration later; the pick stays open until
 *     January 17, 2027, after the request itself has closed.
 *   * No board gate. Submitting opens the expense claim; two people at CSC
 *     approve the claim, and that is the approval.
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
  "delegate_seat_id",
  "covers_hotel",
  "covers_travel",
  "payment_preference",
  "gm_buyer_confirmed",
  "notes",
] as const;
export type BursaryRequestField = (typeof BURSARY_REQUEST_FIELDS)[number];

export type BursaryRequestAnswers = {
  /** The registration seat the support is for. Its holder is the delegate. */
  delegate_seat_id: string | null;
  /**
   * Who it was for on requests made before seats were picked (two, both
   * 2026-11-02). Read-only: shown until a seat is picked, never saved again.
   */
  delegate_contact_id: string | null;
  covers_hotel: boolean | null;
  covers_travel: boolean | null;
  payment_preference: BursaryPaymentPreference | null;
  gm_buyer_confirmed: boolean | null;
  /** "I need additional help": what more the school needs. Optional. */
  notes: string | null;
};

/**
 * The one answer that can still change after the request is submitted, up to
 * the designation deadline: which registration it is for.
 */
export const BURSARY_DESIGNATION_FIELDS: readonly BursaryRequestField[] = ["delegate_seat_id"];

/** Longest "I need additional help" answer kept. */
export const BURSARY_NOTES_MAX = 2000;

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
    case "delegate_seat_id":
      return typeof value === "string" && UUID.test(value)
        ? { valid: true, clean: value }
        : { valid: false, error: "Pick one of your institution's registrations." };
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
    case "notes": {
      if (typeof value !== "string") return { valid: false, error: "That answer should be text." };
      const clean = value.trim();
      if (clean.length > BURSARY_NOTES_MAX) {
        return { valid: false, error: `Please keep this under ${BURSARY_NOTES_MAX} characters.` };
      }
      return { valid: true, clean: clean || null };
    }
  }
}

/**
 * What still stands between this request and submitting it, in the school's
 * terms. Empty means it can be submitted.
 */
export function bursaryRequestGaps(answers: BursaryRequestAnswers, termsAccepted: boolean): string[] {
  // Who it is for is NOT a gap: the school may submit before it registers,
  // and pick the registration later.
  const gaps: string[] = [];
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

export type HotelRate = { nightCents: number | null; taxBps: number | null };

/**
 * The most a school's hotel claim can be: its nights at the rate, plus room
 * tax, rounded once on the total as the hotel's own bill is. $185 x 4 + 19.78%
 * is $886.37; four nights at the rounded $221.59 would be $886.36, and the cap
 * would refuse the real bill. Null when no rate is set.
 */
export function hotelCapCents(nights: number, rate: HotelRate): number | null {
  if (!rate.nightCents) return null;
  return Math.round(nights * rate.nightCents * (1 + (rate.taxBps ?? 0) / 10_000));
}

/**
 * The hotel support in words: "3 hotel nights, up to $664.78 including tax".
 * Read by the request page and the "received" email, so both say the same.
 */
export function hotelNightsText(nights: number, rate: HotelRate): string {
  const label = `${nights} hotel night${nights === 1 ? "" : "s"}`;
  const cap = hotelCapCents(nights, rate);
  if (cap === null) return label;
  const max = (cap / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
  return `${label}, up to ${max} including tax`;
}

/** How many nights a school gets before staff change it: four for the listed schools, else three. */
export function defaultHotelNights(organizationId: string, fourNightOrgIds: readonly string[] | null | undefined): number {
  return fourNightOrgIds?.includes(organizationId) ? 4 : 3;
}

/**
 * The attendance terms in a supported delegate's "your schedule is ready"
 * email, or "" for everyone else. MOU Schedule B: before the conference, each
 * Supported Delegate gets in writing their Assigned Schedule, the attendance
 * standard, and the financial consequence to their institution of missing any
 * of it. The same rule binds a travel bursary delegate (Travel Bursary Terms).
 *
 * The schedule itself is the link in the same email: it carries every meeting
 * and, for CANCOLL, the AGM with its time and room, and stays right when a
 * swap moves something.
 */
export function attendanceTermsHtml(params: { funded: boolean; designated: boolean; institution: string }): string {
  const { funded, designated } = params;
  if (!funded && !designated) return "";
  const org = params.institution
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const why =
    funded && designated
      ? `Your registration is funded by CANCOLL, and ${org} asked Campus Stores Canada for travel support for you.`
      : funded
        ? "Your registration is funded by CANCOLL."
        : `${org} asked Campus Stores Canada for travel support for you.`;
  const what = funded
    ? "every partner meeting on your schedule, for its full scheduled time, and the CANCOLL Annual General Meeting, which is on your schedule with its time and room. Attendance is recorded at each meeting and at the door of the AGM."
    : "every partner meeting on your schedule, for its full scheduled time. Attendance is recorded at each meeting.";
  const value =
    funded && designated
      ? "your registration and any hotel and travel costs Campus Stores Canada pays"
      : funded
        ? "your registration"
        : "the support, including any hotel and travel costs Campus Stores Canada pays";
  return (
    `<p><strong>${why}</strong> In return, you must attend ${what} ` +
    `If you miss any of them without a reasonable excuse, such as illness or a travel disruption, ` +
    `${org} will be invoiced for the full value of ${value}.</p>`
  );
}
