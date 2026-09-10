import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAct } from "@/lib/signals/inbox";
import { isBot } from "@/lib/publication/scan-tracking";

export const dynamic = "force-dynamic";

const VOYAGE_API = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3";

export interface PartnerSearchResult {
  id: string;
  score: number;
}

/**
 * GET /api/search/partners?q=hoodie&limit=20
 *
 * Hybrid search: Voyage AI vector similarity + weighted full-text (BM25-style),
 * combined via Reciprocal Rank Fusion. Taxonomy fields (NACS dept/classes) are
 * weighted highest; AI-generated summary is lowest. Falls back to text-only if
 * Voyage is unavailable.
 */
/**
 * A search is the highest-intent thing anyone does here, and until now this
 * route received every one of them and threw them away.
 *
 * ⚠️ Fire-and-forget, and deliberately not awaited into the response. Recording
 * must never change what the searcher sees — not the timing, not the body, not
 * the status. That difference would itself be a disclosure: a caller could probe
 * whether a given query had been seen before by watching for it.
 *
 * ⚠️ MapExplore debounces 400ms after typing STOPS, so a hesitation mid-word
 * emits "hood" as well as "hoodie". Two guards: queries under three characters
 * are ignored, and the dedupe key collapses the same query from the same person
 * within the same hour — stable forever, because inbox rows are deleted on drain
 * and a window-relative key would let the same act back in afterwards.
 *
 * Prefixes that survive both simply resolve to nothing and land in
 * `unresolvedDemand()`, which is the honest place for them.
 *
 * ⛔ Third guard: bots. `recordAct` does NO filtering of its own — unlike
 * `recordDirectoryScan`, which has `isBot()` built in — so every public caller
 * has to do it, or crawler traffic lands in the signal spine and scoring reads
 * it as demand. A search is the highest-intent act we observe, which makes it
 * the worst one to let a scraper forge. The only real caller is MapExplore
 * fetching from a browser, so a legitimate search always carries a user agent;
 * `isBot` treats a missing one as a script, which is correct here.
 */
function recordSearch(rawQuery: string, userAgent: string | null): void {
  if (rawQuery.length < 3) return;
  if (isBot(userAgent)) return;
  const normalized = rawQuery.toLowerCase().replace(/\s+/g, " ").trim();
  const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  void recordAct({
    source: "website",
    verb: "searched",
    objectType: "query",
    rawText: rawQuery,
    dedupeKey: `search:partners:${hour}:${normalized}`,
  }).catch(() => {
    // recordAct already swallows its own failures; this is belt-and-braces so an
    // unhandled rejection can never surface in a route that must not fail.
  });
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json<PartnerSearchResult[]>([]);

  recordSearch(q, request.headers.get("user-agent"));

  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") ?? "20"), 50);

  const supabase = createAdminClient();

  // 1. Embed the query with Voyage (best effort — text search still runs if this fails)
  let queryEmbedding: number[] | null = null;
  const apiKey = process.env.VOYAGE_API_KEY;
  if (apiKey) {
    try {
      const res = await fetch(VOYAGE_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ input: [q], model: VOYAGE_MODEL }),
      });
      if (res.ok) {
        const json = await res.json();
        queryEmbedding = json.data[0].embedding;
      }
    } catch {
      // fall through to text-only
    }
  }

  if (!queryEmbedding) {
    return NextResponse.json({ error: "Semantic search not configured" }, { status: 503 });
  }

  // 2. Hybrid search: vector (Voyage) + weighted full-text (taxonomy > human fields > AI summary)
  //    Combined via Reciprocal Rank Fusion in the DB function.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("search_partner_embeddings", {
    query_embedding: queryEmbedding,
    query_text: q,
    match_count: limit,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json<PartnerSearchResult[]>((data as PartnerSearchResult[]) ?? []);
}
