import { describe, expect, it } from "vitest";

import { buildSuiteOrgAssignmentsBySuiteId, findDuplicateSuiteOrgAssignment } from "../suite-assignment";

describe("findDuplicateSuiteOrgAssignment", () => {
  it("returns null when every suite maps to a distinct org", () => {
    const suites = [
      { id: "s1", suite_number: 1 },
      { id: "s2", suite_number: 2 },
    ];
    const byNumber = { "1": "org-a", "2": "org-b" };

    expect(findDuplicateSuiteOrgAssignment(suites, byNumber)).toBeNull();
  });

  it("returns null when an org has no suite assigned at all", () => {
    const suites = [{ id: "s1", suite_number: 1 }];
    expect(findDuplicateSuiteOrgAssignment(suites, {})).toBeNull();
  });

  it("flags an org bought two booths and pinned to two suites — the double-meeting-time case", () => {
    const suites = [
      { id: "s1", suite_number: 1 },
      { id: "s2", suite_number: 2 },
      { id: "s3", suite_number: 3 },
    ];
    const byNumber = { "1": "org-a", "2": "org-a", "3": "org-b" };

    const duplicate = findDuplicateSuiteOrgAssignment(suites, byNumber);
    expect(duplicate).not.toBeNull();
    expect(duplicate?.orgId).toBe("org-a");
    expect(duplicate?.suiteNumbers.sort()).toEqual([1, 2]);
  });
});

describe("buildSuiteOrgAssignmentsBySuiteId", () => {
  it("keys the assignment map by suite id, not suite number", () => {
    const suites = [
      { id: "s1", suite_number: 1 },
      { id: "s2", suite_number: 2 },
    ];
    const byNumber = { "1": "org-a", "2": "org-b" };

    expect(buildSuiteOrgAssignmentsBySuiteId(suites, byNumber)).toEqual({
      s1: "org-a",
      s2: "org-b",
    });
  });

  it("omits suites with no assignment", () => {
    const suites = [{ id: "s1", suite_number: 1 }];
    expect(buildSuiteOrgAssignmentsBySuiteId(suites, {})).toEqual({});
  });
});
