// Purolator module against the real sandbox responses saved on 2026-11-03/04.
//
// The fixtures are what Purolator actually sent, not what the spec says it
// sends; the two disagree (street lines, PIN types, where the label comes
// from). These tests lock in the shapes we learned the hard way.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

import { resetPurolatorTokenCache, PurolatorError } from "../client";
import {
  bookShipment,
  checkBillingAccount,
  cleanReference,
  estimateShipment,
  fetchLabels,
  voidShipment,
} from "../shipping";
import type { PurolatorShipment } from "../types";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", `${name}.json`), "utf8")) as {
    status: number;
    response: unknown;
  };

const respond = (name: string) => {
  const f = fixture(name);
  return new Response(JSON.stringify(f.response), { status: f.status });
};

type Call = { url: string; method: string; body: Record<string, unknown> };

function mockPurolator(responses: Response[]) {
  const calls: Call[] = [];
  let tokenCalls = 0;
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/token")) {
        tokenCalls++;
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
      }
      calls.push({ url, method: init?.method ?? "GET", body: JSON.parse(String(init?.body ?? "{}")) });
      return responses[i++].clone();
    })
  );
  return { calls, tokenCalls: () => tokenCalls };
}

const shipment: PurolatorShipment = {
  sender: {
    companyName: "Campus Stores Canada",
    streetAddress: ["5875 Airport Rd"],
    city: "Mississauga",
    provinceStateCode: "ON",
    postalZipCode: "l4v 1n1",
  },
  receiver: {
    companyName: "University of Calgary",
    attentionTo: "Bookstore",
    streetAddress: ["2500 University Dr NW"],
    city: "Calgary",
    provinceStateCode: "AB",
    postalZipCode: "T2N 1N4",
    phoneNumber: "(403) 220-1111",
  },
  boxes: [
    { weightLb: 20, lengthIn: 24, widthIn: 12, heightIn: 12 },
    { weightLb: 29.4, lengthIn: 24, widthIn: 12, heightIn: 12 },
  ],
  reference: "csc-shp/1234",
};

beforeEach(() => {
  resetPurolatorTokenCache();
  vi.stubEnv("PUROLATOR_CLIENT_ID", "id");
  vi.stubEnv("PUROLATOR_CLIENT_SECRET", "secret");
  vi.stubEnv("PUROLATOR_REST_API_KEY", "key");
  vi.stubEnv("PUROLATOR_BILLING_ACCOUNT", "9999999999");
  vi.stubEnv("PUROLATOR_ENV", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("estimateShipment", () => {
  it("returns every service cheapest first, in cents, with only the taxes charged", async () => {
    mockPurolator([respond("estimate-2-box")]);
    const quotes = await estimateShipment(shipment);

    expect(quotes.length).toBeGreaterThan(1);
    expect(quotes.map((q) => q.totalCents)).toEqual([...quotes.map((q) => q.totalCents)].sort((a, b) => a - b));

    const ground = quotes.find((q) => q.serviceId === "PurolatorGround")!;
    expect(ground.baseCents).toBe(13510);
    expect(ground.surcharges).toEqual([{ type: "Fuel", description: "Fuel Surcharge", cents: 7431 }]);
    expect(ground.subtotalCents).toBe(20941);
    expect(ground.taxes).toEqual([{ type: "GST", description: "GST", cents: 1048 }]);
    expect(ground.totalCents).toBe(21989);
  });

  it("sends street lines as plain strings and normalises the postal code", async () => {
    const { calls } = mockPurolator([respond("estimate-2-box")]);
    await estimateShipment(shipment);

    expect(calls[0].url).toBe("https://shipapi-sandbox.purolator.com/rate/v1/shipment");
    const out = calls[0].body.outboundShipment as Record<string, Record<string, unknown>>;
    expect(out.receiverInformation.streetAddress).toEqual(["2500 University Dr NW"]);
    expect(out.receiverInformation.postalZipCode).toBe("T2N1N4");
    expect(out.senderInformation.postalZipCode).toBe("L4V1N1");
    expect(out.shipmentInformation.totalWeight).toBe(50);
  });

  // The live sandbox 400s on each of these as "an unknown field" (2026-11-04).
  it("leaves out the fields only the ship call accepts", async () => {
    const { calls } = mockPurolator([respond("estimate-2-box")]);
    await estimateShipment(shipment);
    const out = calls[0].body.outboundShipment as Record<string, Record<string, unknown>>;
    for (const who of ["senderInformation", "receiverInformation"]) {
      expect(out[who]).not.toHaveProperty("attentionTo");
      expect(out[who]).not.toHaveProperty("phoneNumber");
    }
    expect(out.shipmentInformation).not.toHaveProperty("descriptionOfGoods");
  });

  it("prices on Purolator's test account in the sandbox, and CSC's own in production", async () => {
    vi.stubEnv("PUROLATOR_BILLING_ACCOUNT", "1234567");
    const sandbox = mockPurolator([respond("estimate-2-box")]);
    await estimateShipment(shipment);
    const sandboxBilling = (sandbox.calls[0].body.outboundShipment as Record<string, Record<string, unknown>>)
      .billingInformation;
    expect(sandboxBilling.billingAccountNumber).toBe("9999999999");

    vi.stubEnv("PUROLATOR_ENV", "production");
    resetPurolatorTokenCache();
    const prod = mockPurolator([respond("estimate-2-box")]);
    await estimateShipment(shipment);
    const prodBilling = (prod.calls[0].body.outboundShipment as Record<string, Record<string, unknown>>).billingInformation;
    expect(prodBilling.billingAccountNumber).toBe("1234567");
  });

  it("uses the production host only when PUROLATOR_ENV says so", async () => {
    vi.stubEnv("PUROLATOR_ENV", "production");
    const { calls } = mockPurolator([respond("estimate-2-box")]);
    await estimateShipment(shipment);
    expect(calls[0].url.startsWith("https://shipapi.purolator.com/")).toBe(true);
  });
});

describe("bookShipment", () => {
  it("validates, then creates, and returns one PIN per box as strings", async () => {
    const { calls } = mockPurolator([respond("validate-2-box"), respond("create-2-box")]);
    const booking = await bookShipment(shipment, "PurolatorGround", { kind: "csc" });

    expect(calls.map((c) => c.body.validateOnly)).toEqual([true, false]);
    expect(booking.shipmentPin).toBe("460000128336");
    expect(booking.packagePins).toEqual(["460000128336", "460000128344"]);
    expect(booking.quote?.totalCents).toBe(21989);
    expect(booking.requestReference).toBe("dc1eab40-cc6e-475d-a959-b2d5865410fe");
  });

  it("bills CSC as SENDER, or the institution as THIRDPARTY", async () => {
    const csc = mockPurolator([respond("validate-2-box"), respond("create-2-box")]);
    await bookShipment(shipment, "PurolatorGround", { kind: "csc" });
    const cscPay = (csc.calls[1].body.outboundShipment as Record<string, unknown>).paymentInformation;
    expect(cscPay).toEqual({
      registeredAccountNumber: "9999999999",
      billingAccountNumber: "9999999999",
      paymentType: "SENDER",
    });

    const inst = mockPurolator([respond("validate-2-box"), respond("create-2-box")]);
    await bookShipment(shipment, "PurolatorGround", { kind: "institution", accountNumber: "1234567" });
    const instPay = (inst.calls[1].body.outboundShipment as Record<string, unknown>).paymentInformation;
    expect(instPay).toEqual({
      registeredAccountNumber: "9999999999",
      billingAccountNumber: "1234567",
      paymentType: "THIRDPARTY",
    });
  });

  it("puts our reference on the shipment and each box, with no slashes", async () => {
    const { calls } = mockPurolator([respond("validate-2-box"), respond("create-2-box")]);
    await bookShipment(shipment, "PurolatorGround", { kind: "csc" });
    const out = calls[1].body.outboundShipment as Record<string, Record<string, unknown>>;
    expect(out.customerReferenceInformation.shipmentReference1).toBe("csc-shp-1234");
    const boxes = out.shipmentInformation.packageInformation as Array<Record<string, unknown>>;
    expect(boxes.map((b) => b.packageReference1)).toEqual(["csc-shp-1234 box 1 of 2", "csc-shp-1234 box 2 of 2"]);
    expect(boxes[1].packageWeight).toBe(30);
    expect(out.receiverInformation.phoneNumber).toBe("4032201111");
    expect(out.receiverInformation.attentionTo).toBe("Bookstore");
  });

  it("stops at validation: a rejected shipment is never created", async () => {
    const { calls } = mockPurolator([respond("payer-THIRDPARTY-fake")]);
    const err = await bookShipment(shipment, "PurolatorGround", {
      kind: "institution",
      accountNumber: "9999999",
    }).catch((e) => e);

    expect(err).toBeInstanceOf(PurolatorError);
    expect(err.codes).toEqual(["9001-13"]);
    expect(err.message).toContain("Billing account number");
    expect(err.requestReference).toBe("62dd715d-82cf-43b4-90a6-73baa89066a4");
    expect(calls).toHaveLength(1);
  });

  it("refuses an empty shipment without calling Purolator", async () => {
    const { calls } = mockPurolator([]);
    await expect(bookShipment({ ...shipment, boxes: [] }, "PurolatorGround", { kind: "csc" })).rejects.toThrow(
      "at least one box"
    );
    expect(calls).toHaveLength(0);
  });
});

describe("fetchLabels", () => {
  it("returns the thermal label as a PDF", async () => {
    const { calls } = mockPurolator([respond("documents-thermal")]);
    const pdf = await fetchLabels("460000128336");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(calls[0].body).toEqual({
      lineOfBusiness: "Courier",
      documentCriteria: [{ shipmentPIN: "460000128336", documentType: ["DomesticBillOfLadingThermal"] }],
    });
  });

  it("says so when Purolator has no label for that PIN", async () => {
    mockPurolator([respond("documents-thermal")]);
    await expect(fetchLabels("111")).rejects.toThrow("no label for 111");
  });
});

describe("voidShipment", () => {
  it("accepts Purolator's string 'true'", async () => {
    const { calls } = mockPurolator([respond("void")]);
    await voidShipment("460000128336");
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].body).toEqual({ lineOfBusiness: "Courier", shipmentPIN: "460000128336" });
  });

  it("throws when Purolator does not confirm the void", async () => {
    mockPurolator([new Response(JSON.stringify({ shipmentVoided: "false" }), { status: 200 })]);
    await expect(voidShipment("1")).rejects.toThrow("did not void");
  });
});

describe("checkBillingAccount", () => {
  const probe = { sender: shipment.sender, receiver: shipment.receiver };

  it("accepts an account Purolator validates", async () => {
    const { calls } = mockPurolator([respond("validate-2-box")]);
    expect(await checkBillingAccount("999-999-9998", probe)).toEqual({ ok: true });
    expect(calls[0].body.validateOnly).toBe(true);
    const pay = (calls[0].body.outboundShipment as Record<string, Record<string, unknown>>).paymentInformation;
    expect(pay.billingAccountNumber).toBe("9999999998");
  });

  it("explains an account Purolator doesn't know", async () => {
    mockPurolator([respond("payer-THIRDPARTY-fake")]);
    const res = await checkBillingAccount("9999999", probe);
    expect(res).toEqual({ ok: false, reason: "Purolator doesn't recognise that account number." });
  });

  it("rejects an impossible number without calling Purolator", async () => {
    const { calls } = mockPurolator([]);
    expect((await checkBillingAccount("12345678901", probe)).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("does not swallow other failures", async () => {
    mockPurolator([new Response("gateway", { status: 502 })]);
    await expect(checkBillingAccount("1234567", probe)).rejects.toBeInstanceOf(PurolatorError);
  });
});

describe("token", () => {
  it("signs in once and reuses the token", async () => {
    const m = mockPurolator([respond("estimate-2-box"), respond("estimate-2-box")]);
    await estimateShipment(shipment);
    await estimateShipment(shipment);
    expect(m.tokenCalls()).toBe(1);
  });
});

describe("cleanReference", () => {
  it("replaces slashes and caps length", () => {
    expect(cleanReference("a/b/c")).toBe("a-b-c");
    expect(cleanReference("x".repeat(50))).toHaveLength(30);
  });
});
