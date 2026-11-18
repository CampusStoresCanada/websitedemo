import type { createAdminClient } from "@/lib/supabase/admin";
import { extractDomain } from "@/lib/applications/duplicate-match";

/**
 * "Do we already have this organization?" — the one check, used before anything
 * creates an org: approving an application (lib/actions/applications.ts) and
 * staff adding a prospect company (lib/actions/prospect-organizations.ts).
 * Moved here from applications.ts, which is "use server" and so could not
 * share it.
 */

export interface DuplicateOrgMatch {
  id: string;
  name: string;
  email: string | null;
  website: string | null;
  membershipStatus: string | null;
  type: string | null;
  matchReasons: string[];
  hasOutstandingInvoice: boolean;
  hasPaidInvoice: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Duplicate organization / duplicate charge detection
// ─────────────────────────────────────────────────────────────────


/**
 * Invoice statuses that mean "this org still owes us money", matching the set
 * already used by optOutOfRenewal / activateMembershipRenewal / stripe reconcile.
 *
 * Both call sites in this file previously hardcoded
 * ["pending", "sent", "overdue", "pending_settlement"] — but three of those four
 * are not statuses this app ever writes (the real ones are invoiced / paid /
 * voided / draft). So the duplicate-org reviewer under-reported outstanding
 * invoices, and the invite resend fell through to a generic billing link for
 * every org including ones that had already paid.
 */
export const UNPAID_INVOICE_STATUSES = new Set(["invoiced", "pending_settlement", "draft"]);

/**
 * Looks for existing organizations that plausibly match a would-be-approved
 * application, by exact name, exact contact email, shared email domain, or
 * shared website domain. Also flags whether any match already has an
 * outstanding or paid invoice, so approval can't silently create a second
 * org or a second charge for the same real-world organization.
 */
export async function findDuplicateOrganizations(
  db: ReturnType<typeof createAdminClient>,
  params: { name: string; email: string | null; website: string | null }
): Promise<DuplicateOrgMatch[]> {
  const SELECT = "id, name, email, website, membership_status, type";
  const emailDomain = extractDomain(params.email);
  const websiteDomain = extractDomain(params.website);

  async function lookupByColumn(column: "name" | "email" | "website", pattern: string, reason: string) {
    const { data } = await db
      .from("organizations")
      .select(SELECT)
      .eq("is_test", false)
      .ilike(column, pattern);
    return { data: data as Record<string, unknown>[] | null, reason };
  }

  const lookups: Promise<{ data: Record<string, unknown>[] | null; reason: string }>[] = [
    lookupByColumn("name", params.name.trim(), "organization name"),
  ];

  if (params.email) {
    lookups.push(lookupByColumn("email", params.email.trim(), "contact email"));
  }
  if (emailDomain) {
    lookups.push(lookupByColumn("email", `%@${emailDomain}`, `email domain (${emailDomain})`));
  }
  if (websiteDomain) {
    lookups.push(lookupByColumn("website", `%${websiteDomain}%`, `website (${websiteDomain})`));
  }

  const results = await Promise.all(lookups);

  const byId = new Map<string, DuplicateOrgMatch>();
  for (const { data, reason } of results) {
    for (const org of data ?? []) {
      const id = org.id as string;
      const existing = byId.get(id);
      if (existing) {
        if (!existing.matchReasons.includes(reason)) existing.matchReasons.push(reason);
      } else {
        byId.set(id, {
          id,
          name: org.name as string,
          email: (org.email as string) ?? null,
          website: (org.website as string) ?? null,
          membershipStatus: (org.membership_status as string) ?? null,
          type: (org.type as string) ?? null,
          matchReasons: [reason],
          hasOutstandingInvoice: false,
          hasPaidInvoice: false,
        });
      }
    }
  }

  if (byId.size === 0) return [];

  const ids = Array.from(byId.keys());
  const { data: invoices } = await db
    .from("invoices")
    .select("organization_id, status")
    .in("organization_id", ids);

  for (const inv of invoices ?? []) {
    const match = byId.get(inv.organization_id);
    if (!match) continue;
    if (UNPAID_INVOICE_STATUSES.has(inv.status)) match.hasOutstandingInvoice = true;
    if (inv.status === "paid") match.hasPaidInvoice = true;
  }

  return Array.from(byId.values());
}

