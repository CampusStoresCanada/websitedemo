/**
 * Recording board service, so the term limit can be checked.
 *
 * countConsecutiveTerms returns null for a person with no recorded history and
 * the nomination reports the limit as unverifiable. That refusal is correct —
 * returning "eligible" from missing data would be the bug — but its own
 * docstring calls for "an explicit zero-length history row set by the admin
 * UI", and that UI did not exist. The flag had nothing to press.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const actions = readFileSync("lib/actions/director-terms.ts", "utf8");
const editor = readFileSync("components/admin/elections/DirectorTermsEditor.tsx", "utf8");
const page = readFileSync("app/admin/elections/[slug]/page.tsx", "utf8");
const service = readFileSync("lib/elections/service.ts", "utf8");

describe("only an administrator may write governance history", () => {
  it("gates every write", () => {
    for (const fn of ["addDirectorTerm", "recordNoPriorService", "removeDirectorTerm"]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 600)).toContain("requireAdmin()");
    }
  });

  it("scopes deletion to director rows, so an office cannot be removed by id", () => {
    const remove = actions.slice(actions.indexOf("export async function removeDirectorTerm"));
    expect(remove).toContain('.eq("role_key", "director")');
  });
});

describe("the end date is exclusive, and said so", () => {
  it("refuses an end on or before the start", () => {
    expect(actions).toContain("input.termEnd <= input.termStart");
  });

  it("explains the convention where the date is typed, not in a comment", () => {
    expect(editor).toContain("Ended (exclusive)");
    expect(editor).toContain("a term running through 2027 ends 2028-01-01");
  });
});

describe("never served is recordable, and distinct from unknown", () => {
  it("writes a zero-length row that does not count", () => {
    const fn = actions.slice(actions.indexOf("export async function recordNoPriorService"));
    expect(fn).toContain("term_start: input.asOf");
    expect(fn).toContain("term_end: input.asOf");
    expect(fn).toContain("counts_toward_cap: false");
  });

  it("is read back as a marker rather than as a term served", () => {
    expect(service).toContain("isNoServiceMarker");
    expect(service).toContain("row.term_end === row.term_start");
  });
});

describe("the editor sits where the flag is raised", () => {
  it("renders on the nomination row", () => {
    expect(page).toContain("<DirectorTermsEditor");
    expect(page).toContain("termsByNomination[n.id]");
  });

  it("opens itself when nothing is recorded", () => {
    expect(editor).toContain("useState(terms.length === 0)");
  });
});

describe("nothing is inferred", () => {
  it("derives no term from an election result", () => {
    expect(actions).not.toContain("elected_at_election_id");
    expect(actions.replace(/\s*\n\s*\*\s*/g, " ")).toContain("never a place to infer one");
  });
});
