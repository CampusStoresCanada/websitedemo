// Transport-level retry behaviour for the QuickBooks client.
//
// The case these exist for: on 2026-09-01 a single Intuit 504 on a customer
// lookup permanently killed a $5,198 sales receipt, because qbRequest was a
// bare fetch with no retry and the owning queue spent its whole budget in 45
// minutes. These lock in the two rules that fix it — retry what a retry can
// fix, refuse to spend attempts on what it cannot.
//
// Driven through findQBDocumentByDocNumber because it is the thinnest exported
// caller of qbRequest: one GET, no other moving parts.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const chainable = () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "select", "eq", "upsert"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single = vi.fn(async () => ({ data: { value: "stored-refresh-token" } }));
  return chain;
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => chainable(),
}));

vi.mock("@/lib/ops/alerts", () => ({
  raiseAlertIfNotOpen: vi.fn(async () => undefined),
}));

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

/** Queue up responses for the QBO API call; the token refresh always succeeds. */
function mockFetchSequence(responses: Array<Response | Error>) {
  const apiCalls: string[] = [];
  let index = 0;

  const impl = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === TOKEN_URL) {
      return new Response(
        JSON.stringify({ access_token: "test-access-token", expires_in: 3600 }),
        { status: 200 }
      );
    }

    apiCalls.push(url);
    const next = responses[Math.min(index, responses.length - 1)];
    index++;
    if (next instanceof Error) throw next;
    return next.clone();
  });

  vi.stubGlobal("fetch", impl);
  return { apiCalls };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number) => new Response("upstream said no", { status });

describe("qbRequest retry policy", () => {
  beforeEach(() => {
    vi.stubEnv("QUICKBOOKS_CLIENT_ID", "id");
    vi.stubEnv("QUICKBOOKS_CLIENT_SECRET", "secret");
    vi.stubEnv("QUICKBOOKS_REALM_ID", "realm-1");
    vi.stubEnv("QUICKBOOKS_ENVIRONMENT", "production");
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("retries a 504 and succeeds — the exact failure that killed the receipt", async () => {
    const { apiCalls } = mockFetchSequence([
      fail(504),
      ok({ QueryResponse: { SalesReceipt: [{ Id: "1162" }] } }),
    ]);
    const { findQBDocumentByDocNumber } = await import("../client");

    const found = await findQBDocumentByDocNumber("SalesReceipt", "47fa5355-2a37-4261-8d");

    expect(found).toEqual({ Id: "1162" });
    expect(apiCalls).toHaveLength(2);
  });

  it("retries a network fault, which never says anything about the request", async () => {
    const { apiCalls } = mockFetchSequence([
      new Error("ECONNRESET"),
      ok({ QueryResponse: { SalesReceipt: [{ Id: "7" }] } }),
    ]);
    const { findQBDocumentByDocNumber } = await import("../client");

    await expect(findQBDocumentByDocNumber("SalesReceipt", "doc")).resolves.toEqual({ Id: "7" });
    expect(apiCalls).toHaveLength(2);
  });

  it("gives up after three attempts and reports the failure as retryable", async () => {
    const { apiCalls } = mockFetchSequence([fail(503)]);
    const { findQBDocumentByDocNumber, QBApiError } = await import("../client");

    const err = await findQBDocumentByDocNumber("Invoice", "doc").catch((e) => e);

    expect(err).toBeInstanceOf(QBApiError);
    expect(err.status).toBe(503);
    expect(err.retryable).toBe(true);
    expect(err.attempts).toBe(3);
    expect(apiCalls).toHaveLength(3);
  });

  it("does NOT retry a 400 — our bug, and it will fail identically forever", async () => {
    const { apiCalls } = mockFetchSequence([fail(400)]);
    const { findQBDocumentByDocNumber, QBApiError } = await import("../client");

    const err = await findQBDocumentByDocNumber("Invoice", "doc").catch((e) => e);

    expect(err).toBeInstanceOf(QBApiError);
    expect(err.retryable).toBe(false);
    expect(err.attempts).toBe(1);
    expect(apiCalls).toHaveLength(1);
  });

  it("does NOT retry a 401 — spending attempts on bad credentials only delays the fix", async () => {
    const { apiCalls } = mockFetchSequence([fail(401)]);
    const { findQBDocumentByDocNumber } = await import("../client");

    await expect(findQBDocumentByDocNumber("Invoice", "doc")).rejects.toThrow();
    expect(apiCalls).toHaveLength(1);
  });

  it("returns null when QuickBooks holds no such document", async () => {
    mockFetchSequence([ok({ QueryResponse: {} })]);
    const { findQBDocumentByDocNumber } = await import("../client");

    await expect(findQBDocumentByDocNumber("SalesReceipt", "nothing-here")).resolves.toBeNull();
  });
});
