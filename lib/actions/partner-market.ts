"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { lookupUserEmailsByIds } from "@/lib/supabase/user-lookup";
import { requireAuthenticated } from "@/lib/auth/guards";
import { VENDOR_CATEGORIES, CATEGORY_SUBCATEGORIES } from "@/lib/types/procurement";
import { sendCircleNotification } from "@/lib/circle/notifications";
import { sendEmail } from "@/lib/email/send";

const PARENT_SET = new Set<string>(VENDOR_CATEGORIES as readonly string[]);

// ── Category parsing ──────────────────────────────────────────────────────────

function parseCategories(raw: string | null): { parents: string[]; subcategories: string[] } {
  if (!raw) return { parents: [], subcategories: [] };
  const items = raw.split(",").map(s => s.trim()).filter(Boolean);
  const parents: string[] = [];
  const subcategories: string[] = [];
  for (const item of items) {
    if (PARENT_SET.has(item)) parents.push(item);
    else subcategories.push(item);
  }
  return { parents, subcategories };
}

// ── Match confidence scoring ──────────────────────────────────────────────────
// Returns a score 0–3 for how well a member category entry matches a partner's categories.

function scoreMatch(
  memberCategory: string,
  memberSubcategories: string[], // subcategories the member has assigned for this category
  partnerParents: string[],
  partnerSubs: string[]
): number {
  const isParentMatch = partnerParents.includes(memberCategory);
  if (!isParentMatch) return 0;

  const partnerHasSubs = partnerSubs.some(sub => {
    const subs = CATEGORY_SUBCATEGORIES[memberCategory] ?? [];
    return (subs as readonly string[]).includes(sub);
  });
  const memberHasSubs = memberSubcategories.length > 0;

  if (partnerHasSubs && memberHasSubs) {
    // Check for actual subcategory overlap
    const overlap = partnerSubs.filter(s => memberSubcategories.includes(s));
    if (overlap.length > 0) return 3; // exact subcategory match — high confidence
    return 2; // both have subcategories but different ones — medium
  }
  if (partnerHasSubs && !memberHasSubs) return 2; // partner precise, member broad
  if (!partnerHasSubs && memberHasSubs) return 1.5; // member precise, partner broad
  return 1; // both parent-only — low confidence
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type MatchConfidence = "high" | "medium" | "low";

export interface MarketContact {
  id: string;
  name: string | null;
  roleTitle: string | null;
  email: string | null;
}

export interface MarketMatch {
  orgId: string;
  orgName: string;
  orgSlug: string;
  province: string | null;
  matchingCategory: string;
  matchingSubcategories: string[]; // overlap between partner and member subcategories
  confidence: MatchConfidence;
  score: number;
  buyer: MarketContact | null;        // specific buyer for that category
  primaryContact: MarketContact | null; // fallback
  publicEmail: string | null;         // final fallback
}

export interface MarketData {
  matches: MarketMatch[];       // all matches, sorted by score desc
  topMatches: MarketMatch[];    // top 10
  totalMatches: number;
  withoutProcurementCount: number;
}

// ── Main query ────────────────────────────────────────────────────────────────

export async function getPartnerMarketData(
  partnerOrgId: string,
  partnerCategoryString: string | null
): Promise<{ success: boolean; data?: MarketData; error?: string }> {
  const { parents: partnerParents, subcategories: partnerSubs } =
    parseCategories(partnerCategoryString);

  if (partnerParents.length === 0 && partnerSubs.length === 0) {
    return { success: true, data: { matches: [], topMatches: [], totalMatches: 0, withoutProcurementCount: 0 } };
  }

  const db = createAdminClient();

  // Fetch all active member orgs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgs, error: orgsError } = await (db as any)
    .from("organizations")
    .select("id, name, slug, province, email, procurement_info")
    .eq("type", "Member")
    .eq("membership_status", "active")
    .is("archived_at", null)
    .eq("is_test", false);

  if (orgsError) return { success: false, error: "Failed to load members" };

  const allOrgs = (orgs ?? []) as any[];
  let withoutProcurementCount = 0;
  const rawMatches: { org: any; score: number; category: string; memberSubs: string[] }[] = [];

  for (const org of allOrgs) {
    const pi = org.procurement_info as Record<string, unknown> | null;
    const buyers = Array.isArray(pi?.category_buyers) ? pi!.category_buyers as any[] : [];

    if (buyers.length === 0) {
      withoutProcurementCount++;
      continue;
    }

    // Find the best-scoring category match for this member
    let bestScore = 0;
    let bestCategory = "";
    let bestMemberSubs: string[] = [];

    for (const entry of buyers) {
      const cat = entry.category as string;
      // Collect all subcategories this member has across all buyers for this category
      const contactSubs = entry.contact_subcategories as Record<string, string[]> | undefined;
      const memberSubs = contactSubs
        ? [...new Set(Object.values(contactSubs).flat())]
        : [];

      const score = scoreMatch(cat, memberSubs, partnerParents, partnerSubs);
      if (score > bestScore) {
        bestScore = score;
        bestCategory = cat;
        bestMemberSubs = memberSubs;
      }
    }

    if (bestScore > 0) {
      rawMatches.push({ org, score: bestScore, category: bestCategory, memberSubs: bestMemberSubs });
    } else {
      withoutProcurementCount++;
    }
  }

  // Sort by score descending
  rawMatches.sort((a, b) => b.score - a.score);

  // Collect all contact IDs we need to resolve
  const neededContactIds = new Set<string>();
  const orgBuyerMap = new Map<string, string[]>(); // orgId → buyer contact_ids for best category

  for (const { org, category } of rawMatches) {
    const pi = org.procurement_info as Record<string, unknown> | null;
    const buyers = Array.isArray(pi?.category_buyers) ? pi!.category_buyers as any[] : [];
    const entry = buyers.find((b: any) => b.category === category);
    const ids: string[] = Array.isArray(entry?.contact_ids) ? entry.contact_ids : [];
    orgBuyerMap.set(org.id, ids);
    for (const id of ids) neededContactIds.add(id);
  }

  // Also get primary contacts for all matching orgs (fallback)
  const matchingOrgIds = rawMatches.map(m => m.org.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contactRows } = await (db as any)
    .from("contacts")
    .select("id, name, role_title, work_email, email, hidden, organization_id")
    .in("organization_id", matchingOrgIds)
    .not("hidden", "eq", true)
    .is("archived_at", null);

  // Index contacts by id and by org
  const contactById = new Map<string, any>();
  const contactsByOrg = new Map<string, any[]>();
  for (const c of (contactRows ?? []) as any[]) {
    contactById.set(c.id, c);
    const list = contactsByOrg.get(c.organization_id) ?? [];
    list.push(c);
    contactsByOrg.set(c.organization_id, list);
  }

  function resolveContact(c: any): MarketContact {
    return {
      id: c.id,
      name: (c.name as string | null) ?? null,
      roleTitle: (c.role_title as string | null) ?? null,
      email: ((c.work_email || c.email) as string | null) ?? null,
    };
  }

  function confidence(score: number): MatchConfidence {
    if (score >= 3) return "high";
    if (score >= 2) return "medium";
    return "low";
  }

  const matches: MarketMatch[] = rawMatches.map(({ org, score, category, memberSubs }) => {
    const buyerIds = orgBuyerMap.get(org.id) ?? [];
    const orgContacts = contactsByOrg.get(org.id) ?? [];

    // Find best buyer: prefer one with a matching subcategory
    let buyer: MarketContact | null = null;
    for (const id of buyerIds) {
      const c = contactById.get(id);
      if (c) { buyer = resolveContact(c); break; }
    }

    // Primary contact fallback
    const primaryContact = orgContacts[0] ? resolveContact(orgContacts[0]) : null;

    // Subcategory overlap for display
    const matchingSubcategories = partnerSubs.filter(s => memberSubs.includes(s));

    return {
      orgId: org.id,
      orgName: org.name as string,
      orgSlug: org.slug as string,
      province: (org.province as string | null) ?? null,
      matchingCategory: category,
      matchingSubcategories,
      confidence: confidence(score),
      score,
      buyer,
      primaryContact,
      publicEmail: (org.email as string | null) ?? null,
    };
  });

  return {
    success: true,
    data: {
      matches,
      topMatches: matches.slice(0, 10),
      totalMatches: matches.length,
      withoutProcurementCount,
    },
  };
}

// ── Rate-limited nudge ────────────────────────────────────────────────────────
// Once per week globally — prevents member org admins being bombarded.

const NUDGE_COOLDOWN_DAYS = 7;

export async function checkNudgeCooldown(): Promise<{
  canSend: boolean;
  lastSentAt?: string;
  availableAt?: string;
}> {
  const db = createAdminClient();
  const cutoff = new Date(Date.now() - NUDGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any)
    .from("market_nudge_log")
    .select("sent_at")
    .gte("sent_at", cutoff)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { canSend: true };

  const lastSentAt = data.sent_at as string;
  const availableAt = new Date(
    new Date(lastSentAt).getTime() + NUDGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  return { canSend: false, lastSentAt, availableAt };
}

export async function notifyMembersWithoutProcurement(
  partnerOrgId: string,
  partnerCategoryString: string | null
): Promise<{ success: boolean; sentCount?: number; error?: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const isAdmin = auth.ctx.globalRole === "admin" || auth.ctx.globalRole === "super_admin";

  // "__self__" = resolve the caller's own partner org
  let resolvedOrgId = partnerOrgId;
  let resolvedCategory = partnerCategoryString;

  if (partnerOrgId === "__self__" || !partnerOrgId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: memberships } = await (auth.ctx.supabase as any)
      .from("user_organizations")
      .select("organization_id, role, organization:organizations(id, primary_category, type)")
      .eq("user_id", auth.ctx.userId)
      .eq("status", "active");
    const partnerMembership = (memberships ?? []).find(
      (m: any) => m.organization?.type === "Vendor Partner" && m.role === "org_admin"
    );
    if (!partnerMembership) return { success: false, error: "Partner org admin access required" };
    resolvedOrgId = partnerMembership.organization_id as string;
    resolvedCategory = (partnerMembership.organization?.primary_category as string | null) ?? null;
  } else if (!isAdmin) {
    // Verify caller is org admin of the specified org
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: membership } = await (db as any)
      .from("user_organizations")
      .select("role")
      .eq("user_id", auth.ctx.userId)
      .eq("organization_id", resolvedOrgId)
      .eq("status", "active")
      .maybeSingle();
    if (membership?.role !== "org_admin") return { success: false, error: "Not authorized" };
  }

  // Check global rate limit
  const cooldown = await checkNudgeCooldown();
  if (!cooldown.canSend) {
    return { success: false, error: `This notification was already sent this week. Available again on ${new Date(cooldown.availableAt!).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}.` };
  }

  const { parents: partnerParents } = parseCategories(resolvedCategory);
  if (partnerParents.length === 0) return { success: false, error: "No categories set on your profile" };

  // Find member orgs without procurement data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgs } = await (db as any)
    .from("organizations")
    .select("id, name")
    .eq("type", "Member")
    .eq("membership_status", "active")
    .is("archived_at", null)
    .or("procurement_info.is.null,procurement_info->category_buyers.is.null");

  const targetOrgIds = (orgs ?? []).map((o: any) => o.id as string);
  if (targetOrgIds.length === 0) return { success: true, sentCount: 0 };

  // Find org admin contacts for those orgs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: adminRows } = await (db as any)
    .from("user_organizations")
    .select("user_id, organization_id")
    .in("organization_id", targetOrgIds)
    .eq("role", "org_admin")
    .eq("status", "active");

  const userIds = [...new Set<string>((adminRows ?? []).map((r: any) => r.user_id as string))];
  if (userIds.length === 0) return { success: true, sentCount: 0 };

  // Get emails
  const emailMap = await lookupUserEmailsByIds(db, userIds);
  const userEmails: { id: string; email: string }[] = userIds
    .filter((id) => emailMap[id])
    .map((id) => ({ id, email: emailMap[id] }));

  const categoryList = partnerParents.slice(0, 3).join(", ");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://websitedemo-khaki.vercel.app";

  // Send Ghost Butler DM + email fallback to each org admin
  const sends = userEmails.map(async ({ email }) => {
    void sendCircleNotification({
      recipientEmail: email,
      message: [
        "📊 Vendors in your market are looking for buyers",
        "",
        `We have vendors in ${categoryList} who want to connect with the right buyer at your institution.`,
        "",
        "Setting up your procurement section means vendors can find the right person — without going through a switchboard.",
        "",
        `${appUrl}/me`,
      ].join("\n"),
    }).catch(() => {});

    await sendEmail({
      to: email,
      subject: "Vendors in your category are looking for your buyer",
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1A1A1A;">Vendors in your market are looking for buyers</h2>
          <p>We have vendors in <strong>${categoryList}</strong> who want to connect with the right buyer at your institution.</p>
          <p>Setting up your procurement section makes it easy for vendors in your market to find the right person — without going through a switchboard.</p>
          <p style="margin: 24px 0;">
            <a href="${appUrl}/me" style="background-color:#EE2A2E;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;">
              Set up your procurement details
            </a>
          </p>
          <p style="color:#9CA3AF;font-size:12px;">You're receiving this because you manage an active CSC member institution.</p>
        </div>
      `,
    }).catch(() => {});
  });

  await Promise.allSettled(sends);

  // Log the nudge
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).from("market_nudge_log").insert({
    triggered_by_org_id: resolvedOrgId,
    triggered_by_user_id: auth.ctx.userId,
    recipients_count: userEmails.length,
  });

  return { success: true, sentCount: userEmails.length };
}
