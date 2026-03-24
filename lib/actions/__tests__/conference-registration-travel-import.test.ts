import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireAdminMock,
  requireAuthenticatedMock,
  isGlobalAdminMock,
  createAdminClientMock,
  getEffectivePoliciesMock,
  logAuditEventSafeMock,
} = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  requireAuthenticatedMock: vi.fn(),
  isGlobalAdminMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  getEffectivePoliciesMock: vi.fn(),
  logAuditEventSafeMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({
  requireAdmin: requireAdminMock,
  requireAuthenticated: requireAuthenticatedMock,
  isGlobalAdmin: isGlobalAdminMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));

vi.mock("@/lib/policy/engine", () => ({
  getEffectivePolicies: getEffectivePoliciesMock,
}));

vi.mock("@/lib/ops/audit", () => ({
  logAuditEventSafe: logAuditEventSafeMock,
}));

vi.mock("@/lib/actions/conference-legal", () => ({
  checkLegalAcceptance: vi.fn(async () => ({ success: true, data: { allAccepted: true } })),
}));

vi.mock("@/lib/actions/conference-people", () => ({
  syncConferencePeopleIndex: vi.fn(async () => undefined),
}));

vi.mock("@/lib/constants/conference", () => ({
  REGISTRATION_STATUS_TRANSITIONS: {
    draft: ["submitted", "canceled"],
    submitted: ["canceled"],
    canceled: [],
  },
}));

vi.mock("@/lib/identity/lifecycle", () => ({
  ensurePersonForUser: vi.fn(async () => ({ success: true, data: { personId: "person-1" } })),
  upsertConferenceContact: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/conference/rules-engine", () => ({
  evaluateRulesEngine: vi.fn(() => []),
  normalizeRulesEngine: vi.fn(() => []),
}));

import { runTravelImportCsv } from "../conference-registration";

type RegistrationState = {
  id: string;
  conference_id: string;
  user_id: string | null;
  status?: string;
  updated_at: string;
  travel_mode: string | null;
  arrival_flight_details: string | null;
  departure_flight_details: string | null;
  hotel_name: string | null;
  hotel_confirmation_code: string | null;
  road_origin_address: string | null;
  registration_custom_answers: Record<string, unknown> | null;
};

function buildFakeAdminClient(options?: { duplicateApplied?: boolean }) {
  const registrations: RegistrationState[] = [
    {
      id: "reg-1",
      conference_id: "conf-1",
      user_id: "user-1",
      status: "draft",
      updated_at: "2026-03-20T00:00:00.000Z",
      travel_mode: null,
      arrival_flight_details: null,
      departure_flight_details: null,
      hotel_name: null,
      hotel_confirmation_code: null,
      road_origin_address: null,
      registration_custom_answers: {},
    },
  ];

  const conferencePeople: Array<Record<string, unknown>> = [
    {
      conference_id: "conf-1",
      registration_id: "reg-1",
      travel_mode: null,
      arrival_flight_details: null,
      departure_flight_details: null,
      hotel_name: null,
      hotel_confirmation_code: null,
      updated_at: "2026-03-20T00:00:00.000Z",
    },
  ];

  const client = {
    registrations,
    conferencePeople,
    from: (table: string) => {
      if (table === "audit_log") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  contains: () => ({
                    limit: async () => ({
                      data: options?.duplicateApplied ? [{ id: "dup-1" }] : [],
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }

      if (table === "conference_instances") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "conf-1",
                  start_date: "2026-05-15",
                  end_date: "2026-05-18",
                },
              }),
            }),
          }),
        };
      }

      if (table === "conference_registrations") {
        return {
          select: () => ({
            in: async (_column: string, ids: string[]) => ({
              data: registrations.filter((row) => ids.includes(row.id)),
            }),
            eq: (column: string, value: string) => ({
              in: async (inColumn: string, ids: string[]) => ({
                data: registrations.filter(
                  (row) =>
                    String((row as Record<string, unknown>)[column]) === value &&
                    ids.includes(String((row as Record<string, unknown>)[inColumn] ?? ""))
                ),
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: async (_column: string, id: string) => {
              const idx = registrations.findIndex((row) => row.id === id);
              if (idx >= 0) {
                registrations[idx] = {
                  ...registrations[idx],
                  ...payload,
                } as RegistrationState;
              }
              return { error: null };
            },
          }),
        };
      }

      if (table === "conference_people") {
        return {
          update: (payload: Record<string, unknown>) => ({
            eq: (_column: string, conferenceId: string) => ({
              eq: async (_regColumn: string, registrationId: string) => {
                const idx = conferencePeople.findIndex(
                  (row) =>
                    row.conference_id === conferenceId && row.registration_id === registrationId
                );
                if (idx >= 0) {
                  conferencePeople[idx] = { ...conferencePeople[idx], ...payload };
                }
                return { error: null };
              },
            }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return client;
}

const VALID_CSV = [
  "conference_id,registration_id,user_id,travel_mode,arrival_flight_number,arrival_datetime,arrival_airport,departure_flight_number,departure_datetime,departure_airport,lodging_property,room_number,hotel_confirmation_number,travel_confirmation_reference,admin_note",
  "conf-1,reg-1,,flight,AC123,2026-05-14T10:15,YYZ,AC456,2026-05-18T16:40,YYZ,Conference Hotel,1408,H123456,PNR123,Imported by ops",
].join("\n");

describe("runTravelImportCsv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminMock.mockResolvedValue({
      ok: true,
      ctx: { userId: "admin-1", globalRole: "admin" },
    });
    requireAuthenticatedMock.mockResolvedValue({
      ok: true,
      ctx: { userId: "admin-1", globalRole: "admin" },
    });
    isGlobalAdminMock.mockReturnValue(true);
    getEffectivePoliciesMock.mockResolvedValue({
      "conference.travel_arrival_min_days_before_start": 2,
      "conference.travel_departure_max_days_after_end": 1,
    });
    logAuditEventSafeMock.mockResolvedValue(undefined);
  });

  it("runs dry-run validation and reports successful row outcomes", async () => {
    createAdminClientMock.mockReturnValue(buildFakeAdminClient());

    const result = await runTravelImportCsv({
      conferenceId: "conf-1",
      csvContent: VALID_CSV,
      conflictMode: "fill_empty_only",
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.data?.dryRun).toBe(true);
    expect(result.data?.totals).toEqual({ success: 1, failed: 0, skipped: 0 });
    expect(result.data?.rows[0]?.status).toBe("success");
    expect(logAuditEventSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "conference_travel_import_dry_run" })
    );
  });

  it("applies import updates and writes applied audit event", async () => {
    const fakeClient = buildFakeAdminClient();
    createAdminClientMock.mockReturnValue(fakeClient);

    const result = await runTravelImportCsv({
      conferenceId: "conf-1",
      csvContent: VALID_CSV,
      conflictMode: "fill_empty_only",
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.data?.dryRun).toBe(false);
    expect(result.data?.totals.success).toBe(1);
    expect(fakeClient.registrations[0].travel_mode).toBe("flight");
    expect(fakeClient.registrations[0].hotel_name).toBe("Conference Hotel");
    expect(logAuditEventSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "conference_travel_import_applied" })
    );
  });

  it("returns no-op when duplicate idempotency key was already applied", async () => {
    createAdminClientMock.mockReturnValue(buildFakeAdminClient({ duplicateApplied: true }));

    const result = await runTravelImportCsv({
      conferenceId: "conf-1",
      csvContent: VALID_CSV,
      conflictMode: "overwrite",
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.data?.duplicateSubmission).toBe(true);
    expect(result.data?.rows).toEqual([]);
    expect(logAuditEventSafeMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "conference_travel_import_duplicate_noop" })
    );
  });
});
