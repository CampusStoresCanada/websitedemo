// ---------------------------------------------------------------------------
// Partner Asks — match open "Ask the Partners" questions to the partners who
// could actually answer them.
//
// Why this exists: members post sourcing questions and they go unanswered
// because almost no partners are active in Circle. Rather than blasting every
// partner on every question, this ranks the partners whose category/description
// actually matches the ask, shows whether each can even see it yet, and lets a
// human pick a handful. Deliberately a tool for occasional, deliberate use —
// not an automation.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { getCircleClient } from "@/lib/circle/client";
import type { CirclePost } from "@/lib/circle/types";

/** Circle space id for "Ask the Partners". Override via env if it ever moves. */
export const ASK_THE_PARTNERS_SPACE_ID = Number(
  process.env.CIRCLE_ASK_PARTNERS_SPACE_ID ?? 1907405
);

/** Circle only exposes these on the raw response, not on our CirclePost type. */
type RawPost = CirclePost & {
  user_email?: string;
  user_name?: string;
  comments_count?: number;
  published_at?: string;
};

export type CircleState = "active" | "invited" | "absent";

export interface PartnerAsk {
  id: number;
  title: string;
  url: string;
  excerpt: string;
  askerName: string;
  askerEmail: string | null;
  /** Resolved from our contacts table when the asker is a known member. */
  askerOrg: string | null;
  publishedAt: string | null;
  commentsCount: number;
}

export interface PartnerCandidate {
  contactId: string;
  name: string;
  email: string;
  orgName: string;
  primaryCategory: string | null;
  circleState: CircleState;
  score: number;
  /** Human-readable why-this-partner, shown in the UI so picks are explainable. */
  reasons: string[];
}

// ── Category vocabulary ────────────────────────────────────────────────────
// Maps the words members actually use to the partner categories that stock it.
// Intentionally hand-tuned and small: precision matters far more than recall
// when the output is "who do we email".
const CATEGORY_TERMS: Record<string, string[]> = {
  Apparel: [
    "apparel", "clothing", "hoodie", "hoodies", "crewneck", "crew", "sweatshirt",
    "sweats", "quarter zip", "quarter-zip", "tee", "t-shirt", "shirt", "jacket",
    "size run", "sizing", "xxs", "5xl", "camo", "camouflage", "wear", "garment",
  ],
  Accessories: ["accessory", "accessories", "bag", "backpack", "lanyard", "keychain", "sticker", "pin"],
  "School Office & Lab Supplies": [
    "notebook", "notebooks", "paper", "stationery", "stationary", "pen", "pencil",
    "binder", "lab", "supplies", "duplicating", "carbonless", "scantron", "office",
  ],
  "Gifts & Promotional Products": ["gift", "gifts", "bundle", "promotional", "promo", "swag", "giveaway"],
  "Technology & Electronics": ["tech", "electronic", "electronics", "charger", "headphone", "device", "laptop"],
  "Graduation & Regalia": ["graduation", "regalia", "gown", "convocation", "diploma", "frame"],
  "Campus Living": ["dorm", "residence", "bedding", "campus living", "linens"],
  Books: ["book", "books", "textbook", "publisher", "isbn"],
  "Course Materials": ["course material", "courseware", "ebook", "digital", "access code", "inclusive access"],
  "General Merchandise": ["merchandise", "general merchandise", "giftware"],
};

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function postText(p: RawPost): string {
  const raw = typeof p.body === "string" ? p.body : (p.body?.body ?? "");
  return `${p.name ?? ""} ${stripHtml(String(raw ?? ""))}`;
}

/**
 * Whole-word (or whole-phrase) containment.
 *
 * Plain `includes()` is wrong here and was actively harmful: "notebooks"
 * contains "book", so a question about notebooks matched every Books-category
 * partner and returned 74 candidates instead of a handful.
 */
function hasTerm(text: string, term: string): boolean {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(text);
}

/** Terms from the ask that a given category claims. */
function matchedTerms(text: string, category: string | null): string[] {
  if (!category) return [];
  const hits = new Set<string>();
  // A partner's primary_category is often a comma-joined list of several.
  for (const part of category.split(",").map((s) => s.trim().toLowerCase())) {
    for (const [cat, terms] of Object.entries(CATEGORY_TERMS)) {
      if (part !== cat.toLowerCase()) continue; // exact category, not substring
      for (const t of terms) if (hasTerm(text, t)) hits.add(t);
    }
  }
  return [...hits];
}

// ── Asks ───────────────────────────────────────────────────────────────────

export async function listPartnerAsks(limit = 15): Promise<PartnerAsk[]> {
  const client = getCircleClient();
  if (!client) return [];

  const posts = (await client.listPosts(ASK_THE_PARTNERS_SPACE_ID, {
    per_page: limit,
    sort: "latest",
  })) as RawPost[];

  const db = createAdminClient();
  const emails = posts.map((p) => (p.user_email ?? "").toLowerCase()).filter(Boolean);
  const { data: askerContacts } = emails.length
    ? await db
        .from("contacts")
        .select("email, organizations(name)")
        .in("email", emails)
    : { data: [] as { email: string; organizations: { name: string } | null }[] };

  const orgByEmail = new Map<string, string>();
  for (const c of askerContacts ?? []) {
    const org = (c as { organizations?: { name?: string } | null }).organizations?.name;
    if (c.email && org) orgByEmail.set(c.email.toLowerCase(), org);
  }

  return posts
    // The pinned "Welcome to Ask the Partners" explainer is not a question.
    .filter((p) => !/^welcome to/i.test(p.name ?? ""))
    .map((p) => {
      const text = stripHtml(typeof p.body === "string" ? p.body : (p.body?.body ?? ""));
      const email = (p.user_email ?? "").toLowerCase() || null;
      return {
        id: p.id,
        title: p.name,
        url: p.url,
        excerpt: text.length > 240 ? `${text.slice(0, 240)}…` : text,
        askerName: p.user_name ?? "Unknown",
        askerEmail: email,
        askerOrg: email ? (orgByEmail.get(email) ?? null) : null,
        publishedAt: p.published_at ?? p.created_at ?? null,
        commentsCount: p.comments_count ?? 0,
      };
    });
}

// ── Candidates ─────────────────────────────────────────────────────────────

/**
 * Rank partner contacts against one ask.
 *
 * Scoring is deliberately transparent — every point has a `reason` string
 * attached — because the operator has to defend the send list to themselves
 * before hitting go.
 */
export async function matchPartnersToAsk(ask: PartnerAsk): Promise<PartnerCandidate[]> {
  const db = createAdminClient();
  const text = `${ask.title} ${ask.excerpt}`.toLowerCase();

  const { data: rows } = await db
    .from("contacts")
    .select(
      "id, name, email, circle_id, is_primary, organizations!inner(name, type, membership_status, is_test, primary_category, company_description)"
    )
    .not("email", "is", null)
    .is("archived_at", null);

  type Row = {
    id: string; name: string | null; email: string; circle_id: string | null; is_primary: boolean | null;
    organizations: {
      name: string; type: string | null; membership_status: string | null;
      is_test: boolean | null; primary_category: string | null; company_description: string | null;
    } | null;
  };

  // Circle state, one sweep. `active` distinguishes people who completed
  // profile setup from those merely invited — see project-circle-four-states.
  const client = getCircleClient();
  const stateByEmail = new Map<string, CircleState>();
  if (client) {
    try {
      const map = await client.buildEmailMap();
      for (const [email, m] of map) stateByEmail.set(email, m.active ? "active" : "invited");
    } catch {
      /* leave empty — everyone reads as "absent", which is the safe direction */
    }
  }

  const out: PartnerCandidate[] = [];
  const seen = new Set<string>();

  for (const r of (rows ?? []) as unknown as Row[]) {
    const o = r.organizations;
    if (!o || o.type !== "Vendor Partner" || o.is_test) continue;
    if (!["active", "reactivated", "grace"].includes(o.membership_status ?? "")) continue;

    const email = r.email.toLowerCase();
    if (seen.has(email)) continue;

    const reasons: string[] = [];
    let score = 0;

    // Category is a COARSE bucket — "School Office & Lab Supplies" contains a
    // scrub vendor and a uniform vendor alongside the stationery ones. It is
    // weak evidence, so it scores low. (This used to be weighted 3x, above
    // description, which ranked Greentown Scrubs and Premium Uniforms ABOVE
    // Login Canada on a notebook question. Do not raise it again.)
    const catHits = matchedTerms(text, o.primary_category);
    if (catHits.length) {
      score += catHits.length * 1;
      reasons.push(`category: ${catHits.slice(0, 4).join(", ")}`);
    }

    const desc = (o.company_description ?? "").toLowerCase();
    if (desc) {
      // Ignore filler that appears in nearly every description ("canadian",
      // "products") — it inflates every score equally and tells you nothing.
      // Filler that appears in nearly every description, plus the connective
      // tissue of a question ("looking for a source of…"). Without these,
      // "looking" alone matched unrelated vendors.
      const STOP = new Set([
        "canadian", "canada", "products", "product", "campus", "store", "stores",
        "quality", "school", "student", "students", "company", "offer", "offers",
        "looking", "source", "sourcing", "still", "class", "classes", "uses",
        "these", "those", "currently", "import", "imports", "thanks", "vendor",
        "vendors", "anyone", "wondering", "hello", "similar", "please", "would",
      ]);
      const descHits = [...new Set(
        text
          .split(/[^a-z0-9-]+/)
          .filter((w) => w.length > 4 && !STOP.has(w) && hasTerm(desc, w))
      )].slice(0, 4);
      // The description is the PRECISE signal — an org whose own blurb says
      // "notebooks" is a far better answer to a notebook question than one
      // merely filed under the same category. Weighted well above category.
      if (descHits.length) {
        score += descHits.length * 4;
        reasons.push(`describes itself as: ${descHits.join(", ")}`);
      }
    }

    if (score === 0) continue; // never surface an unmatched partner
    if (r.is_primary) { score += 1; reasons.push("primary contact"); }

    seen.add(email);
    out.push({
      contactId: r.id,
      name: (r.name ?? "").trim() || email,
      email,
      orgName: o.name,
      primaryCategory: o.primary_category,
      circleState: stateByEmail.get(email) ?? "absent",
      score,
      reasons,
    });
  }

  return out.sort((a, b) => b.score - a.score || a.orgName.localeCompare(b.orgName));
}
