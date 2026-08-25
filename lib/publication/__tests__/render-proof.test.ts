/**
 * Renders a saved publication to standalone HTML for print proofing.
 *
 * Not a test — a proofing tool that lives here because vitest already resolves
 * the `@/` aliases and stubs `server-only`, which plain node does not. Skipped
 * unless RENDER_PROOF is set, so it never runs in a normal suite.
 *
 *   RENDER_PROOF=<publication-id> npx vitest run lib/publication/__tests__/render-proof
 */
import { describe, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";

vi.mock("server-only", () => ({}));

function loadEnvLocal() {
  let raw: string;
  try { raw = readFileSync(".env.local", "utf8"); } catch { return; }
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    // Overwrite: vitest.config.ts stubs the Supabase URL, and filling blanks
    // would silently read an empty database instead of erroring.
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const ID = process.env.RENDER_PROOF;
const OUT = process.env.RENDER_PROOF_OUT ?? "publication-proof.html";

describe("print proof", () => {
  it.skipIf(!ID)("renders the publication to standalone HTML", async () => {
    loadEnvLocal();
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { loadPublication } = await import("../store");
    const { composeSavedPublication } = await import("../render");
    const { default: PublicationView } = await import("@/components/publication/PublicationView");

    const saved = await loadPublication(ID!);
    if (!saved) throw new Error(`No publication ${ID}`);
    // withQrCodes attaches before composing. Decorating doc.entries afterwards
    // would do nothing: each section holds its own entry objects.
    const doc = await composeSavedPublication(saved.publication, { withQrCodes: true });

    const body = renderToStaticMarkup(PublicationView({ doc }) as React.ReactElement);
    writeFileSync(OUT, `<!doctype html><html><head><meta charset="utf-8">` +
      `<title>${doc.title}</title></head><body>${body}</body></html>`);

    // eslint-disable-next-line no-console
    console.log(`PROOF ${OUT} · ${doc.entries.length} orgs · ${doc.sections.length} sections`);
  }, 120_000);
});
