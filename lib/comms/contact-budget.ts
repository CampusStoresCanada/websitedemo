import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail } from "@/lib/comms/suppressions";

/**
 * How much have we contacted this person lately?
 *
 * ⛔ ONE ANSWER. The onboarding nudge job used to work this out privately from
 * two sources — its own progress rows and campaign deliveries — which made
 * every other sender invisible to it. Elections, renewals, benchmarking, the
 * conference checklist, Stripe receipts, applications, tickets and logins all
 * call lib/email/send.ts directly, and none of them recorded anything. Five
 * systems could mail the same person on the same day and each would believe it
 * was the only one.
 *
 * Every send now lands in email_log at the chokepoint, so this reader sees all
 * of them, including senders written after this comment.
 *
 * ⚠️ This gates NUDGES, never transactional mail. A password reset, a receipt,
 * a ticket or an invitation must go the moment it is earned, however much else
 * the person has had today. Rate-limiting those would be a bug, not courtesy.
 */

/** Anything from us within this many hours means a nudge waits. */
export const NUDGE_QUIET_HOURS = 24;

/** A person should never receive more than this from us in a day, nudges included. */
export const MAX_EMAILS_PER_PERSON_PER_DAY = 2;

/** When each of these addresses last heard from us, by any route we record. */
export async function lastContactedByEmail(
  emails: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (wanted.length === 0) return out;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // `email_log` is not in database.types.ts until the migration is applied and
  // the types regenerated. Same escape hatch lib/actions/onboarding.ts uses;
  // delete the cast at the next regen.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;
  // Chunked: PostgREST rejects an .in() list past roughly 200 values with a
  // Bad Request rather than returning rows, and a discarded error here would
  // read as "nobody has heard from us" — the failure mode that mails everyone.
  for (let i = 0; i < wanted.length; i += 150) {
    const chunk = wanted.slice(i, i + 150);
    const { data, error } = await db
      .from("email_log")
      .select("email, sent_at")
      .in("email", chunk)
      .order("sent_at", { ascending: false });
    if (error) throw new Error(`contact-budget: ${error.message}`);
    for (const row of (data ?? []) as { email: string; sent_at: string }[]) {
      const key = normalizeEmail(row.email);
      const seen = out.get(key);
      if (!seen || row.sent_at > seen) out.set(key, row.sent_at);
    }
  }
  return out;
}

/** How many emails each of these addresses has had since `since`. */
export async function countSentSince(
  emails: string[],
  since: Date
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const wanted = [...new Set(emails.map(normalizeEmail).filter(Boolean))];
  if (wanted.length === 0) return out;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;
  for (let i = 0; i < wanted.length; i += 150) {
    const chunk = wanted.slice(i, i + 150);
    const { data, error } = await db
      .from("email_log")
      .select("email")
      .in("email", chunk)
      .gte("sent_at", since.toISOString());
    if (error) throw new Error(`contact-budget: ${error.message}`);
    for (const row of (data ?? []) as { email: string }[]) {
      const key = normalizeEmail(row.email);
      out.set(key, (out.get(key) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * May we send this person a nudge right now?
 *
 * Pure, so the rule is testable without a database — the thing it prevents
 * only shows up across several systems on the same day, which is precisely
 * what nobody notices until members complain.
 */
export function mayNudge(opts: {
  lastContactedAt: string | null;
  sentInLastDay: number;
  now?: Date;
  quietHours?: number;
  maxPerDay?: number;
}): { allowed: boolean; reason?: string } {
  const now = opts.now ?? new Date();
  const quietHours = opts.quietHours ?? NUDGE_QUIET_HOURS;
  const maxPerDay = opts.maxPerDay ?? MAX_EMAILS_PER_PERSON_PER_DAY;

  if (opts.sentInLastDay >= maxPerDay) {
    return { allowed: false, reason: `already had ${opts.sentInLastDay} today` };
  }
  if (opts.lastContactedAt) {
    const hours = (now.getTime() - Date.parse(opts.lastContactedAt)) / 36e5;
    if (hours < quietHours) {
      return { allowed: false, reason: `heard from us ${hours.toFixed(1)}h ago` };
    }
  }
  return { allowed: true };
}
