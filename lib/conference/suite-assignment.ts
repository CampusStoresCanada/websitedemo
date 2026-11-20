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

/**
 * Which exhibitor seat runs each suite, and so which seats are scheduled.
 *
 * ⛔ ONE RULE, TWO CALLERS: the admin Generate button and
 * `scripts/schedule-search.ts`. The script carried its own copy, which fell
 * behind the button on 2026-10-26: it pinned whichever seat came first rather
 * than a named one, so a company's named person could be left off their own
 * suite's meetings, and it passed every staff seat to the solver, so 54 seats
 * with no room each read as an exhibitor below target (rehearsal, 2026-11-20).
 *
 * A seat with someone named runs a suite first; an unnamed seat stands in for
 * its company until a name arrives. One seat per suite, never reused: two
 * suites need two people.
 */
export function pinSuiteExhibitors<
  E extends { registrationId: string; organizationId: string; userId: string }
>(
  suites: Suite[],
  suiteOrgBySuiteId: Record<string, string>,
  exhibitors: readonly E[]
): { pinnedSeatBySuiteId: Record<string, string>; schedulable: E[] } {
  const ordered = [...exhibitors].sort(
    (a, b) => Number(!a.userId) - Number(!b.userId) || a.registrationId.localeCompare(b.registrationId)
  );
  const byOrg = new Map<string, E[]>();
  for (const exhibitor of ordered) {
    const list = byOrg.get(exhibitor.organizationId) ?? [];
    list.push(exhibitor);
    byOrg.set(exhibitor.organizationId, list);
  }
  const used = new Set<string>();
  const pinnedSeatBySuiteId: Record<string, string> = {};
  for (const suite of suites) {
    const orgId = suiteOrgBySuiteId[suite.id];
    if (!orgId) continue;
    const chosen = (byOrg.get(orgId) ?? []).find((row) => !used.has(row.registrationId));
    if (!chosen) continue;
    pinnedSeatBySuiteId[suite.id] = chosen.registrationId;
    used.add(chosen.registrationId);
  }
  // The seats that RUN a suite, not every seat at a suite-holding company.
  return { pinnedSeatBySuiteId, schedulable: exhibitors.filter((e) => used.has(e.registrationId)) };
}
