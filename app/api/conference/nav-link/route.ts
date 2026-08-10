import { NextResponse } from "next/server";
import { getCurrentConferencePath } from "@/lib/conference/current";

export const dynamic = "force-dynamic";

/**
 * Backs the top nav's "Conference" link — same "next in the date queue"
 * logic as the campusstores.events redirect (soonest upcoming/ongoing,
 * falling back to the most recently completed one), so the two stay
 * consistent rather than drifting into separate definitions of "current."
 */
export async function GET() {
  try {
    const href = await getCurrentConferencePath();
    return NextResponse.json({ href }, { status: 200 });
  } catch {
    return NextResponse.json({ href: null }, { status: 200 });
  }
}
