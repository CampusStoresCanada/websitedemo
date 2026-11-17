import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { filterSuppressedRecipients } from "@/lib/comms/suppressions";
import type { ResolvedRecipient } from "@/lib/comms/types";

type Result = { data: { email: string }[] | null; error: { message: string } | null };

/** A stand-in client that records each `.in("email", …)` list it is asked for. */
function fakeClient(respond: (emails: string[]) => Result) {
  const asked: string[][] = [];
  const client = {
    from: () => ({
      select: () => ({
        in: (_col: string, emails: string[]) => {
          asked.push(emails);
          return { in: async () => respond(emails) };
        },
      }),
    }),
  };
  return { client: client as never, asked };
}

const people = (n: number): ResolvedRecipient[] =>
  Array.from({ length: n }, (_, i) => ({ userId: null, email: `person${i}@example.ca`, name: null }) as ResolvedRecipient);

describe("filterSuppressedRecipients", () => {
  it("refuses to return a list when the unsubscribe lookup fails", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: "Bad Request" } }));
    await expect(filterSuppressedRecipients(client, people(3), null)).rejects.toThrow(/nothing was sent/);
  });

  it("looks a long list up in chunks, never in one request", async () => {
    const { client, asked } = fakeClient(() => ({ data: [], error: null }));
    const out = await filterSuppressedRecipients(client, people(529), null);
    expect(out).toHaveLength(529);
    expect(asked.length).toBe(6);
    expect(Math.max(...asked.map((a) => a.length))).toBeLessThanOrEqual(100);
  });

  it("drops someone unsubscribed even when they sit in a later chunk", async () => {
    const { client } = fakeClient((emails) => ({
      data: emails.includes("person450@example.ca") ? [{ email: "person450@example.ca" }] : [],
      error: null,
    }));
    const out = await filterSuppressedRecipients(client, people(529), "marketing" as never);
    expect(out).toHaveLength(528);
    expect(out.some((r) => r.email === "person450@example.ca")).toBe(false);
  });
});
