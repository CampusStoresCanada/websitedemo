import { MESSAGING_PRIORITY, PRIORITY_LABEL, type MessagingPriority } from "@/lib/comms/priority";
import { normalizeEmail } from "@/lib/comms/suppressions";

/**
 * One job decides who is in a person's inbox today.
 *
 * ⛔ REPLACES ARBITRATION BY CLOCK. The first attempt at this staggered the
 * crons — renewals early, onboarding late — so whichever fired first claimed
 * the slot. That put the ladder in eight vercel.json entries where nobody
 * could see it, broke the moment anyone added a sender or moved a time, and
 * still raced: two jobs could both decide to write to the same person in the
 * same minute and neither would know. When the crons fire is now irrelevant.
 *
 * Senders no longer send. They DECLARE: here is who I would write to today,
 * about what, at what priority. This gathers every declaration, groups them by
 * person, sends the most pressing one, and leaves the rest. A candidate that
 * loses is not cancelled — its source still has it open tomorrow, which is why
 * every source must be safe to ask twice.
 *
 * ⚠️ ARBITRATES PEOPLE, NEVER SENDS. A campaign to 400 is 400 candidates; 399
 * of them win their inbox and go out on the day, and the one who is also
 * getting a lapse notice loses only their own copy. No send waits for anybody.
 *
 * ⛔ SYSTEM MAIL NEVER COMES HERE. A reset, a receipt, a ticket, a
 * notification: sent directly, the moment it is earned, by the code that
 * earned it. This file only ever sees mail we chose to write.
 */

export interface MessagingCandidate {
  /** Who it is for. Arbitration is per person. */
  email: string;
  /** Where it sits on the ladder. */
  priority: MessagingPriority;
  /** Which sender produced it, for the log. */
  source: string;
  /** What it is about, for the log. Never the body. */
  about: string;
  /**
   * Do the send, and whatever bookkeeping the source needs on success.
   *
   * Owned by the source because only it knows what "sent" means — a progress
   * row stamped, a delivery recorded, a reminder counted.
   */
  send: () => Promise<{ success: boolean; error?: string }>;
}

/** A sender, asked what it would write today. Must not send. Must be re-askable. */
export type MessagingSource = {
  name: string;
  candidates: () => Promise<MessagingCandidate[]>;
};

export interface DispatchResult {
  considered: number;
  sent: number;
  deferred: number;
  errors: string[];
  log: string[];
}

/** Lower number is more pressing. */
function morePressing(a: MessagingCandidate, b: MessagingCandidate): number {
  return a.priority - b.priority;
}

export async function dispatchMessaging(sources: MessagingSource[]): Promise<DispatchResult> {
  const result: DispatchResult = { considered: 0, sent: 0, deferred: 0, errors: [], log: [] };

  const all: MessagingCandidate[] = [];
  for (const source of sources) {
    try {
      const got = await source.candidates();
      all.push(...got);
      result.log.push(`${source.name}: ${got.length} candidate(s)`);
    } catch (e) {
      // One broken source must not silence the others — a renewal notice does
      // not wait on onboarding being able to answer.
      result.errors.push(`${source.name} could not be asked: ${String(e)}`);
    }
  }
  result.considered = all.length;

  const byPerson = new Map<string, MessagingCandidate[]>();
  for (const c of all) {
    const key = normalizeEmail(c.email);
    if (!key) continue;
    const list = byPerson.get(key);
    if (list) list.push(c);
    else byPerson.set(key, [c]);
  }

  for (const [email, candidates] of byPerson) {
    candidates.sort(morePressing);
    const [winner, ...rest] = candidates;

    const sendResult = await winner.send();
    if (!sendResult.success) {
      result.errors.push(`${winner.source} -> ${email}: ${sendResult.error}`);
      // Nothing is marked deferred: the loser did not lose to a delivered
      // email, and tomorrow everyone here is a candidate again.
      continue;
    }
    result.sent++;
    result.log.push(`sent ${email}: ${winner.source} (${PRIORITY_LABEL[winner.priority]}) — ${winner.about}`);

    for (const loser of rest) {
      result.deferred++;
      result.log.push(
        `held ${email}: ${loser.source} (${PRIORITY_LABEL[loser.priority]}) behind ${PRIORITY_LABEL[winner.priority]}`
      );
    }
  }

  return result;
}

export { MESSAGING_PRIORITY };
