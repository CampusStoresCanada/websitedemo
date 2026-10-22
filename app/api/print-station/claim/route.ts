import { NextResponse } from "next/server";
import { authenticatePrintStation, claimNextJob } from "@/lib/conference/badges/print-station-server";

export const dynamic = "force-dynamic";

/**
 * Take the oldest queued job, or nothing to do (job: null).
 *
 * A station that can print documents says so (`{"accepts": ["stickers",
 * "document"]}`); one running the older app sends no body and is only ever
 * handed stickers.
 */
export async function POST(request: Request) {
  const station = await authenticatePrintStation(request);
  if (!station) return NextResponse.json({ error: "Unknown or revoked print station key." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { accepts?: unknown };
  const acceptsDocuments = Array.isArray(body.accepts) && body.accepts.includes("document");
  try {
    return NextResponse.json({ job: await claimNextJob(station, { acceptsDocuments }) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read the queue." }, { status: 500 });
  }
}
