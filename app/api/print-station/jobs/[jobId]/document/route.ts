import { NextResponse } from "next/server";
import {
  authenticatePrintStation,
  documentPdfForJob,
  DocumentNotPrintable,
  stationMayReadJob,
} from "@/lib/conference/badges/print-station-server";

export const dynamic = "force-dynamic";

/**
 * A claimed document job, as the PDF the station sends to the paper printer.
 *
 * 422 when the file itself can't become a PDF (not shared, not a PDF): the
 * station fails the job rather than retrying forever. Any other failure (the
 * address was down) is worth another try.
 */
export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const station = await authenticatePrintStation(request);
  if (!station) return NextResponse.json({ error: "Unknown or revoked print station key." }, { status: 401 });
  const { jobId } = await context.params;
  if (!(await stationMayReadJob(station, jobId))) {
    return NextResponse.json({ error: "That job is not this station's." }, { status: 404 });
  }
  try {
    const { bytes, title } = await documentPdfForJob(station, jobId);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "cache-control": "no-store",
        // The station logs it; percent-encoded so any title survives a header.
        "x-document-title": encodeURIComponent(title),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The document could not be fetched.";
    return NextResponse.json({ error: message }, { status: error instanceof DocumentNotPrintable ? 422 : 502 });
  }
}
