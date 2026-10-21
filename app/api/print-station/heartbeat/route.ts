import { NextResponse } from "next/server";
import { authenticatePrintStation, recordHeartbeat } from "@/lib/conference/badges/print-station-server";

export const dynamic = "force-dynamic";

/** The print station checking in, with what the printer last said. */
export async function POST(request: Request) {
  const station = await authenticatePrintStation(request);
  if (!station) return NextResponse.json({ error: "Unknown or revoked print station key." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { printerStatus?: string | null; printerMedia?: string | null };
  const { conferenceName } = await recordHeartbeat(station, {
    status: typeof body.printerStatus === "string" ? body.printerStatus : null,
    media: typeof body.printerMedia === "string" ? body.printerMedia : null,
  });
  return NextResponse.json({ station: station.label, conference: conferenceName });
}
