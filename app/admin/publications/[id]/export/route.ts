import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import { inDesignFilename } from "@/lib/publication/indesign";
import { buildPublicationPackage } from "@/lib/publication/package";
import { composeSavedPublication, publicBaseUrl } from "@/lib/publication/render";
import { loadPublication } from "@/lib/publication/store";

/**
 * Never cached. A cached export hands a designer a stale book — silently, with
 * nothing to notice until it is printed.
 */
export const dynamic = "force-dynamic";

/** The publication as an InDesign hand-off: tagged XML, QR codes and logos. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 403 });
  }

  const { id } = await params;
  const saved = await loadPublication(id);
  if (!saved) return NextResponse.json({ error: "Publication not found." }, { status: 404 });

  const doc = await composeSavedPublication(saved.publication, { withQrCodes: true });
  const generatedAt = new Date().toISOString();
  const { zip, manifest } = await buildPublicationPackage(doc, publicBaseUrl(), generatedAt);
  const filename = inDesignFilename(doc, generatedAt).replace(/\.xml$/, ".zip");

  return new NextResponse(zip as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Visible without unzipping; the same numbers are in README.txt inside.
      "X-Publication-Listings": String(manifest.listings),
      "X-Publication-Qr-Codes": String(manifest.qrCodes),
      "X-Publication-Logos": String(manifest.logos),
      "X-Publication-Skipped": String(manifest.skipped.length),
      "Cache-Control": "no-store",
    },
  });
}
