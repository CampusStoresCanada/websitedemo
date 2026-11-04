import { NextResponse } from "next/server";
import {
  authenticatePrintStation,
  DocumentNotPrintable,
  shippingLabelPdfForJob,
  stationMayReadJob,
} from "@/lib/conference/badges/print-station-server";

export const dynamic = "force-dynamic";

/**
 * A claimed shipping-label job, as Purolator's PDF: one 4x6 page per box, for
 * the QL's die-cut 103 x 164 mm roll.
 *
 * 422 when there is nothing to print (the shipment was cancelled): the station
 * fails the job. Any other failure (Purolator was down) is worth another try.
 */
export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const station = await authenticatePrintStation(request);
  if (!station) return NextResponse.json({ error: "Unknown or revoked print station key." }, { status: 401 });
  const { jobId } = await context.params;
  if (!(await stationMayReadJob(station, jobId))) {
    return NextResponse.json({ error: "That job is not this station's." }, { status: 404 });
  }
  try {
    const pdf = await shippingLabelPdfForJob(station, jobId);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: { "content-type": "application/pdf", "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The labels could not be fetched.";
    return NextResponse.json({ error: message }, { status: error instanceof DocumentNotPrintable ? 422 : 502 });
  }
}
