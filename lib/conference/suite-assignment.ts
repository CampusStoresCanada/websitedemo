/**
 * One suite = one full day of independent meeting rotations, so an org
 * pinned to two suites would get two concurrent schedules — double the
 * meeting time a registration is meant to buy, regardless of how many
 * booths (Connected-tier or otherwise) it purchased. Pure so the scheduler
 * action and tests share one source of truth.
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

/** An org assigned to more than one suite, if any — the case the scheduler must reject. */
export function findDuplicateSuiteOrgAssignment(
  suites: Suite[],
  suiteOrgAssignmentsBySuiteNumber: Record<string, string>
): { orgId: string; suiteNumbers: number[] } | null {
  const suiteNumbersByOrgId = new Map<string, number[]>();
  for (const suite of suites) {
    const orgId = suiteOrgAssignmentsBySuiteNumber[String(suite.suite_number)];
    if (!orgId) continue;
    const list = suiteNumbersByOrgId.get(orgId) ?? [];
    list.push(suite.suite_number);
    suiteNumbersByOrgId.set(orgId, list);
  }

  for (const [orgId, suiteNumbers] of suiteNumbersByOrgId) {
    if (suiteNumbers.length > 1) return { orgId, suiteNumbers };
  }
  return null;
}
