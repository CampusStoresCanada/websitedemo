import { describe, it, expect } from "vitest";
import {
  diffDbAccessDrift,
  BASELINE_ANON_WRITABLE,
  BASELINE_SILENT_NOOP,
  BASELINE_DEFAULT_ACL,
  type DbAccessDriftReport,
} from "@/lib/ops/db-access-baseline";

/** The live report as it stood when the baseline was taken — the quiet case. */
function baselineReport(overrides: Partial<DbAccessDriftReport> = {}): DbAccessDriftReport {
  return {
    anon_writable: [...BASELINE_ANON_WRITABLE],
    silent_noop: { ...BASELINE_SILENT_NOOP },
    dead_policy: { benchmarking: "INSERT UPDATE DELETE", brand_colors: "INSERT UPDATE DELETE" },
    default_acl: [...BASELINE_DEFAULT_ACL],
    ...overrides,
  };
}

describe("diffDbAccessDrift", () => {
  it("is silent when the live state matches the baseline", () => {
    expect(diffDbAccessDrift(baselineReport())).toEqual([]);
  });

  it("flags a newly anon-writable table", () => {
    const findings = diffDbAccessDrift(
      baselineReport({ anon_writable: [...BASELINE_ANON_WRITABLE, "invoices"] })
    );
    expect(findings).toEqual([{ kind: "anon_writable", table: "invoices", commands: null }]);
  });

  it("flags a newly silent-no-op table", () => {
    const findings = diffDbAccessDrift(
      baselineReport({
        silent_noop: { ...BASELINE_SILENT_NOOP, board_meetings: "UPDATE" },
      })
    );
    expect(findings).toEqual([
      { kind: "silent_noop", table: "board_meetings", commands: "UPDATE" },
    ]);
  });

  it("flags a baselined table that gains a new silent command", () => {
    // shipments is baselined at DELETE. Gaining UPDATE means a fresh write path
    // just started vanishing, which is exactly what we want to hear about.
    const findings = diffDbAccessDrift(
      baselineReport({
        silent_noop: { ...BASELINE_SILENT_NOOP, shipments: "UPDATE DELETE" },
      })
    );
    expect(findings).toEqual([
      { kind: "silent_noop", table: "shipments", commands: "UPDATE DELETE" },
    ]);
  });

  it("flags any change to the schema default ACL", () => {
    const findings = diffDbAccessDrift(
      baselineReport({
        default_acl: [...BASELINE_DEFAULT_ACL, "{authenticated=arwdDxtm/postgres}"],
      })
    );
    expect(findings).toEqual([{ kind: "default_acl", table: null, commands: null }]);
  });

  it("ignores ACL ordering, which Postgres does not guarantee", () => {
    const findings = diffDbAccessDrift(
      baselineReport({ default_acl: [...BASELINE_DEFAULT_ACL].reverse() })
    );
    expect(findings).toEqual([]);
  });

  it("does not flag new dead policies — they are expected and would drown the signal", () => {
    const findings = diffDbAccessDrift(
      baselineReport({
        dead_policy: { some_brand_new_table: "INSERT UPDATE DELETE" },
      })
    );
    expect(findings).toEqual([]);
  });

  it("reports several drifts at once so each gets its own alert", () => {
    const findings = diffDbAccessDrift(
      baselineReport({
        anon_writable: [...BASELINE_ANON_WRITABLE, "rfps"],
        silent_noop: { ...BASELINE_SILENT_NOOP, board_meetings: "UPDATE" },
      })
    );
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.kind).sort()).toEqual(["anon_writable", "silent_noop"]);
  });

  it("survives a report with missing keys rather than throwing", () => {
    // A rule that crashes is indistinguishable from a rule that found nothing.
    const findings = diffDbAccessDrift({} as DbAccessDriftReport);
    expect(findings).toEqual([{ kind: "default_acl", table: null, commands: null }]);
  });

  it("keeps organizations and contacts baselined — both are still unfixed", () => {
    // If either is ever genuinely repaired, this test should be updated in the
    // same change that removes it from the baseline. Until then their presence
    // is load-bearing: it is why the rule stays quiet about them.
    expect(BASELINE_SILENT_NOOP.organizations).toBe("INSERT UPDATE DELETE");
    expect(BASELINE_SILENT_NOOP.contacts).toBe("INSERT UPDATE DELETE");
  });
});
