/**
 * Chasing the people who can actually sign.
 *
 * The chase that existed emails the NOMINEE to say they are short a
 * signature — the one person who cannot supply it. Nothing ever reached the
 * institution holding the request, which was asked once at submission and
 * never again. Three nominations in the 2027 cycle stalled on two clicks
 * because of it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const service = readFileSync("lib/elections/service.ts", "utf8");
const actions = readFileSync("lib/actions/elections.ts", "utf8");
const page = readFileSync("app/admin/elections/[slug]/page.tsx", "utf8");

const chase = service.slice(
  service.indexOf("export async function chaseOutstandingCosignatures"),
  service.indexOf("export async function notifyIfNowComplete")
);

describe("who it reaches", () => {
  it("targets the invited institutions, not the nominees", () => {
    expect(chase).toContain("notifyCosigners(");
    expect(chase).not.toContain("notifyNominationIncomplete");
  });

  it("emails every administrator there, same as the first request", () => {
    expect(chase).toContain('.eq("role", "org_admin")');
    expect(chase).toContain(".sort()");
    expect(chase).toContain("contactIds");
  });
});

describe("what it leaves alone", () => {
  it("skips signatures already given or withdrawn", () => {
    expect(chase).toContain('.is("signed_at", null)');
    expect(chase).toContain('.is("revoked_at", null)');
  });

  it("skips nominations that are dead", () => {
    expect(chase).toContain("!n.withdrawnAt && !n.candidateDeclinedAt");
  });

  it("does nothing once nominations have closed", () => {
    expect(chase).toContain("if (!nominationsOpen(election))");
  });
});

describe("when it fires", () => {
  it("rides the scheduled nomination reminder dates", () => {
    const runner = service.slice(service.indexOf("export async function runDueNominationReminders"));
    expect(runner.slice(0, 4000)).toContain("chaseOutstandingCosignatures(slug)");
  });

  it("is also a button, separate from the nominee chase", () => {
    expect(actions).toContain("export async function chaseCosignaturesAction");
    expect(page).toContain("chaseCosigners");
    expect(page).toContain("outstanding signature");
  });

  it("says plainly that it did nothing when there is nothing to chase", () => {
    const action = actions.slice(actions.indexOf("export async function chaseCosignaturesAction"));
    expect(action).toContain("No institution has an outstanding signature request.");
  });
});
