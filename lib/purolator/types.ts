// Purolator shipping — the shapes the rest of the site sees.
//
// Purolator's own request/response shapes stay inside client.ts and
// shipping.ts. Everything here is ours: money in cents, PINs as strings,
// every surcharge and tax kept as its own line so an invoice can repeat
// Purolator's bill exactly.

export interface PurolatorAddress {
  companyName?: string;
  attentionTo?: string;
  /** Plain strings, one per line. Purolator's schema says objects; it is wrong. */
  streetAddress: string[];
  city: string;
  provinceStateCode: string;
  postalZipCode: string;
  phoneNumber?: string;
}

/** One box. Imperial, because the station's scale and the box presets are. */
export interface PurolatorBox {
  weightLb: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
}

export type PurolatorPayer =
  /** CSC's own account; CSC re-bills the institution later. */
  | { kind: "csc" }
  /** The institution's own Purolator account (paymentType THIRDPARTY). */
  | { kind: "institution"; accountNumber: string };

export interface PurolatorShipment {
  sender: PurolatorAddress;
  receiver: PurolatorAddress;
  boxes: PurolatorBox[];
  /** Printed on the label as "REF:" and carried onto Purolator's invoice. No "/". */
  reference?: string;
}

export interface PurolatorChargeLine {
  type: string;
  description: string;
  cents: number;
}

export interface PurolatorQuote {
  serviceId: string;
  shipmentDate: string | null;
  expectedDeliveryDate: string | null;
  transitDays: number | null;
  baseCents: number;
  surcharges: PurolatorChargeLine[];
  options: PurolatorChargeLine[];
  subtotalCents: number;
  /** Only taxes Purolator actually charged; zero-amount lines are dropped. */
  taxes: PurolatorChargeLine[];
  totalCents: number;
}

export interface PurolatorBooking {
  shipmentPin: string;
  /** One per box, in the order the boxes were given. */
  packagePins: string[];
  quote: PurolatorQuote | null;
  requestReference: string | null;
}
