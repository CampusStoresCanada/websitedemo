import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { composePublication, conferenceDirectory } from "@/lib/publication/composition";
import {
  loadDirectoryEntries,
  loadPlacementsForPublication,
  loadSurfacesForPublication,
} from "@/lib/publication/composition-loader";
import { attachQrCodes } from "@/lib/publication/qr";
import { inDesignFilename, toInDesignXml } from "@/lib/publication/indesign";
import { loadPublicationForConference } from "@/lib/publication/store";

/**
 * Downloads the directory as InDesign-importable XML.
 *
 * Same composition the browser renderer uses — the online directory and the
 * printed book are the same content through two outputs, which is what stops
 * them drifting. The browser handles online and stays the always-works
 * fallback; InDesign does the typesetting for print.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 403 });
  }

  const { id } = await params;
  const db = createAdminClient();
  const { data: conference } = await db
    .from("conference_instances")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (!conference) {
    return NextResponse.json({ error: "Conference not found." }, { status: 404 });
  }

  const saved = await loadPublicationForConference(conference.id);
  const publication =
    saved?.publication ?? conferenceDirectory(conference.id, `${conference.name} — Directory`);

  const surfaces = await loadSurfacesForPublication(conference.id);
  const [entries, placements] = await Promise.all([
    loadDirectoryEntries(publication.source),
    loadPlacementsForPublication(conference.id, surfaces),
  ]);
  // QR codes are referenced by filename in the XML, not embedded — but the
  // codes have to exist on the entries for those references to be emitted.
  const withQr = await attachQrCodes(entries, process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca");
  const doc = composePublication(publication, withQr, surfaces, placements);

  const xml = toInDesignXml(doc);
  const filename = inDesignFilename(doc, new Date().toISOString());

  return new NextResponse(xml, {
    headers: {
      // text/xml rather than application/xml: InDesign's Import XML dialog
      // filters on it, and browsers hand it straight to the download.
      "Content-Type": "text/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A directory export is a point-in-time artifact; a cached one that
      // silently omits last week's new exhibitor is worse than a slow request.
      "Cache-Control": "no-store",
    },
  });
}
