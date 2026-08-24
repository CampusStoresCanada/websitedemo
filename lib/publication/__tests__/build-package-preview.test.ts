/**
 * Builds the real InDesign hand-off package for inspection.
 *
 * Runs the actual loaders, composer and packager against the live database —
 * not fixtures — so what you unzip is what a designer would receive. Skipped
 * unless PACKAGE_PREVIEW_OUT is set, so it never runs in a normal suite.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";

// composition-loader reads contacts through lib/contacts/directory.ts, which is
// marked "server-only". Next aliases that package internally; plain Node does not.
vi.mock("server-only", () => ({}));

function loadEnvLocal() {
  let raw: string;
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    // Overwrite, don't fill blanks: vitest.config.ts stubs the Supabase URL,
    // and filling blanks would silently read an empty database.
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const OUT = process.env.PACKAGE_PREVIEW_OUT;
const CONFERENCE_ID = process.env.PACKAGE_PREVIEW_CONFERENCE_ID;

describe("InDesign package preview", () => {
  it.skipIf(!OUT || !CONFERENCE_ID)("builds the real hand-off zip", async () => {
    loadEnvLocal();
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).not.toContain("example.supabase.co");

    const { composePublication, conferenceDirectory } = await import("../composition");
    const { loadDirectoryEntries, loadPlacementsForPublication, loadSurfacesForPublication } =
      await import("../composition-loader");
    const { attachQrCodes } = await import("../qr");
    const { buildPublicationPackage } = await import("../package");
    const { loadPublicationForConference } = await import("../store");

    const saved = await loadPublicationForConference(CONFERENCE_ID!);
    const publication =
      saved?.publication ?? conferenceDirectory(CONFERENCE_ID!, "Campus Stores Conference 2027 — Directory");

    const surfaces = await loadSurfacesForPublication(CONFERENCE_ID!);
    const [entries, placements] = await Promise.all([
      loadDirectoryEntries(publication.source),
      loadPlacementsForPublication(CONFERENCE_ID!, surfaces),
    ]);
    const withQr = await attachQrCodes(entries, "https://campusstores.ca");
    const doc = composePublication(publication, withQr, surfaces, placements);

    const { zip, manifest } = await buildPublicationPackage(doc, "https://campusstores.ca", "2026-08-24T09:00:00Z");
    writeFileSync(OUT!, zip);

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ...manifest, bytes: zip.length }, null, 2));
    expect(manifest.listings).toBeGreaterThan(0);
    expect(manifest.qrCodes).toBe(manifest.listings);
  }, 120_000);
});
