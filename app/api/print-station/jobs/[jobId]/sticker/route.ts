import { NextResponse } from "next/server";
import { authenticatePrintStation, stationMayReadJob } from "@/lib/conference/badges/print-station-server";
import { buildReprintLabelDocument } from "@/lib/conference/badges/label-document";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * One sticker of a claimed job, as the page the station pictures and prints.
 * ⛔ The SAME document the desk's "Print now" opens (buildReprintLabelDocument)
 * — one layout, the one lined up against the card. Its size travels in
 * headers so the station pictures it at exactly that size.
 */
export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const station = await authenticatePrintStation(request);
  if (!station) return NextResponse.json({ error: "Unknown or revoked print station key." }, { status: 401 });
  const { jobId } = await context.params;
  if (!(await stationMayReadJob(station, jobId))) {
    return NextResponse.json({ error: "That job is not this station's." }, { status: 404 });
  }
  const side = new URL(request.url).searchParams.get("side");
  if (side !== "front" && side !== "back") {
    return NextResponse.json({ error: "side must be front or back." }, { status: 400 });
  }
  try {
    const doc = await buildReprintLabelDocument({ db: createAdminClient(), conferenceId: station.conferenceId, jobId, side });
    return new NextResponse(doc.html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-sticker-width-mm": String(doc.widthMm),
        "x-sticker-height-mm": String(doc.heightMm),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The sticker could not be drawn." }, { status: 422 });
  }
}
