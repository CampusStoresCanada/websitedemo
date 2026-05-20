/**
 * embed-partner
 *
 * Enriches a Vendor Partner org in three steps:
 *   1. Fetch & summarize their website with Claude Haiku
 *      (skipped if website_summary is already cached and URL hasn't changed)
 *   2. Classify into the NACS taxonomy (department + classes) — same Haiku call
 *   3. Build a rich embed text from all available signals → Voyage AI embedding
 *
 * Modes:
 *   { org_id: string }           — single org
 *   { batch: true, delay_ms? }  — all Vendor Partner orgs with stale embeddings
 *
 * Secrets required (Supabase dashboard → Edge Functions → Secrets):
 *   ANTHROPIC_API_KEY
 *   VOYAGE_API_KEY
 *   SUPABASE_URL              (auto-injected)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// API endpoints
// ---------------------------------------------------------------------------

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const VOYAGE_API    = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL  = "voyage-3";
const HAIKU_MODEL   = "claude-haiku-4-5-20251001";

// ---------------------------------------------------------------------------
// NACS taxonomy — passed to Haiku so it can classify accurately
// ---------------------------------------------------------------------------

const NACS_TAXONOMY: Record<string, string[]> = {
  "Apparel":                   ["Men's/Unisex", "Women's", "Youth", "Infant/Toddler", "Accessories"],
  "Accessories & Furnishings": ["Headwear", "Bags", "Jewelry", "Watches", "Scarves & Wraps", "Belts", "Furnishings"],
  "Spirit & Gifts":            ["Novelties", "Pennants & Banners", "Frames & Albums", "Drinkware", "Ceramics", "Plush"],
  "Sporting Goods":            ["Fan Wear", "Equipment", "Footwear"],
  "Gifts & Stationery":        ["Stationery", "Greeting Cards", "Gift Wrap", "Paper Products", "Fashion Gifts"],
  "School & Office Supplies":  ["Writing Instruments", "Desk Accessories", "Planners & Calendars", "Binders", "Notebooks & Pads", "Course Specialty Supplies"],
  "Campus Living":             ["Dorm Essentials", "Kitchen", "Storage", "Bedding", "Bath"],
  "Technology & Electronics":  ["Software", "Supplies & Accessories", "Peripherals", "Hardware & Devices"],
  "Graduation & Regalia":      ["Caps & Gowns", "Announcements", "Rings", "Frames", "Diplomas"],
  "Food & Beverage":           ["Packaged Food", "Beverages", "Snacks", "Candy", "Specialty Food"],
  "Health & Beauty":           ["Health", "Beauty", "Personal Care"],
  "Campus Services":           ["Printing", "Financial Services", "Insurance", "Shipping", "Photography"],
  "Course Materials":          ["Physical Textbooks", "Digital Course Materials", "Course Packs", "Course-Related Devices"],
  "Tradebooks":                ["General Books", "Reference", "Trade Paperback"],
};

const TAXONOMY_TEXT = Object.entries(NACS_TAXONOMY)
  .map(([dept, classes]) => `  ${dept}: ${classes.join(", ")}`)
  .join("\n");

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ---------------------------------------------------------------------------
// Website fetching
// ---------------------------------------------------------------------------

async function fetchWebsiteText(url: string, maxChars = 5000): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "CSCDirectoryBot/1.0 (campus store partner directory)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, maxChars);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Claude Haiku — summarize + classify
// ---------------------------------------------------------------------------

interface EnrichmentResult {
  summary: string;
  nacs_department: string;
  nacs_classes: string[];
}

async function enrichWithHaiku(
  org: Record<string, string | null>,
  websiteText: string,
  apiKey: string
): Promise<EnrichmentResult> {
  const humanData = [
    org.name              && `Name: ${org.name}`,
    org.primary_category  && `Category (human-set): ${org.primary_category}`,
    org.company_description && `Description: ${org.company_description}`,
    org.highlight_product_name && `Tagline: ${org.highlight_product_name}`,
    org.highlight_product_description && `Product detail: ${org.highlight_product_description}`,
    org.highlight_the_deal && `Current offer: ${org.highlight_the_deal}`,
    org.city && org.province && `Location: ${org.city}, ${org.province}`,
  ].filter(Boolean).join("\n");

  const prompt = `You are categorizing a vendor partner for a campus store directory.

HUMAN-ENTERED DATA:
${humanData}

WEBSITE CONTENT (scraped):
${websiteText || "(no website content available)"}

NACS TAXONOMY (use these exact values):
${TAXONOMY_TEXT}

Tasks:
1. Write a 2-3 sentence summary of this vendor synthesizing all available information. Focus on what they sell, who they serve, and why campus stores would partner with them. Be concrete and specific.
2. Select the single best NACS department from the list above.
3. Select 1-3 relevant NACS classes within that department.

If human-set category conflicts with website evidence, trust the website. If no website content is available, use human-entered data only.

Respond with JSON only, no other text:
{
  "summary": "...",
  "nacs_department": "...",
  "nacs_classes": ["...", "..."]
}`;

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: HAIKU_MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const json = await res.json();
  const text = json.content[0].text.trim();

  try {
    // Strip markdown code fences if present
    const clean = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(clean) as EnrichmentResult;
  } catch {
    throw new Error(`Haiku returned unparseable JSON: ${text.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Voyage — generate embedding
// ---------------------------------------------------------------------------

async function embedText(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch(VOYAGE_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: [text], model: VOYAGE_MODEL }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voyage API error ${res.status}: ${err}`);
  }

  const json = await res.json();
  return json.data[0].embedding as number[];
}

// ---------------------------------------------------------------------------
// Main per-org processing
// ---------------------------------------------------------------------------

async function processOrg(
  orgId: string,
  voyageKey: string,
  anthropicKey: string,
  forceRescrape = false
): Promise<void> {
  const { data: org, error } = await supabase
    .from("organizations")
    .select(
      "id, name, website, primary_category, company_description, " +
      "highlight_product_name, highlight_product_description, highlight_the_deal, " +
      "city, province, website_summary, website_scraped_url"
    )
    .eq("id", orgId)
    .single();

  if (error || !org) throw new Error(`Org ${orgId} not found: ${error?.message}`);

  // Step 1: Website scrape (use cache unless URL changed or forced)
  const websiteChanged = org.website && org.website !== org.website_scraped_url;
  let websiteText = "";
  let freshScrape = false;

  if (org.website && (forceRescrape || websiteChanged || !org.website_summary)) {
    websiteText = await fetchWebsiteText(org.website);
    freshScrape = true;
  }

  // Step 2: Haiku enrichment
  // Run if: no summary yet, website just scraped, or no NACS classification
  const needsEnrichment = !org.website_summary || freshScrape;

  let summary    = org.website_summary ?? "";
  let nacsDept   = "";
  let nacsClasses: string[] = [];

  if (needsEnrichment || anthropicKey) {
    const enrichment = await enrichWithHaiku(org, freshScrape ? websiteText : (org.website_summary ?? ""), anthropicKey);
    summary     = enrichment.summary;
    nacsDept    = enrichment.nacs_department;
    nacsClasses = enrichment.nacs_classes;
  }

  // Step 3: Build rich embed text — all human signals + AI summary
  const embedParts = [
    org.name,
    org.primary_category,
    summary,
    org.company_description,
    org.highlight_product_name,
    org.highlight_product_description,
    org.highlight_the_deal,
    org.city,
    org.province,
  ].filter(Boolean);

  const embedInput = embedParts.join("\n");
  if (!embedInput.trim()) return;

  const embedding = await embedText(embedInput, voyageKey);

  // Step 4: Write everything back — never overwrite primary_category (human-owned)
  const updates: Record<string, unknown> = {
    embedding,
    embedding_updated_at: new Date().toISOString(),
    website_summary: summary || null,
    nacs_department: nacsDept || null,
    nacs_classes: nacsClasses.length > 0 ? nacsClasses : null,
  };

  if (freshScrape) {
    updates.website_scraped_at  = new Date().toISOString();
    updates.website_scraped_url = org.website;
  }

  const { error: updateError } = await supabase
    .from("organizations")
    .update(updates)
    .eq("id", orgId);

  if (updateError) throw new Error(`Failed to store enrichment: ${updateError.message}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  try {
    const voyageKey    = Deno.env.get("VOYAGE_API_KEY");
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!voyageKey)    return new Response("VOYAGE_API_KEY not set",    { status: 500 });
    if (!anthropicKey) return new Response("ANTHROPIC_API_KEY not set", { status: 500 });

    const body = await req.json().catch(() => ({}));
    const forceRescrape: boolean = body.force_rescrape ?? false;

    if (body.batch) {
      const limit: number = body.limit ?? 10;

      const { data: orgs, error } = await supabase
        .from("organizations")
        .select("id, name")
        .eq("type", "Vendor Partner")
        .or("embedding.is.null,embedding_updated_at.is.null,website_summary.is.null")
        .order("name")
        .limit(limit);

      if (error) throw error;

      const delayMs = body.delay_ms ?? 1000;
      const results = { success: 0, skipped: 0, errors: [] as string[], processed: (orgs ?? []).map(o => o.name) };

      for (const org of orgs ?? []) {
        try {
          await processOrg(org.id, voyageKey, anthropicKey, forceRescrape);
          results.success++;
        } catch (e) {
          results.errors.push(`${org.id}: ${(e as Error).message}`);
        }
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      }

      return new Response(JSON.stringify(results), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const { org_id } = body;
    if (!org_id) return new Response("org_id required", { status: 400 });

    await processOrg(org_id, voyageKey, anthropicKey, forceRescrape);

    return new Response(JSON.stringify({ ok: true, org_id }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
