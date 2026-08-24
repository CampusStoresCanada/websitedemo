import { describe, it, expect } from "vitest";

/**
 * The chain, as a pure state machine. The point of pinning it here is that
 * silence must never publish on its own — that is the promise made to the
 * store whose number is being described.
 */

type Status = "draft" | "secretary_review" | "respondent_review" | "published" | "private";

interface Note {
  status: Status;
  respondentDecision: "agreed" | "objected" | null;
  publishedOnOverride: boolean;
}

const fresh = (status: Status): Note => ({
  status,
  respondentDecision: null,
  publishedOnOverride: false,
});

function secretary(n: Note, d: "approved" | "declined"): Note {
  if (n.status !== "secretary_review") return n;
  return { ...n, status: d === "approved" ? "respondent_review" : "private" };
}

function respondent(n: Note, d: "agreed" | "objected"): Note {
  if (n.status !== "respondent_review") return n;
  return {
    ...n,
    respondentDecision: d,
    status: d === "agreed" ? "published" : "private",
  };
}

function override(n: Note): Note {
  if (n.status !== "respondent_review" || n.respondentDecision !== null) return n;
  return { ...n, status: "published", publishedOnOverride: true };
}

describe("explanation approval chain", () => {
  it("publishes when the store agrees", () => {
    const n = respondent(secretary(fresh("secretary_review"), "approved"), "agreed");
    expect(n.status).toBe("published");
    expect(n.publishedOnOverride).toBe(false);
  });

  it("stays private when the store objects", () => {
    const n = respondent(secretary(fresh("secretary_review"), "approved"), "objected");
    expect(n.status).toBe("private");
  });

  it("stays private when the Secretary declines — the store is never asked", () => {
    const n = secretary(fresh("secretary_review"), "declined");
    expect(n.status).toBe("private");
    expect(n.respondentDecision).toBeNull();
  });

  it("silence does not publish on its own", () => {
    const waiting = secretary(fresh("secretary_review"), "approved");
    expect(waiting.status).toBe("respondent_review");
    // no respondent action, no time-based transition — it simply stays put
    expect(waiting.status).not.toBe("published");
  });

  it("an override publishes, and is recorded as an override", () => {
    const n = override(secretary(fresh("secretary_review"), "approved"));
    expect(n.status).toBe("published");
    expect(n.publishedOnOverride).toBe(true);
    expect(n.respondentDecision).toBeNull();
  });

  it("an override cannot overturn a store that said no", () => {
    const objected = respondent(secretary(fresh("secretary_review"), "approved"), "objected");
    expect(override(objected).status).toBe("private");
  });

  it("the store cannot be asked before the Secretary has seen it", () => {
    expect(respondent(fresh("draft"), "agreed").status).toBe("draft");
    expect(respondent(fresh("secretary_review"), "agreed").status).toBe("secretary_review");
  });
});
