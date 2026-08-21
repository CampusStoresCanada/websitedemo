/**
 * Renders the real conference directory to HTML for review.
 *
 * Runs the actual loaders against the real database and the actual renderer —
 * not fixtures — so what you look at is what the route produces. Skipped unless
 * DIRECTORY_PREVIEW_OUT is set, so it never runs in a normal suite.
 *
 *   set -a; . .env.local; set +a
 *   DIRECTORY_PREVIEW_OUT=/tmp/directory.html npx vitest run \
 *     lib/publication/__tests__/render-directory-preview.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Load .env.local without a shell. Two traps, both of which fail *silently* as
 * an empty database rather than an error — the worst outcome for a preview you
 * are about to trust:
 *   - Sourcing the file in a shell breaks on unquoted values containing spaces.
 *   - vitest.config.ts stubs NEXT_PUBLIC_SUPABASE_URL to example.supabase.co
 *     for the suite, so values here must OVERWRITE, not fill blanks. This
 *     harness is the one place that deliberately talks to the real database.
 */
function loadEnvLocal() {
  let raw: string;
  try { raw = readFileSync(".env.local", "utf8"); } catch { return; }
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const OUT = process.env.DIRECTORY_PREVIEW_OUT;
const CONFERENCE_ID = process.env.DIRECTORY_PREVIEW_CONFERENCE_ID;

describe("directory preview", () => {
  it.skipIf(!OUT || !CONFERENCE_ID)("renders live data through the real renderer", async () => {
    loadEnvLocal();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY, "service role key not loaded").toBeTruthy();
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL, "still on the vitest stub URL")
      .not.toContain("example.supabase.co");

    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: React } = await import("react");
    const { composePublication, conferenceDirectory } = await import("../composition");
    const { loadDirectoryEntries, loadPlacementsForPublication, loadSurfacesForPublication } =
      await import("../composition-loader");
    const { default: PublicationView } = await import("@/components/publication/PublicationView");

    const publication = conferenceDirectory(CONFERENCE_ID!, "Campus Stores Conference 2027 — Directory");
    const surfaces = await loadSurfacesForPublication(CONFERENCE_ID!);
    const [entries, placements] = await Promise.all([
      loadDirectoryEntries(publication.source),
      loadPlacementsForPublication(CONFERENCE_ID!, surfaces),
    ]);
    const doc = composePublication(publication, entries, surfaces, placements);

    // Assert the shape the SQL check predicted, so a silent regression in the
    // loaders shows up here rather than in a printed directory.
    expect(doc.entries.length).toBeGreaterThan(0);
    expect(surfaces.length).toBe(1);
    expect(placements.length).toBe(60);

    const body = renderToStaticMarkup(React.createElement(PublicationView, { doc }));
    writeFileSync(
      OUT!,
      `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${doc.title}</title></head><body style="margin:0;background:#fff">${body}</body></html>`
    );

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      entries: doc.entries.length,
      sections: doc.sections.map((s) => s.type),
      placements: placements.length,
      notes: doc.notes,
    }, null, 2));
  }, 30_000);
});
