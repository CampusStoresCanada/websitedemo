// The shipping desk's rules: what it accepts, what it sends Purolator, and
// that nothing ships unrecorded.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const purolator = vi.hoisted(() => ({
  bookShipment: vi.fn(),
  voidShipment: vi.fn(),
}));
vi.mock("@/lib/purolator/shipping", () => purolator);
vi.mock("@/lib/purolator/client", () => ({
  getPurolatorConfig: () => ({ billingAccount: "9999999999", environment: "sandbox" }),
}));
const alerts = vi.hoisted(() => ({ raiseAlertIfNotOpen: vi.fn() }));
vi.mock("@/lib/ops/alerts", () => alerts);

const db = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; values: unknown }>,
  deletes: [] as string[],
  failPackages: false,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: (values: unknown) => {
        db.inserts.push({ table, values });
        if (table === "conference_shipment_packages") {
          return Promise.resolve({ error: db.failPackages ? { message: "boom" } : null });
        }
        return { select: () => ({ single: () => Promise.resolve({ data: { id: "ship-1" }, error: null }) }) };
      },
      delete: () => ({
        eq: (_c: string, id: string) => {
          db.deletes.push(id);
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

import {
  bookAndRecordShipment,
  boxesProblem,
  destinationProblem,
  makeShipmentReference,
  toPurolatorAddress,
  type ShippingDestination,
} from "../shipping";
import { serviceName } from "@/lib/purolator/services";

const destination: ShippingDestination = {
  company: "University of Calgary",
  attention: "Pat Lee",
  street: "2500 University Dr NW",
  street2: "",
  city: "Calgary",
  province: "ab",
  postalCode: "t2n 1n4",
  phone: "(403) 220-1111",
};
const box = { weightLb: 20, lengthIn: 18, widthIn: 14, heightIn: 12 };

beforeEach(() => {
  db.inserts = [];
  db.deletes = [];
  db.failPackages = false;
  purolator.bookShipment.mockReset();
  purolator.voidShipment.mockReset();
  alerts.raiseAlertIfNotOpen.mockReset();
});

describe("destinationProblem", () => {
  it("accepts a complete Canadian address", () => {
    expect(destinationProblem(destination)).toBeNull();
  });

  it("names the first thing missing, in desk words", () => {
    expect(destinationProblem({ ...destination, street: " " })).toBe("Add the street address.");
    expect(destinationProblem({ ...destination, province: "" })).toBe("Pick the province.");
    expect(destinationProblem({ ...destination, postalCode: "90210" })).toMatch(/postal code/);
    expect(destinationProblem({ ...destination, phone: "220-1111" })).toMatch(/area code/);
  });
});

describe("boxesProblem", () => {
  it("wants at least one weighed, measured box", () => {
    expect(boxesProblem([])).toBe("Add at least one box.");
    expect(boxesProblem([box])).toBeNull();
    expect(boxesProblem([box, { ...box, weightLb: 0 }])).toBe("Weigh the box (box 2).");
    expect(boxesProblem([{ ...box, heightIn: Number.NaN }])).toBe("Add the box size.");
    expect(boxesProblem([{ ...box, weightLb: 151 }])).toMatch(/150 lb/);
  });
});

describe("toPurolatorAddress", () => {
  it("drops an empty second street line and upper-cases the province", () => {
    const a = toPurolatorAddress(destination);
    expect(a.streetAddress).toEqual(["2500 University Dr NW"]);
    expect(a.provinceStateCode).toBe("AB");
    expect(toPurolatorAddress({ ...destination, street2: "Bookstore, MacEwan Hall" }).streetAddress).toHaveLength(2);
  });
});

describe("makeShipmentReference", () => {
  it("is short, readable, and fits Purolator's 30 characters with room for 'box n of n'", () => {
    const ref = makeShipmentReference(2027, Buffer.from([0, 1, 2, 3, 4]));
    expect(ref).toBe("CSC27-23456");
    expect(`${ref} box 12 of 12`.length).toBeLessThanOrEqual(30);
    expect(makeShipmentReference(2027)).toMatch(/^CSC27-[2-9A-HJKMNP-Z]{5}$/);
  });
});

describe("serviceName", () => {
  it("speaks Purolator's ids as a person would", () => {
    expect(serviceName("PurolatorGround")).toBe("Ground");
    expect(serviceName("PurolatorExpress")).toBe("Express");
    expect(serviceName("PurolatorExpress9AM")).toBe("Express 9 AM");
    expect(serviceName("PurolatorExpress1030AM")).toBe("Express 10:30 AM");
    expect(serviceName("PurolatorExpress10:30AM")).toBe("Express 10:30 AM");
    expect(serviceName("PurolatorExpress12PM")).toBe("Express 12 PM");
    expect(serviceName("PurolatorGround9AM")).toBe("Ground 9 AM");
    expect(serviceName("PurolatorExpressEvening")).toBe("Express Evening");
  });
});

describe("bookAndRecordShipment", () => {
  const input = {
    conferenceId: "conf-1",
    conferenceYear: 2027,
    personId: "person-1",
    organizationId: "org-1",
    bookedBy: "user-1",
    origin: { companyName: "CSC", streetAddress: ["5875 Airport Rd"], city: "Mississauga", provinceStateCode: "ON", postalZipCode: "L4V1N1" },
    destination,
    boxes: [box, box],
    serviceId: "PurolatorGround",
    payer: { kind: "csc" as const },
    shownQuote: null,
  };
  const booking = {
    shipmentPin: "460000128336",
    packagePins: ["460000128336", "460000128344"],
    quote: { totalCents: 21989 },
    requestReference: "req-1",
  };

  it("records the shipment and one package per box, each with its own tracking number", async () => {
    purolator.bookShipment.mockResolvedValue(booking);
    const res = await bookAndRecordShipment(input);

    expect(res.shipmentId).toBe("ship-1");
    const sent = purolator.bookShipment.mock.calls[0][0];
    expect(sent.reference).toBe(res.reference);
    const shipment = db.inserts.find((i) => i.table === "conference_shipments")!.values as Record<string, unknown>;
    expect(shipment).toMatchObject({
      billing_mode: "csc_rebill",
      purolator_account: "9999999999",
      purolator_environment: "sandbox",
      status: "booked",
      shipment_pin: "460000128336",
      receiver_postal_code: "T2N1N4",
      receiver_phone: "4032201111",
    });
    const packages = db.inserts.find((i) => i.table === "conference_shipment_packages")!.values as Array<Record<string, unknown>>;
    expect(packages.map((p) => [p.piece_number, p.package_pin])).toEqual([
      [1, "460000128336"],
      [2, "460000128344"],
    ]);
    // The labels wait on the print queue for the roll swap.
    const job = db.inserts.find((i) => i.table === "badge_print_jobs")!.values as Record<string, unknown>;
    expect(job).toMatchObject({ pipeline_type: "shipping_label", status: "queued", transport_method: "printer_bridge" });
    expect(job.metadata).toMatchObject({ shipment_id: "ship-1", boxes: 2 });
  });

  it("marks an institution-account shipment as nothing to invoice", async () => {
    purolator.bookShipment.mockResolvedValue(booking);
    await bookAndRecordShipment({ ...input, payer: { kind: "institution", accountNumber: "1234567" } });
    const shipment = db.inserts.find((i) => i.table === "conference_shipments")!.values as Record<string, unknown>;
    expect(shipment).toMatchObject({ billing_mode: "institution_account", purolator_account: "1234567", status: "no_charge" });
  });

  it("saves nothing when Purolator refuses", async () => {
    purolator.bookShipment.mockRejectedValue(new Error("Billing account number is invalid"));
    await expect(bookAndRecordShipment(input)).rejects.toThrow("Billing account");
    expect(db.inserts).toHaveLength(0);
  });

  it("cancels with Purolator when the booking can't be saved, so nothing ships unrecorded", async () => {
    purolator.bookShipment.mockResolvedValue(booking);
    db.failPackages = true;
    await expect(bookAndRecordShipment(input)).rejects.toThrow("cancelled with Purolator");
    expect(db.deletes).toEqual(["ship-1"]);
    expect(purolator.voidShipment).toHaveBeenCalledWith("460000128336");
    expect(alerts.raiseAlertIfNotOpen).not.toHaveBeenCalled();
  });

  it("raises an alert naming the tracking number if the cancel fails too", async () => {
    purolator.bookShipment.mockResolvedValue(booking);
    purolator.voidShipment.mockRejectedValue(new Error("gateway"));
    db.failPackages = true;
    await expect(bookAndRecordShipment(input)).rejects.toThrow();
    expect(alerts.raiseAlertIfNotOpen.mock.calls[0][0].ruleKey).toBe("shipping_unrecorded:460000128336");
  });
});
