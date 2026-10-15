import { describe, it, expect, vi } from "vitest";
import { dispatchMessaging, type MessagingCandidate, type MessagingSource } from "../dispatch";
import { MESSAGING_PRIORITY as P } from "../priority";

const candidate = (email: string, priority: number, source: string, sent: string[]): MessagingCandidate => ({
  email, priority: priority as never, source, about: source,
  send: async () => { sent.push(`${source}->${email}`); return { success: true }; },
});
const src = (name: string, cs: MessagingCandidate[]): MessagingSource => ({ name, candidates: async () => cs });

describe("one email per person, the most pressing one", () => {
  it("sends the lapse notice and holds the onboarding nudge for the same person", async () => {
    const sent: string[] = [];
    const r = await dispatchMessaging([
      src("onboarding", [candidate("a@x.ca", P.onboarding, "onboarding", sent)]),
      src("renewals", [candidate("a@x.ca", P.lapse, "renewals", sent)]),
    ]);
    expect(sent).toEqual(["renewals->a@x.ca"]);
    expect(r.sent).toBe(1);
    expect(r.deferred).toBe(1);
  });

  it("five audiences with no overlap all go — nobody is delayed", async () => {
    const sent: string[] = [];
    await dispatchMessaging([
      src("a", [candidate("1@x.ca", P.campaign, "a", sent)]),
      src("b", [candidate("2@x.ca", P.campaign, "b", sent)]),
      src("c", [candidate("3@x.ca", P.event, "c", sent)]),
      src("d", [candidate("4@x.ca", P.deadline, "d", sent)]),
      src("e", [candidate("5@x.ca", P.onboarding, "e", sent)]),
    ]);
    expect(sent).toHaveLength(5);
  });

  it("a campaign to many still goes to everyone except the one who is overlapped", async () => {
    const sent: string[] = [];
    const campaign = ["p1@x.ca", "p2@x.ca", "p3@x.ca"].map((e) => candidate(e, P.campaign, "campaign", sent));
    await dispatchMessaging([
      src("campaign", campaign),
      src("renewals", [candidate("p2@x.ca", P.lapse, "renewals", sent)]),
    ]);
    expect(sent).toContain("campaign->p1@x.ca");
    expect(sent).toContain("campaign->p3@x.ca");
    expect(sent).toContain("renewals->p2@x.ca");
    expect(sent).not.toContain("campaign->p2@x.ca");
  });

  it("the loser is not written to at all, so it is a candidate again tomorrow", async () => {
    const send = vi.fn(async () => ({ success: true }));
    const loser: MessagingCandidate = {
      email: "a@x.ca", priority: P.onboarding, source: "onboarding", about: "toolkit_tour", send,
    };
    await dispatchMessaging([
      src("onboarding", [loser]),
      src("renewals", [candidate("a@x.ca", P.lapse, "renewals", [])]),
    ]);
    expect(send).not.toHaveBeenCalled();
  });

  it("a source that throws does not silence the others", async () => {
    const sent: string[] = [];
    const r = await dispatchMessaging([
      { name: "broken", candidates: async () => { throw new Error("db down"); } },
      src("renewals", [candidate("a@x.ca", P.lapse, "renewals", sent)]),
    ]);
    expect(sent).toEqual(["renewals->a@x.ca"]);
    expect(r.errors[0]).toContain("broken");
  });

  it("a failed send does not count as the inbox being taken", async () => {
    const r = await dispatchMessaging([
      src("renewals", [{
        email: "a@x.ca", priority: P.lapse, source: "renewals", about: "lapse",
        send: async () => ({ success: false, error: "bounced" }),
      }]),
      src("onboarding", [candidate("a@x.ca", P.onboarding, "onboarding", [])]),
    ]);
    expect(r.sent).toBe(0);
    expect(r.deferred).toBe(0);
    expect(r.errors[0]).toContain("bounced");
  });
});
