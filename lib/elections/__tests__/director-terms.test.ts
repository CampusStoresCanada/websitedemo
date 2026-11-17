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

/**
 * ⚠️ This block used to assert `elected_at_election_id` appeared NOWHERE, on
 * the grounds that a term must never be derived from an election result. The
 * rule was right about history and wrong about the present: the column exists
 * on the table for this purpose, sat null in all 56 rows, and its absence meant
 * a certified director held the seat on no date at all.
 *
 * What actually needs protecting is not the link — it is that no term appears
 * without a person putting it there. So the assertions moved from "never write
 * this column" to "never write it as a side effect", which is the thing that
 * would genuinely go wrong.
 */
describe("a term is written by a person, never as a side effect", () => {
  it("still says so at the top of the file", () => {
    expect(actions.replace(/\s*\n\s*\*\s*/g, " ")).toContain("never a place to infer one");
  });

  it("refuses to record elected terms before the result is certified", () => {
    const fn = actions.slice(actions.indexOf("export async function recordElectedTerms"));
    expect(fn).toContain('election.status !== "certified"');
  });

  it("gates recording, departure and appointment behind an administrator", () => {
    for (const name of ["recordElectedTerms", "resignDirector", "appointToVacancy"]) {
      const body = actions.slice(actions.indexOf(`export async function ${name}`));
      expect(body.slice(0, 700)).toContain("requireAdmin()");
    }
  });

  it("is idempotent, so certifying twice cannot seat anyone twice", () => {
    expect(service).toContain("alreadyRecordedNominationIds");
    expect(service).toContain('.eq("elected_at_election_id", election.id)');
    const fn = actions.slice(actions.indexOf("export async function recordElectedTerms"));
    expect(fn).toContain("!p.alreadyRecorded");
  });

  it("certification itself writes no term — the register is a separate, pressed act", () => {
    const certify = service.slice(service.indexOf("export async function certifyElection"));
    const body = certify.slice(0, certify.indexOf("\nexport "));
    expect(body).not.toContain("governance_role_assignments");
  });

  it("shows the whole proposal before it is written", () => {
    const panel = readFileSync(
      "components/admin/elections/ElectedTermsPanel.tsx",
      "utf8"
    );
    expect(panel).toContain("Counts toward the four-term limit");
    expect(panel).toContain("outstanding.map");
  });
});

describe("leaving the board, and filling the seat", () => {
  it("shortens a term rather than deleting it", () => {
    const fn = actions.slice(actions.indexOf("export async function resignDirector"));
    expect(fn).toContain("term_end: input.effectiveOn");
    expect(fn.slice(0, fn.indexOf("export async function appointToVacancy"))).not.toContain(
      ".delete()"
    );
  });

  it("keeps the date the seat was due to run to, which the successor needs", () => {
    const fn = actions.slice(actions.indexOf("export async function resignDirector"));
    expect(fn).toContain("would otherwise have run to");
  });

  it("refuses a departure date outside the term", () => {
    const fn = actions.slice(actions.indexOf("export async function resignDirector"));
    expect(fn).toContain("input.effectiveOn <= (row.term_start as string)");
    expect(fn).toContain("input.effectiveOn >= (row.term_end as string)");
  });

  it("requires the authority for both, because a seat changing hands needs a why", () => {
    const resign = actions.slice(actions.indexOf("export async function resignDirector"));
    expect(resign).toContain("!input.note.trim()");
    const appoint = actions.slice(actions.indexOf("export async function appointToVacancy"));
    expect(appoint).toContain("!input.appointingResolution.trim()");
    expect(appoint).toContain("appointing_resolution:");
  });
});

/**
 * One writer for the term, one writer for the door.
 *
 * `applyBoardTransition` used to insert the elected term itself, dated from the
 * MEETING, while `recordElectedTerms` writes the same row at certification on
 * the nominal January-1 convention. Two writers disagreeing about the dates on
 * one row, and the meeting-dated one was wrong: it opened a twenty-day gap in
 * which the seat had no holder.
 */
describe("the transition moves access, and no longer writes terms", () => {
  it("stopped inserting a term of its own", () => {
    const fn = service.slice(service.indexOf("export async function applyBoardTransition"));
    const body = fn.slice(0, fn.indexOf("\nexport "));
    expect(body).not.toContain('role_key: "director",\n        term_start: input.effectiveOn');
    expect(body).not.toContain("elected_at_election_id: election.id,\n        notes: `Elected");
  });

  it("stamps access_from across the incoming cohort", () => {
    const fn = service.slice(service.indexOf("export async function applyBoardTransition"));
    expect(fn).toContain("access_from: input.effectiveOn");
    expect(fn).toContain(".in(\"person_contact_id\", incomingContactIds)");
  });

  it("stamps access_until across the outgoing cohort, skipping protected roles", () => {
    const fn = service.slice(service.indexOf("export async function applyBoardTransition"));
    expect(fn).toContain("access_until: input.effectiveOn");
    expect(fn).toContain("filter((p) => !p.protectedRole)");
  });

  it("refuses to grant access when certification never recorded the terms", () => {
    const fn = service.slice(service.indexOf("export async function applyBoardTransition"));
    expect(fn).toContain("No terms are on the register for this election yet");
  });

  it("the access columns default to the term, so existing rows are unaffected", () => {
    const reg = readFileSync("lib/governance/register.ts", "utf8");
    expect(reg).toContain("term.accessFrom ?? term.termStart");
    expect(reg).toContain("term.accessUntil ?? term.termEnd");
  });
});
