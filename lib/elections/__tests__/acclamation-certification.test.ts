/**
 * An acclaimed slate has to be certifiable, or the cycle dead-ends.
 *
 * Closing with as many validated nominees as seats drops the entire ballot
 * phase and leaves the election on `nominations_closed`. Nothing transitioned
 * out of it: sealing requires `balloting`, certifying requires `sealed`, and
 * both end-of-cycle sends refuse anything that is not `certified`. So the
 * acclaimed directors could never be told, the membership could never be told,
 * and the acclaimed branch removed the certify step from the timeline — two
 * permanently blocked steps with no button anywhere to clear them.
 *
 * By-Law Part V S3(d) treats the two as one act: the Chair announces the
 * ballot result OR the acclaimed candidates. One certification, two routes in.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const service = readFileSync("lib/elections/service.ts", "utf8");
const audit = readFileSync("app/admin/elections/[slug]/audit/page.tsx", "utf8");

const certify = service.slice(
  service.indexOf("export async function certifyElection"),
  service.indexOf("export interface AuditView")
);

describe("certifying an acclamation", () => {
  it("accepts it from nominations_closed, not from sealed", () => {
    expect(certify).toContain('election.status !== "nominations_closed"');
    expect(certify).toContain("An acclaimed slate is certified once nominations are closed");
  });

  it("still refuses a balloted election that was never sealed", () => {
    expect(certify).toContain('} else if (election.status !== "sealed") {');
    expect(certify).toContain("Only a sealed election can be certified");
  });

  it("reads the slate rather than a count that does not exist", () => {
    expect(certify).toContain("await getCandidateOutcomes(slug)");
  });

  it("refuses when nobody stood", () => {
    expect(certify).toContain("No validated nominee stood, so there is nobody to acclaim.");
  });

  it("records zeroes, never a count that did not happen", () => {
    const branch = certify.slice(certify.indexOf("if (acclaimed) {", certify.indexOf("const acclaimed")));
    expect(branch).toContain("ballots_returned: 0");
    expect(branch).toContain("ballots_sealed: 0");
    expect(branch).toContain("scrutineer_contact_id: null");
    expect(branch).toContain("tie_at_cutoff: false");
  });

  it("reaches certified, which is what unblocks the two sends", () => {
    expect(certify).toContain('.update({ status: "certified"');
  });
});

describe("the announcement names the acclaimed board", () => {
  it("does not route an acclamation through the count", () => {
    expect(service).toContain("const isAcclaimed = election.outcome === \"acclaimed\"");
    expect(service).toContain("!isAcclaimed && election.status === \"certified\" ? await countElection(slug) : null");
  });

  it("takes the names from the slate instead", () => {
    expect(service).toContain("acclaimedSlate.elected.map((c) => ({ name: c.name, institution: c.organizationName }))");
  });
});

describe("there is a button to press", () => {
  it("appears only for an acclaimed, uncertified election", () => {
    expect(audit).toContain(
      'election.outcome === "acclaimed" && election.status === "nominations_closed"'
    );
    expect(audit).toContain("Certify the acclaimed slate");
  });

  it("says no scrutineer is recorded, and why", () => {
    expect(audit).toContain("No scrutineer is recorded");
  });
});
