/**
 * An org MAY hold more than one suite — it buys throughput, not time.
 *
 * The old rule here was "one org, one suite", on the reasoning that two suites
 * are two concurrent rotations and therefore double the meeting time a
 * registration buys. The ED's ruling (2026-09-01) splits that in two, and only
 * half of it was ever true:
 *
 *   they may run a second suite      — a second check-out desk, more people met
 *   they do NOT get more time        — no delegate meets the same org twice
 *
 * The second half is already a hard constraint in the solver
 * (DUPLICATE_EXHIBITOR_ORG, keyed by delegate → organization across every
 * assignment, regardless of suite). So the limit that matters is enforced where
 * meetings are actually made, and the pre-flight "one org, one suite" check was
 * rejecting a legal arrangement before the solver ever saw it.
 *
 * ⛔ Two suites needs two PEOPLE. Each suite is pinned to a different exhibitor
 * registration; an org with one staffer can only staff one room, and the other
 * stays empty rather than being handed to somebody else.
 *
 * Pure so the scheduler action and tests share one source of truth.
 */

export type Suite = { id: string; suite_number: number };

/** The suite→org map the scheduler actually uses, keyed by suite id. */
export function buildSuiteOrgAssignmentsBySuiteId(
  suites: Suite[],
  suiteOrgAssignmentsBySuiteNumber: Record<string, string>
): Record<string, string> {
  const bySuiteId: Record<string, string> = {};
  for (const suite of suites) {
    const orgId = suiteOrgAssignmentsBySuiteNumber[String(suite.suite_number)];
    if (orgId) bySuiteId[suite.id] = orgId;
  }
  return bySuiteId;
}

/**
 * `reservedSuiteIds` is GONE — subsumed by the stronger rule.
 *
 * It kept held suites out of the free-fill pool. With free-fill deleted a suite
 * is only ever reached through a pin, and pins come only from holders, so
 * nothing can take a room it does not hold. A guard that can never fire reads
 * like protection and is really just something else to keep in step.
 */
