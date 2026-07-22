import { NextResponse } from "next/server";
import { getActiveConferenceInstance } from "@/lib/actions/conference-availability";
import { getViewerContext } from "@/lib/visibility/viewer";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const viewer = await getViewerContext();
    const viewerIsAdmin = viewer.viewerLevel === "admin" || viewer.viewerLevel === "super_admin";
    const active = await getActiveConferenceInstance(viewerIsAdmin);

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
