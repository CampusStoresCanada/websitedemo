import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeFakeDb } from "@/lib/test/fake-supabase";

/**
 * A first-time sign-in for a known contact gets a login linked to THAT
 * contact. It used to link only when the email lookup found nothing, which it
 * never did here (the lookup is how the contact was found), so the link was
 * never written.
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  attachLoginToContact: vi.fn(),
  resetPasswordForEmail: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/supabase/user-lookup", () => ({ findUserByEmail: vi.fn(async () => null) }));
vi.mock("@/lib/identity/org-login", () => ({ attachLoginToContact: mocks.attachLoginToContact }));
vi.mock("@/lib/ops/audit", () => ({ logAuditEventSafe: vi.fn() }));

import { initiateAccountRecovery } from "../account-recovery";

const CONTACT = {
  id: "contact-emily",
  name: "Emily Lundy",
  organization_id: "org-friday-sock",
  contact_type: ["primary"],
};

beforeEach(() => {
  vi.clearAllMocks();
  const fake = makeFakeDb({ contacts: [{ data: CONTACT }, { data: null }] });
  mocks.createAdminClient.mockReturnValue({
    ...fake.db,
    auth: { resetPasswordForEmail: mocks.resetPasswordForEmail },
  });
});

describe("initiateAccountRecovery", () => {
  it("gives a known contact a member login linked to that contact, then sends the code", async () => {
    mocks.attachLoginToContact.mockResolvedValue({ success: true, userId: "user-emily" });

    const result = await initiateAccountRecovery(" Custom@FridaySocks.com ");

    expect(mocks.attachLoginToContact).toHaveBeenCalledWith({
      orgId: "org-friday-sock",
      email: "custom@fridaysocks.com",
      role: "member",
      contactId: "contact-emily",
      displayName: "Emily Lundy",
      newAccount: "silent",
      ifAlreadyActive: "keep",
    });
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("custom@fridaysocks.com");
    expect(result).toEqual({ outcome: "code_sent" });
  });

  it("stops and says so when the login cannot be set up", async () => {
    mocks.attachLoginToContact.mockResolvedValue({ success: false, error: "boom" });

    const result = await initiateAccountRecovery("custom@fridaysocks.com");

    expect(result).toMatchObject({ outcome: "error" });
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
