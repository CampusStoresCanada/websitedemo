/**
 * The travel bursary's review vocabulary.
 *
 * Its own module, with no server imports, because the review widget is a client
 * component: importing these from `bursary-widget.ts` would drag
 * `createAdminClient` into the client bundle, which lib/supabase/admin.ts
 * forbids in as many words.
 *
 * The four values are the ones `conference_bursary_applications_status_check`
 * allows. Adding one here without widening that constraint writes a status the
 * database will reject.
 */

export const BURSARY_STATUSES = ["submitted", "approved", "denied", "fulfilled"] as const;

export type BursaryStatus = (typeof BURSARY_STATUSES)[number];

/** Plain labels — what was recorded, never why. */
export const BURSARY_STATUS_LABELS: Record<BursaryStatus, string> = {
  submitted: "Awaiting review",
  approved: "Approved",
  denied: "Declined",
  fulfilled: "Fulfilled",
};

const STATUS_SET = new Set<string>(BURSARY_STATUSES);

export function isBursaryStatus(value: string): value is BursaryStatus {
  return STATUS_SET.has(value);
}
