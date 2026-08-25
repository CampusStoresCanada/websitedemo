import { describe, expect, it } from "vitest";

/**
 * "Complete conference payment" must mean nothing is owed.
 *
 * The original asked whether the org had paid ANYTHING — one settled order
 * marked the task complete regardless of what else was outstanding — and it
 * read `paid_at`, which is not reliably populated. On CSC 2027 one order
 * carries status 'paid' with a null `paid_at` (Varsity Collection, $9,040,
 * two booths), so the timestamp version would have told that company it had
 * not paid for booths it holds.
 */
function db(statuses: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {};
  b.select = () => b;
  b.eq = () => b;
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: statuses.map((status) => ({ status })), error: null }).then(resolve);
  return { from: () => b };
}

const run = async (statuses: string[]) => {
  const { CHECKS } = await import("../checklist-checks");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return CHECKS.payment_complete({ db: db(statuses) as any, organizationId: "o", conferenceId: "c", entityId: null, taskId: "t" });
};

describe("payment_complete", () => {
  it("is not satisfied by having paid something else", async () => {
    // The original bug: any single paid order cleared the task.
    expect(await run(["paid", "pending"])).toBe(false);
  });

  it("passes when every order is settled", async () => {
    expect(await run(["paid", "paid"])).toBe(true);
  });

  it("counts a partial refund as settled", async () => {
    // The money question is closed; a refund is not a debt.
    expect(await run(["paid", "partially_refunded"])).toBe(true);
  });

  it("never blocks on a cancelled or expired order", async () => {
    // Not a debt — a decision.
    expect(await run(["paid", "canceled", "expired"])).toBe(true);
  });

  it("passes an org that has bought nothing", async () => {
    expect(await run([])).toBe(true);
  });

  it("blocks while anything is awaiting payment", async () => {
    expect(await run(["pending"])).toBe(false);
    expect(await run(["paid", "paid", "requires_payment"])).toBe(false);
  });
});

describe("it must not read paid_at", () => {
  it("reads status instead", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/conference/checklist-checks.ts", "utf8");
    const fn = source.slice(source.indexOf("async payment_complete"), source.indexOf("async legal_document_accepted"));
    expect(fn).not.toContain("paid_at");
    expect(fn).toContain('.select("status")');
  });
});
