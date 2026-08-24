/**
 * The InDesign hand-off as a single zip.
 *
 * XML alone gives a designer 33 broken image links. The point of packaging is
 * that the folder is self-contained: nothing depends on a Supabase URL still
 * resolving at press time, or on someone being online while they lay out.
 *
 * Layout inside the zip:
 *   directory.xml     — the tagged content
 *   qr/<code>.svg     — one QR per listing, vector, referenced by the XML
 *   logos/<code>.<ext>— fetched org logos, referenced by the XML
 *   README.txt        — how to map tags to styles, and what was skipped
 */

import JSZip from "jszip";
import type { ComposedPublication } from "./composition";
import { toInDesignXml } from "./indesign";
import { exhibitorCodeUrl, qrSvg } from "./qr";

export type PackageManifest = {
  listings: number;
  qrCodes: number;
  logos: number;
  /** Things a designer needs to know are missing before they start. */
  skipped: string[];
};

/** Extension from a URL, defaulting to png — InDesign places by extension. */
function extensionFor(url: string): string {
  const clean = url.split("?")[0];
  const match = /\.([a-z0-9]{2,4})$/i.exec(clean);
  const ext = match?.[1]?.toLowerCase();
  return ext && ["png", "jpg", "jpeg", "webp", "svg", "gif", "tif", "tiff"].includes(ext) ? ext : "png";
}

/**
 * Fetch one logo. Returns null rather than throwing: one dead URL out of a
 * hundred must not cost the whole package, and the manifest records it so the
 * gap is visible rather than mysterious.
 */
async function fetchLogo(url: string, signalMs = 10_000): Promise<{ data: ArrayBuffer; ext: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(signalMs) });
    if (!res.ok) return null;
    return { data: await res.arrayBuffer(), ext: extensionFor(url) };
  } catch {
    return null;
  }
}

function readme(doc: ComposedPublication, manifest: PackageManifest, generatedAt: string): string {
  return [
    doc.title,
    "=".repeat(doc.title.length),
    "",
    `Generated ${generatedAt}`,
    `${manifest.listings} listings · ${manifest.qrCodes} QR codes · ${manifest.logos} logos`,
    "",
    "CONTENTS",
    "  directory.xml   Tagged content for File > Import XML",
    "  qr/             One SVG per listing, named by its permanent code",
    "  logos/          Organisation logos, named by the same code",
    "",
    "IMPORTING",
    "  1. File > Import XML, tick 'Show XML Import Options', then 'Merge Content'.",
    "  2. Window > Utilities > Tags, then 'Map Tags to Styles'.",
    "     Every tag is named after the paragraph style it should become —",
    "     OrgName, BoothNumber, Description, CategoryHeading — so if your styles",
    "     use those names, the mapping is one click and holds for future imports.",
    "",
    "RE-IMPORTING",
    "  Export again and re-import to pick up content changes. The output is",
    "  deterministic: same content, same file, so a diff shows only what moved.",
    "",
    "IMAGES",
    "  Referenced by relative path, so keep this folder together. QR codes are",
    "  vector — scale freely, but not below about 19mm or phones struggle to",
    "  read them at arm's length.",
    "",
    manifest.skipped.length > 0
      ? ["NOT INCLUDED", ...manifest.skipped.map((s) => `  ${s}`)].join("\n")
      : "Nothing was skipped.",
    "",
  ].join("\n");
}

/**
 * Build the complete hand-off. `baseUrl` is what the QR codes point at, so it
 * must be the public site — a localhost URL printed into 700 books is
 * unrecoverable.
 */
export async function buildPublicationPackage(
  doc: ComposedPublication,
  baseUrl: string,
  generatedAt: string
): Promise<{ zip: Uint8Array; manifest: PackageManifest }> {
  const zip = new JSZip();
  const manifest: PackageManifest = { listings: doc.entries.length, qrCodes: 0, logos: 0, skipped: [] };

  zip.file("directory.xml", toInDesignXml(doc));

  const qrFolder = zip.folder("qr");
  const logoFolder = zip.folder("logos");

  // Logos are fetched in parallel; QR generation is local and cheap.
  const logoResults = await Promise.all(
    doc.entries.map(async (entry) => ({
      entry,
      logo: entry.logoUrl ? await fetchLogo(entry.logoUrl) : null,
    }))
  );

  for (const { entry, logo } of logoResults) {
    if (!entry.publicCode) {
      manifest.skipped.push(`${entry.orgName}: no public code, so no QR code`);
    } else {
      qrFolder?.file(`${entry.publicCode}.svg`, await qrSvg(exhibitorCodeUrl(baseUrl, entry.publicCode)));
      manifest.qrCodes += 1;
    }

    if (!entry.logoUrl) {
      manifest.skipped.push(`${entry.orgName}: no logo on file`);
    } else if (!logo) {
      manifest.skipped.push(`${entry.orgName}: logo could not be downloaded`);
    } else if (entry.publicCode) {
      logoFolder?.file(`${entry.publicCode}.${logo.ext}`, logo.data);
      manifest.logos += 1;
    }
  }

  zip.file("README.txt", readme(doc, manifest, generatedAt));

  // Fixed timestamps so re-exporting unchanged content produces an identical
  // archive, rather than a diff made entirely of modification times. JSZip
  // takes the date per entry, not on generateAsync.
  //
  // Directory entries count: skipping them left `qr/` and `logos/` carrying
  // wall-clock time, so two runs of identical content produced files of the
  // same size but different bytes — and the README shipped inside promised
  // determinism that did not hold.
  const fixedDate = new Date("2000-01-01T00:00:00Z");
  zip.forEach((_path, file) => {
    file.date = fixedDate;
  });

  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

  return { zip: bytes, manifest };
}
