// Pickup and tracking against the sandbox responses saved on 2026-11-04.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

import { resetPurolatorTokenCache } from "../client";
import { modifyPickup, schedulePickup, voidPickup, type PickupRequest } from "../pickup";
import { toTrackingSummaries, trackShipments } from "../tracking";

const respond = (name: string) => {
  const f = JSON.parse(readFileSync(join(__dirname, "fixtures", `${name}.json`), "utf8")) as { status: number; response: unknown };
  return new Response(JSON.stringify(f.response), { status: f.status });
};

type Call = { url: string; method: string; body: Record<string, unknown> };
function mockPurolator(responses: Response[]) {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/token")) {
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      calls.push({ url, method: init?.method ?? "GET", body: JSON.parse(String(init?.body ?? "{}")) });
      return responses[i++].clone();
    })
  );
  return calls;
}

const pickup: PickupRequest = {
  date: "2027-02-05",
  anyTimeAfter: "08:00",
  untilTime: "12:00",
  location: "LoadingDock",
  instructions: "Campus Stores Canada conference shipments, hotel loading dock.",
  address: { streetAddress: ["5875 Airport Rd"], city: "Mississauga", provinceStateCode: "ON", postalZipCode: "l4v 1n1" },
  contact: { name: "Tiffany Burt", company: "Hilton Toronto Airport", phone: "1 (647) 469-2099" },
  ground: { pieces: 3, weightLb: 71.5 },
  air: { pieces: 1, weightLb: 20 },
};

beforeEach(() => {
  resetPurolatorTokenCache();
  vi.stubEnv("PUROLATOR_CLIENT_ID", "id");
  vi.stubEnv("PUROLATOR_CLIENT_SECRET", "secret");
  vi.stubEnv("PUROLATOR_REST_API_KEY", "key");
  vi.stubEnv("PUROLATOR_ENV", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("schedulePickup", () => {
  it("books one pickup with the boxes split by how they travel", async () => {
    const calls = mockPurolator([respond("pickup-schedule")]);
    expect(await schedulePickup(pickup)).toBe("21411309");
    expect(calls[0].url).toBe("https://shipapi-sandbox.purolator.com/pickup/v1/schedule");
    expect(calls[0].body).toMatchObject({
      lineOfBusiness: "Courier",
      registeredAccountNumber: "9999999999",
      pickupInstructions: { date: "2027-02-05", anyTimeAfter: "08:00", untilTime: "12:00", pickupLocation: "LoadingDock", totalWeight: 92 },
      pickupAddress: { address: ["5875 Airport Rd"], postalCode: "L4V1N1", country: "CA" },
      // One line: Purolator refuses separate Ground and Air lines (9001-21).
      shipmentSummary: [{ destinationCode: "DOM", totalPieces: 4, totalWeight: 92, modeOfTransport: "Air/Ground" }],
      contactInfo: { name: "Tiffany Burt", phoneNumber: "16474692099" },
    });
  });

  it("refuses an empty pickup without calling Purolator", async () => {
    const calls = mockPurolator([]);
    await expect(schedulePickup({ ...pickup, ground: { pieces: 0, weightLb: 0 }, air: { pieces: 0, weightLb: 0 } })).rejects.toThrow(
      "no boxes"
    );
    expect(calls).toHaveLength(0);
  });
});

describe("pickup errors", () => {
  it("reads Purolator's flat error shape, which pickup uses", async () => {
    mockPurolator([
      new Response(
        JSON.stringify({ errors: [{ code: "9001-21", description: "Shipment summary details cannot contain multiple entries with the same destination code." }] }),
        { status: 400 }
      ),
    ]);
    const err = await schedulePickup(pickup).catch((e) => e);
    expect(err.codes).toEqual(["9001-21"]);
    expect(err.message).toMatch(/same destination code/);
  });

  it("sends ground-only as Ground", async () => {
    const calls = mockPurolator([respond("pickup-schedule")]);
    await schedulePickup({ ...pickup, air: { pieces: 0, weightLb: 0 } });
    expect((calls[0].body.shipmentSummary as Array<Record<string, unknown>>)[0]).toMatchObject({ totalPieces: 3, modeOfTransport: "Ground" });
  });
});

describe("modifyPickup", () => {
  it("returns Purolator's NEW confirmation number", async () => {
    const calls = mockPurolator([respond("pickup-modify")]);
    expect(await modifyPickup("21411309", pickup)).toBe("21411307");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].body.pickupConfirmationNumber).toBe("21411309");
  });
});

describe("voidPickup", () => {
  it("accepts Purolator's confirmation", async () => {
    const calls = mockPurolator([respond("pickup-void")]);
    await voidPickup("21411307");
    expect(calls[0].body).toEqual({ lineOfBusiness: "Courier", pickupConfirmationNumber: "21411307" });
  });

  it("throws when Purolator does not confirm", async () => {
    mockPurolator([new Response(JSON.stringify({ pickupVoided: false }), { status: 200 })]);
    await expect(voidPickup("1")).rejects.toThrow("did not cancel");
  });
});

describe("tracking", () => {
  it("reads the status and newest event; not delivered without a delivery time", async () => {
    const calls = mockPurolator([respond("track-new")]);
    const [t] = await trackShipments(["460000139606"]);
    expect(calls[0].body).toEqual({ language: "en", search: [{ trackingId: "460000139606" }] });
    expect(t).toEqual({
      shipmentPin: "460000139606",
      code: "OFD",
      status: "Out for Delivery",
      lastEvent: "On vehicle for delivery, MISSISSAUGA ON",
      deliveredAt: null,
      deliveredTo: null,
    });
  });

  it("is delivered only when every box has a delivery time", () => {
    const pkg = (when?: string) => ({ details: { deliveryDetails: when ? { deliveryDateTime: when, name: "J SMITH" } : {} } });
    const partial = toTrackingSummaries({ shipment: [{ shipmentPin: "1", package: [pkg("2027-02-08T10:00:00-07:00"), pkg()] }] });
    expect(partial[0].deliveredAt).toBeNull();
    const all = toTrackingSummaries({
      shipment: [{ shipmentPin: "1", package: [pkg("2027-02-08T10:00:00-07:00"), pkg("2027-02-08T11:30:00-07:00")] }],
    });
    expect(all[0]).toMatchObject({ deliveredAt: "2027-02-08T11:30:00-07:00", deliveredTo: "J SMITH" });
  });

  it("asks in batches of 25", async () => {
    const calls = mockPurolator([respond("track-new"), respond("track-new")]);
    await trackShipments(Array.from({ length: 30 }, (_, i) => String(i)));
    expect(calls.map((c) => (c.body.search as unknown[]).length)).toEqual([25, 5]);
  });
});
