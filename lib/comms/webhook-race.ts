/**
 * Telling a race apart from an email we never tracked.
 *
 * `executeCampaignSend` creates delivery rows, hands the whole batch to
 * Resend, and only THEN writes each row's provider_message_id, one UPDATE at
 * a time. Resend delivers in well under a second, so on a few-hundred-recipient
 * send the `delivered` webhooks arrive while that loop is still running and
 * match no row. The handler used to answer 200 and drop them: the Town Hall
 * send on 2026-09-21 recorded 96 delivered out of 529 while Resend had 496 —
 * and 242 opens against those 96, which cannot happen and is the fingerprint.
 * Opens and clicks survived only because they arrive minutes later.
 *
 * A miss on a FRESH email is that race, and the cure already exists: Resend
 * retries a non-2xx at 5s, 5min, 30min, 2h, 5h and 10h, and the second attempt
 * lands long after the id is written.
 *
 * A miss on an OLD email is not a race. /api/admin/comms/test-send delivers
 * real mail with no delivery row by design, so those events can never match.
 * Answering 503 to them would burn six retries and log six errors per test.
 *
 * Hence a window rather than a blanket retry. Fifteen minutes is far longer
 * than any id-writing loop and well inside the retry schedule, so a genuine
 * race is always caught on attempt two while an untracked email gives up after
 * two or three.
 */
export const RACE_WINDOW_MS = 15 * 60 * 1000;

/**
 * @param emailCreatedAt when Resend created the email (payload `data.created_at`)
 * @param now injectable for tests
 * @returns true when the miss is worth retrying rather than accepting
 */
export function isProbablyARace(
  emailCreatedAt: string | null | undefined,
  now: number = Date.now()
): boolean {
  if (!emailCreatedAt) return false;
  const created = Date.parse(emailCreatedAt);
  // An unparseable timestamp is not evidence of a race. Accept and move on
  // rather than retrying six times on a payload we cannot reason about.
  if (Number.isNaN(created)) return false;
  return now - created < RACE_WINDOW_MS;
}
