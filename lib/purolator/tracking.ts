// Purolator tracking: where each shipment is, by its tracking number.
//
// ⚠️ The sandbox answers every search with the same canned 2024 shipment
// ("Out for Delivery", Purolator Express), whatever PIN you send (seen
// 2026-11-04). The shape is real; the contents prove nothing until production.

import "server-only";
import { purolatorRequest } from "./client";

export interface TrackingSummary {
  shipmentPin: string;
  /** Purolator's code, e.g. "OFD". */
  code: string | null;
  /** Purolator's words, e.g. "Out for Delivery". */
  status: string | null;
  /** The newest event on any box, e.g. "On vehicle for delivery, MISSISSAUGA ON". */
  lastEvent: string | null;
  /** Set only when EVERY box has a delivery time: the latest of them. */
  deliveredAt: string | null;
  /** Who signed, when Purolator says. */
  deliveredTo: string | null;
}

type RawEvent = { dateTime?: string; description?: string; location?: { city?: string; provinceState?: string } };
type RawPackage = {
  pin?: string;
  lastEvent?: RawEvent;
  details?: { deliveryDetails?: { deliveryDateTime?: string; name?: string } };
};
type TrackResponse = {
  shipment?: Array<{
    shipmentPin?: string;
    status?: { code?: string; description?: string };
    package?: RawPackage[];
  }>;
};

const describeEvent = (e: RawEvent | undefined) =>
  e?.description
    ? [e.description, [e.location?.city, e.location?.provinceState].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : null;

export function toTrackingSummaries(res: TrackResponse): TrackingSummary[] {
  return (res.shipment ?? []).map((s) => {
    const packages = s.package ?? [];
    const newest = packages
      .map((p) => p.lastEvent)
      .filter((e): e is RawEvent => Boolean(e?.dateTime))
      .sort((a, b) => String(b.dateTime).localeCompare(String(a.dateTime)))[0];
    const deliveries = packages.map((p) => p.details?.deliveryDetails);
    const allDelivered = packages.length > 0 && deliveries.every((d) => d?.deliveryDateTime);
    return {
      shipmentPin: String(s.shipmentPin ?? ""),
      code: s.status?.code ?? null,
      status: s.status?.description ?? null,
      lastEvent: describeEvent(newest),
      deliveredAt: allDelivered
        ? deliveries.map((d) => d!.deliveryDateTime!).sort().at(-1)!
        : null,
      deliveredTo: allDelivered ? deliveries.find((d) => d?.name)?.name ?? null : null,
    };
  });
}

/**
 * By shipment tracking number. Asked in batches of 25: the spec states no
 * limit, and a conference is a few dozen shipments, so small batches cost
 * nothing.
 */
export async function trackShipments(pins: string[]): Promise<TrackingSummary[]> {
  const out: TrackingSummary[] = [];
  for (let i = 0; i < pins.length; i += 25) {
    const res = await purolatorRequest<TrackResponse>("POST", "/track/v1/shipment", {
      language: "en",
      search: pins.slice(i, i + 25).map((trackingId) => ({ trackingId })),
    });
    out.push(...toTrackingSummaries(res));
  }
  return out;
}
