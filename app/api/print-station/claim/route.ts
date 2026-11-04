import { NextResponse } from "next/server";
import { authenticatePrintStation, claimNextJob } from "@/lib/conference/badges/print-station-server";

export const dynamic = "force-dynamic";

/**
 * Take the oldest queued job, or nothing to do (job: null).
 *
 * A station that can print documents and shipping labels says so
 * (`{"accepts": ["stickers", "document", "shipping_label"]}`); one running
 * an older app sends less and is only handed what it named.
 */
export async function POST(request: Request) {
  const station = await authenticatePrintStation(request);
  if (!station) return NextResponse.json({ error: "Unknown or revoked print station key." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { accepts?: unknown };
  const accepts = Array.isArray(body.accepts) ? body.accepts : [];
  const acceptsDocuments = accepts.includes("document");
  const acceptsShippingLabels = accepts.includes("shipping_label");
  try {
    return NextResponse.json({ job: await claimNextJob(station, { acceptsDocuments, acceptsShippingLabels }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read the queue." }, { status: 500 });
  }
}
