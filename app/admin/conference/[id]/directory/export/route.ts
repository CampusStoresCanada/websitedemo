import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { conferenceDirectory } from "@/lib/publication/composition";
import { composeSavedPublication, publicBaseUrl } from "@/lib/publication/render";
import { inDesignFilename } from "@/lib/publication/indesign";
import { buildPublicationPackage } from "@/lib/publication/package";
import { loadPublicationForConference } from "@/lib/publication/store";

/**
 * Never cached. Next currently treats GET route handlers as dynamic by default,
 * but relying on a default here is not worth it: a cached export would hand a
 * designer a stale book — silently, with no error and nothing to notice until
 * it is printed. Verified live (a database edit appeared in the very next
 * export) and now declared so it stays that way.
 */
export const dynamic = "force-dynamic";

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

  const doc = await composeSavedPublication(publication, { withQrCodes: true });

  const generatedAt = new Date().toISOString();
  const { zip, manifest } = await buildPublicationPackage(doc, publicBaseUrl(), generatedAt);
  const filename = inDesignFilename(doc, generatedAt).replace(/\.xml$/, ".zip");

  return new NextResponse(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Surfaced in the response so a caller can see what was left out without
      // unzipping — the same numbers are in README.txt inside.
      "X-Publication-Listings": String(manifest.listings),
      "X-Publication-Qr-Codes": String(manifest.qrCodes),
      "X-Publication-Logos": String(manifest.logos),
      "X-Publication-Skipped": String(manifest.skipped.length),
      // A directory export is a point-in-time artifact; a cached one that
      // silently omits last week's new exhibitor is worse than a slow request.
      "Cache-Control": "no-store",
    },
  });
}
