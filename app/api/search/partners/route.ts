import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json<PartnerSearchResult[]>([]);

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
