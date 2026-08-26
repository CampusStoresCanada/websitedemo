import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * A campaign sends once.
 *
 * The regression: "Send Now" on /admin/comms/[id] ran the send but never
 * revalidated the route, so the page came back unchanged and looked broken.
 * executeCampaignSend had no status check, so the second and third click each
 * re-resolved the audience and sent again — five partners received three
 * copies of the same Ask the Partners email on 2026-08-26.
 *
 * The guard is the conditional UPDATE itself (`.in("status", [...])`): if it
 * claims no row, the campaign has already left draft/scheduled and nothing
 * further may happen — no recipients, no deliveries, no mail.
 */

const { createAdminClientMock, sendEmailBatchMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  sendEmailBatchMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/email/send", () => ({
  sendEmailBatch: sendEmailBatchMock,
  sendEmail: vi.fn(),
}));

/**
 * Stands in for the only two queries a refused send reaches: the campaign
 * load, then the claim. `claimedRows` is what the conditional UPDATE returns —
 * [] when the row no longer matches draft/scheduled.
 */
function mockDb(campaign: Record<string, unknown>, claimedRows: { id: string }[]) {
  return {
    from() {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: campaign, error: null }),
          }),
        }),
        update: () => ({
          eq: () => ({
            in: () => ({
              select: () => Promise.resolve({ data: claimedRows, error: null }),
            }),
          }),
        }),
      };
    },
  };
}

async function executeCampaignSend(campaignId: string) {
  const mod = await import("@/lib/comms/send");
  return mod.executeCampaignSend(campaignId);
}

describe("executeCampaignSend — duplicate send guard", () => {
  beforeEach(() => {
    vi.resetModules();
    createAdminClientMock.mockReset();
    sendEmailBatchMock.mockReset();
  });

  it("refuses a campaign that has already been sent, and sends no mail", async () => {
    createAdminClientMock.mockReturnValue(
      mockDb({ id: "c1", status: "completed", template_id: null }, [])
    );

    const result = await executeCampaignSend("c1");

    expect(result.alreadySent).toBe(true);
    expect(result.sentCount).toBe(0);
    expect(result.recipientCount).toBe(0);
    expect(result.errors[0]).toMatch(/already completed/);
    expect(sendEmailBatchMock).not.toHaveBeenCalled();
  });

  it("refuses a campaign already mid-send, so two concurrent clicks cannot both blast", async () => {
    createAdminClientMock.mockReturnValue(
      mockDb({ id: "c2", status: "sending", template_id: null }, [])
    );

    const result = await executeCampaignSend("c2");

    expect(result.alreadySent).toBe(true);
    expect(sendEmailBatchMock).not.toHaveBeenCalled();
  });
});
