"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { VENDOR_CATEGORIES, CATEGORY_SUBCATEGORIES } from "@/lib/types/procurement";

const PARENT_SET = new Set<string>(VENDOR_CATEGORIES as readonly string[]);
const SUB_TO_PARENT = new Map<string, string>();
for (const [parent, subs] of Object.entries(CATEGORY_SUBCATEGORIES)) {
  for (const sub of subs ?? []) SUB_TO_PARENT.set(sub, parent);
}

function parsePartnerCategories(raw: string | null): { parents: string[]; subs: string[] } {
  if (!raw) return { parents: [], subs: [] };
  const items = raw.split(",").map(s => s.trim()).filter(Boolean);
  const parents: string[] = [];
  const subs: string[] = [];
  for (const item of items) {
    if (PARENT_SET.has(item)) parents.push(item);
    else subs.push(item);
  }
  return { parents, subs };
}

export type SupplierConfidence = "high" | "medium" | "low";

export interface SupplierContact {
  name: string | null;
  roleTitle: string | null;
  email: string | null;
}

export interface SupplierMatch {
  orgId: string;
  orgName: string;
  orgSlug: string;
  province: string | null;
  matchingCategory: string;
  matchingSubcategories: string[];
  confidence: SupplierConfidence;
  primaryContact: SupplierContact | null;
  catalogueUrl: string | null;
  hasCertMatch: boolean;
}

export interface SupplierData {
  matches: SupplierMatch[];
  topMatches: SupplierMatch[];
  totalMatches: number;
  hasAssignments: boolean; // false = show Flag prompt
}

// ─────────────────────────────────────────────────────────────────────────────

export async function getMemberSupplierData(
  userEmail: string | null,
  orgId: string
): Promise<{ success: boolean; data?: SupplierData; error?: string }> {
  if (!userEmail) return { success: true, data: { matches: [], topMatches: [], totalMatches: 0, hasAssignments: false } };

  const db = createAdminClient();

  // 1. Find this user's contact record at the org
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contactRow } = await (db as any)
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .or(`email.eq.${userEmail},work_email.eq.${userEmail}`)
    .limit(1)
    .maybeSingle();

  const contactId = contactRow?.id as string | null;

  // 2. Get the org's procurement_info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgRow } = await (db as any)
    .from("organizations")
    .select("procurement_info")
    .eq("id", orgId)
    .maybeSingle();

  const pi = orgRow?.procurement_info as Record<string, unknown> | null;
  const categoryBuyers = Array.isArray(pi?.category_buyers) ? pi!.category_buyers as any[] : [];

  // 3. Find which categories + subcategories this user is assigned as a buyer
  const buyerCategories: string[] = [];
  const buyerSubcategories: string[] = [];

  for (const entry of categoryBuyers) {
    const contactSubs = entry.contact_subcategories as Record<string, string[]> | undefined;
    if (contactId && contactSubs?.[contactId]?.length) {
      buyerCategories.push(entry.category as string);
      buyerSubcategories.push(...(contactSubs[contactId] ?? []));
    } else if (!contactId) {
      // Fallback: no contact record — use all org categories
      buyerCategories.push(entry.category as string);
    }
  }

  const hasAssignments = buyerCategories.length > 0;
  if (!hasAssignments) {
    return { success: true, data: { matches: [], topMatches: [], totalMatches: 0, hasAssignments: false } };
  }

  // 4. Get org's preferred certifications for bonus scoring
  const preferredCerts: string[] = Array.isArray(pi?.preferred_certifications)
    ? (pi!.preferred_certifications as string[])
    : [];

  // 5. Fetch all active Vendor Partners with primary_category
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: partners } = await (db as any)
    .from("organizations")
    .select("id, name, slug, province, primary_category, catalogue_url, certifications")
    .eq("type", "Vendor Partner")
    .eq("membership_status", "active")
    .not("primary_category", "is", null);

  // 6. Score each partner
  const scored: { partner: any; score: number; matchCat: string; matchSubs: string[]; certMatch: boolean }[] = [];

  for (const p of (partners ?? []) as any[]) {
    const { parents: pParents, subs: pSubs } = parsePartnerCategories(p.primary_category);
    const pCerts: string[] = Array.isArray(p.certifications) ? p.certifications : [];

    let bestScore = 0;
    let bestCat = "";
    let bestSubs: string[] = [];

    for (const buyerCat of buyerCategories) {
      if (!pParents.includes(buyerCat) && !pSubs.some(s => SUB_TO_PARENT.get(s) === buyerCat)) continue;

      // Subcategory overlap between buyer's subs and partner's subs
      const subOverlap = buyerSubcategories.filter(s => pSubs.includes(s));
      const buyerHasSubs = buyerSubcategories.some(s => SUB_TO_PARENT.get(s) === buyerCat);
      const partnerHasSubs = pSubs.some(s => SUB_TO_PARENT.get(s) === buyerCat);

      let score = 1;
      if (buyerHasSubs && partnerHasSubs && subOverlap.length > 0) score = 3;
      else if (buyerHasSubs && partnerHasSubs) score = 2;
      else if (buyerHasSubs || partnerHasSubs) score = 1.5;

      // Certification bonus — 0.25 per matching cert so multiple matches compound
      const certMatchCount = preferredCerts.filter(c => pCerts.includes(c)).length;
      score += certMatchCount * 0.25;

      if (score > bestScore) {
        bestScore = score;
        bestCat = buyerCat;
        bestSubs = subOverlap;
      }
    }

    if (bestScore > 0) {
      const certMatch = preferredCerts.some(c => pCerts.includes(c)); // at least one match
      scored.push({ partner: p, score: bestScore, matchCat: bestCat, matchSubs: bestSubs, certMatch });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // 7. Fetch primary contacts for matched partner orgs
  const matchedOrgIds = scored.map(s => s.partner.id as string);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contactRows } = await (db as any)
    .from("contacts")
    .select("id, name, role_title, work_email, email, organization_id")
    .in("organization_id", matchedOrgIds)
    .not("hidden", "eq", true)
    .is("archived_at", null);

  const primaryContactByOrg = new Map<string, any>();
  for (const c of (contactRows ?? []) as any[]) {
    if (!primaryContactByOrg.has(c.organization_id)) {
      primaryContactByOrg.set(c.organization_id, c);
    }
  }

  function conf(score: number): SupplierConfidence {
    if (score >= 3) return "high";
    if (score >= 2) return "medium";
    return "low";
  }

  const matches: SupplierMatch[] = scored.map(({ partner, score, matchCat, matchSubs, certMatch }) => {
    const c = primaryContactByOrg.get(partner.id);
    return {
      orgId: partner.id as string,
      orgName: partner.name as string,
      orgSlug: partner.slug as string,
      province: (partner.province as string | null) ?? null,
      matchingCategory: matchCat,
      matchingSubcategories: matchSubs,
      confidence: conf(score),
      primaryContact: c ? {
        name: (c.name as string | null) ?? null,
        roleTitle: (c.role_title as string | null) ?? null,
        email: ((c.work_email || c.email) as string | null) ?? null,
      } : null,
      catalogueUrl: (partner.catalogue_url as string | null) ?? null,
      hasCertMatch: certMatch,
    };
  });

  return {
    success: true,
    data: {
      matches,
      topMatches: matches.slice(0, 10),
      totalMatches: matches.length,
      hasAssignments: true,
    },
  };
}
