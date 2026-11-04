// Purolator shipping — the only calls the site makes to Purolator.
//
//   estimateShipment   every service with its price, tax split out
//   bookShipment       validate, then create; one PIN per box
//   fetchLabels        one 4x6 thermal PDF, one page per box
//   voidShipment       cancel; free if it never entered Purolator's network
//   checkBillingAccount  is this institution's account number real
//
// Shapes learned from the sandbox, not only the spec (docs/purolator/openapi):
// street lines are plain strings; references reject "/"; PINs come back as
// JSON numbers; create accepts a label request but returns no label, so
// labels come from /ship/v1/documents.

import "server-only";
import { getPurolatorConfig, PurolatorError, purolatorRequest } from "./client";
import type {
  PurolatorAddress,
  PurolatorBooking,
  PurolatorChargeLine,
  PurolatorPayer,
  PurolatorQuote,
  PurolatorShipment,
} from "./types";

const LINE_OF_BUSINESS = "Courier";
const LABEL_DOCUMENT = "DomesticBillOfLadingThermal";

// ─────────────────────────────────────────────────────────────────
// Purolator's response shapes (only the parts we read)
// ─────────────────────────────────────────────────────────────────

type RawCharge = { amount: number; type: string; description: string };
type RawEstimate = {
  serviceId: string;
  shipmentDate?: string;
  expectedDeliveryDate?: string;
  estimatedTransitDays?: number;
  basePrice: number;
  surcharges?: Array<{ surcharge: RawCharge }>;
  optionPrices?: Array<{ optionPrice: RawCharge }>;
  subTotal: number;
  taxes?: Array<{ tax: RawCharge }>;
  totalPrice: number;
};
type EstimatesResponse = {
  requestReference?: string;
  outboundShipmentEstimates?: Array<{ shipmentEstimate: RawEstimate }>;
};
type CreateResponse = EstimatesResponse & {
  validShipment?: boolean;
  shipmentDetails?: {
    shipmentPIN: { value: number | string };
    packagePINs?: Array<{ PIN: { value: number | string } }>;
  };
};
type DocumentsResponse = {
  shipmentDocuments?: Array<{
    shipmentPIN: string;
    documents?: Array<{ documentType: string; documentStatus: string; data?: string }>;
  }>;
};
type VoidResponse = { shipmentVoided?: string | boolean };

// ─────────────────────────────────────────────────────────────────
// Mapping
// ─────────────────────────────────────────────────────────────────

const cents = (dollars: number) => Math.round(dollars * 100);

const line = (c: RawCharge): PurolatorChargeLine => ({
  type: c.type,
  description: c.description,
  cents: cents(c.amount),
});

export function toQuote(e: RawEstimate): PurolatorQuote {
  return {
    serviceId: e.serviceId,
    shipmentDate: e.shipmentDate ?? null,
    expectedDeliveryDate: e.expectedDeliveryDate ?? null,
    transitDays: e.estimatedTransitDays ?? null,
    baseCents: cents(e.basePrice),
    surcharges: (e.surcharges ?? []).map((s) => line(s.surcharge)),
    options: (e.optionPrices ?? []).map((o) => line(o.optionPrice)),
    subtotalCents: cents(e.subTotal),
    taxes: (e.taxes ?? []).map((t) => line(t.tax)).filter((t) => t.cents !== 0),
    totalCents: cents(e.totalPrice),
  };
}

// The rate call rejects attentionTo and phoneNumber as unknown fields; the ship
// call wants them. Same address, two shapes.
function rateAddress(a: PurolatorAddress) {
  return {
    companyName: a.companyName,
    streetAddress: a.streetAddress,
    city: a.city,
    provinceStateCode: a.provinceStateCode,
    country: "CA",
    postalZipCode: a.postalZipCode.replace(/\s+/g, "").toUpperCase(),
  };
}

function shipAddress(a: PurolatorAddress) {
  return {
    ...rateAddress(a),
    attentionTo: a.attentionTo,
    phoneNumber: a.phoneNumber?.replace(/\D/g, ""),
  };
}

/** Purolator rejects "/" in references; it prints on the label, so keep it readable. */
export function cleanReference(ref: string): string {
  return ref.replace(/\//g, "-").slice(0, 30);
}

// forShipping adds what only the ship call accepts: a description of goods and
// per-box references (the rate call rejects descriptionOfGoods).
function shipmentInformation(s: PurolatorShipment, serviceId: string, forShipping: boolean) {
  return {
    serviceId,
    unitOfMeasurement: "IMPERIAL",
    ...(forShipping ? { descriptionOfGoods: "Conference materials" } : {}),
    totalWeight: Math.ceil(s.boxes.reduce((sum, b) => sum + b.weightLb, 0)),
    totalPackages: s.boxes.length,
    packageInformation: s.boxes.map((b, i) => ({
      packageWeight: Math.ceil(b.weightLb),
      packageLength: Math.ceil(b.lengthIn),
      packageWidth: Math.ceil(b.widthIn),
      packageHeight: Math.ceil(b.heightIn),
      ...(forShipping && s.reference
        ? { packageReference1: cleanReference(`${s.reference} box ${i + 1} of ${s.boxes.length}`) }
        : {}),
    })),
  };
}

function paymentInformation(payer: PurolatorPayer) {
  const { billingAccount } = getPurolatorConfig();
  return payer.kind === "csc"
    ? { registeredAccountNumber: billingAccount, billingAccountNumber: billingAccount, paymentType: "SENDER" }
    : { registeredAccountNumber: billingAccount, billingAccountNumber: payer.accountNumber, paymentType: "THIRDPARTY" };
}

const pin = (v: number | string) => String(v);

// ─────────────────────────────────────────────────────────────────
// Calls
// ─────────────────────────────────────────────────────────────────

/** Every service Purolator offers for this shipment, cheapest first. Priced on CSC's account. */
export async function estimateShipment(s: PurolatorShipment): Promise<PurolatorQuote[]> {
  const { billingAccount } = getPurolatorConfig();
  const res = await purolatorRequest<EstimatesResponse>("POST", "/rate/v1/shipment", {
    lineOfBusiness: LINE_OF_BUSINESS,
    outboundShipment: {
      billingInformation: { billingAccountNumber: billingAccount },
      senderInformation: rateAddress(s.sender),
      receiverInformation: rateAddress(s.receiver),
      shipmentInformation: shipmentInformation(s, "PurolatorGround", false),
    },
  });
  return (res.outboundShipmentEstimates ?? [])
    .map((e) => toQuote(e.shipmentEstimate))
    .sort((a, b) => a.totalCents - b.totalCents);
}

function createBody(s: PurolatorShipment, serviceId: string, payer: PurolatorPayer, validateOnly: boolean) {
  return {
    lineOfBusiness: LINE_OF_BUSINESS,
    validateOnly,
    returnRates: true,
    // Mandatory even though create never returns the label (see fetchLabels).
    shipmentDocuments: { label: { outputType: "PDF", printerFormat: "Thermal", responseType: "BASE64" } },
    outboundShipment: {
      paymentInformation: paymentInformation(payer),
      pickupType: "DROPOFF",
      senderInformation: shipAddress(s.sender),
      receiverInformation: shipAddress(s.receiver),
      shipmentInformation: shipmentInformation(s, serviceId, true),
      ...(s.reference ? { customerReferenceInformation: { shipmentReference1: cleanReference(s.reference) } } : {}),
    },
  };
}

/**
 * Validate first, then create. A validation failure throws before anything
 * exists at Purolator. Never retried: a create that timed out may have booked.
 */
export async function bookShipment(
  s: PurolatorShipment,
  serviceId: string,
  payer: PurolatorPayer
): Promise<PurolatorBooking> {
  if (s.boxes.length === 0) throw new Error("A shipment needs at least one box.");

  await purolatorRequest("POST", "/ship/v1/shipment", createBody(s, serviceId, payer, true));
  const res = await purolatorRequest<CreateResponse>(
    "POST",
    "/ship/v1/shipment",
    createBody(s, serviceId, payer, false)
  );

  const details = res.shipmentDetails;
  if (!details?.shipmentPIN) throw new Error("Purolator accepted the shipment but returned no tracking number.");
  const packagePins = (details.packagePINs ?? []).map((p) => pin(p.PIN.value));
  const estimate = res.outboundShipmentEstimates?.[0]?.shipmentEstimate;

  return {
    shipmentPin: pin(details.shipmentPIN.value),
    packagePins: packagePins.length ? packagePins : [pin(details.shipmentPIN.value)],
    quote: estimate ? toQuote(estimate) : null,
    requestReference: res.requestReference ?? null,
  };
}

/** The 4x6 thermal label PDF for a shipment: one page per box. */
export async function fetchLabels(shipmentPin: string): Promise<Buffer> {
  const res = await purolatorRequest<DocumentsResponse>("POST", "/ship/v1/documents", {
    lineOfBusiness: LINE_OF_BUSINESS,
    documentCriteria: [{ shipmentPIN: shipmentPin, documentType: [LABEL_DOCUMENT] }],
  });
  const doc = res.shipmentDocuments
    ?.find((d) => d.shipmentPIN === shipmentPin)
    ?.documents?.find((d) => d.documentType === LABEL_DOCUMENT);
  if (!doc?.data) {
    throw new Error(`Purolator has no label for ${shipmentPin} yet (${doc?.documentStatus ?? "not found"}).`);
  }
  return Buffer.from(doc.data, "base64");
}

export async function voidShipment(shipmentPin: string): Promise<void> {
  const res = await purolatorRequest<VoidResponse>("PUT", "/ship/v1/shipment", {
    lineOfBusiness: LINE_OF_BUSINESS,
    shipmentPIN: shipmentPin,
  });
  if (String(res.shipmentVoided) !== "true") {
    throw new Error(`Purolator did not void ${shipmentPin}.`);
  }
}

// Purolator's code for an account number it does not know.
const INVALID_ACCOUNT_CODE = "9001-13";

/**
 * Is this a Purolator account our key can bill to? A validate-only booking
 * between two fixed addresses: nothing is created. Asked when an org admin
 * enters the number, so a bad one never reaches the station.
 */
export async function checkBillingAccount(
  accountNumber: string,
  probe: { sender: PurolatorAddress; receiver: PurolatorAddress }
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const digits = accountNumber.replace(/\D/g, "");
  if (!digits || digits.length > 10) return { ok: false, reason: "A Purolator account number is up to 10 digits." };
  try {
    await purolatorRequest(
      "POST",
      "/ship/v1/shipment",
      createBody(
        { ...probe, boxes: [{ weightLb: 1, lengthIn: 10, widthIn: 10, heightIn: 10 }] },
        "PurolatorGround",
        { kind: "institution", accountNumber: digits },
        true
      )
    );
    return { ok: true };
  } catch (e) {
    if (e instanceof PurolatorError && e.codes.includes(INVALID_ACCOUNT_CODE)) {
      return { ok: false, reason: "Purolator doesn't recognise that account number." };
    }
    throw e;
  }
}
