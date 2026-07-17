import { NextResponse } from "next/server";
import { getActiveConferenceInstance } from "@/lib/actions/conference-availability";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const active = await getActiveConferenceInstance();

    if (!active) {
      return NextResponse.json({ found: false }, { status: 200 });
    }

    return NextResponse.json(
      {
        found: true,
        year: String(active.year),
        edition: active.edition_code,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ found: false }, { status: 200 });
  }
}
