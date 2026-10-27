import { NextResponse } from "next/server";
import { authenticatePrintStation, claimNextJob } from "@/lib/conference/badges/print-station-server";

export const dynamic = "force-dynamic";

/** Take the oldest queued sticker job, or nothing to do (job: null). */
export async function POST(request: Request) {
  const station = await authenticatePrintStation(request);
  if (!station) return NextResponse.json({ error: "Unknown or revoked print station key." }, { status: 401 });
  try {
    return NextResponse.json({ job: await claimNextJob(station) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read the queue." }, { status: 500 });
  }
}
