import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * A dead mailbox blocks transactional mail too.
 *
 * The regression this locks down: `comms_suppressions` was consulted only by
 * the campaign layer, and only for non-transactional templates. Election,
 * benchmarking and renewal mail all call sendEmail/sendEmailBatch directly and
 * are flagged transactional, so they never checked it at all. The result was a
 * grace reminder re-sent weekly to ctamas@momentecbrand.com, an address that
 * had already hard-bounced three times and was globally suppressed on
 * 2026-08-22.
 *
 * The fix splits WHY an address is suppressed. An unsubscribe is a preference
 * and transactional mail may still ignore it. A hard bounce is not a
 * preference — the mailbox is gone — so it blocks every send path.
 */

const { loadHardBouncedEmailsMock, batchSendMock, emailsSendMock } = vi.hoisted(() => ({
  loadHardBouncedEmailsMock: vi.fn(),
  batchSendMock: vi.fn(),
  emailsSendMock: vi.fn(),
}));

vi.mock("@/lib/comms/suppressions", () => ({
  loadHardBouncedEmails: loadHardBouncedEmailsMock,
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
}));
vi.mock("resend", () => ({
  Resend: class {
    batch = { send: batchSendMock };
    emails = { send: emailsSendMock };
  },
}));
vi.mock("../layout", () => ({ wrapEmailBody: async (html: string) => html }));
vi.mock("@/lib/data", () => ({
  getPlatformIdentity: async () => ({ clientName: "CSC", clientDomain: "campusstores.ca" }),
}));

const DEAD = "ctamas@momentecbrand.com";
const LIVE = "someone@example.com";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DEV_EMAIL_INTERCEPT;
  loadHardBouncedEmailsMock.mockResolvedValue(new Set([DEAD]));
  batchSendMock.mockResolvedValue({ data: { data: [{ id: "m1" }, { id: "m2" }], errors: [] }, error: null });
  emailsSendMock.mockResolvedValue({ data: { id: "single-1" }, error: null });
});

function item(to: string) {
  return { to, subject: "s", html: "<p>h</p>" };
}

describe("hard-bounce suppression in the send primitive", () => {
  it("refuses a single transactional send to a hard-bounced address", async () => {
    const { sendEmail, HARD_BOUNCE_BLOCKED_ERROR } = await import("../send");
    const res = await sendEmail({ to: DEAD, subject: "Grace reminder", html: "<p>x</p>" });

    expect(res.success).toBe(false);
    expect(res.error).toBe(HARD_BOUNCE_BLOCKED_ERROR);
    expect(emailsSendMock).not.toHaveBeenCalled();
  });

  it("still sends to a live address", async () => {
    const { sendEmail } = await import("../send");
    const res = await sendEmail({ to: LIVE, subject: "Grace reminder", html: "<p>x</p>" });

    expect(res.success).toBe(true);
    expect(emailsSendMock).toHaveBeenCalledTimes(1);
  });

  it("keeps batch results positional when an address is skipped", async () => {
    // The trap: dropping the suppressed item would shift every later result,
    // so callers mapping results back by index would attribute the wrong
    // outcome to the wrong person.
    const { sendEmailBatch, HARD_BOUNCE_BLOCKED_ERROR } = await import("../send");
    const results = await sendEmailBatch([item(LIVE), item(DEAD), item("third@example.com")]);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ success: true, messageId: "m1" });
    expect(results[1]).toEqual({ success: false, error: HARD_BOUNCE_BLOCKED_ERROR });
    expect(results[2]).toEqual({ success: true, messageId: "m2" });

    // Only the two live addresses reached Resend.
    const payload = batchSendMock.mock.calls[0][0];
    expect(payload).toHaveLength(2);
    expect(payload.map((p: { to: string }) => p.to)).toEqual([LIVE, "third@example.com"]);
  });

  it("does not call Resend at all when every address is suppressed", async () => {
    const { sendEmailBatch } = await import("../send");
    const results = await sendEmailBatch([item(DEAD)]);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
    expect(batchSendMock).not.toHaveBeenCalled();
  });

  it("fails OPEN — a suppression lookup error must never stop mail", async () => {
    loadHardBouncedEmailsMock.mockRejectedValue(new Error("db down"));
    const { sendEmail } = await import("../send");
    const res = await sendEmail({ to: DEAD, subject: "s", html: "<p>x</p>" });

    expect(res.success).toBe(true);
    expect(emailsSendMock).toHaveBeenCalledTimes(1);
  });

  it("checks the intended recipient, not the dev intercept address", async () => {
    process.env.DEV_EMAIL_INTERCEPT = "dev@example.com";
    const { sendEmail, HARD_BOUNCE_BLOCKED_ERROR } = await import("../send");
    const res = await sendEmail({ to: DEAD, subject: "s", html: "<p>x</p>" });

    expect(res.error).toBe(HARD_BOUNCE_BLOCKED_ERROR);
    expect(loadHardBouncedEmailsMock).toHaveBeenCalledWith([DEAD]);
  });
});
