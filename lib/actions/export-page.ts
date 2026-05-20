"use server";

import { requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

/** Export contacts for an org as CSV rows. */
export async function exportOrgContacts(slug: string): Promise<{
  csv?: string;
  filename?: string;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  const { supabase } = auth.ctx;

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("slug", slug)
    .single();

  if (!org) return { error: "Organization not found" };

  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("name, role_title, email, phone, hidden")
    .eq("organization_id", org.id)
    .eq("hidden", false)
    .order("name");

  if (error) return { error: "Failed to load contacts" };

  const rows = [
    ["Name", "Title", "Email", "Phone"],
    ...(contacts ?? []).map((c) => [
      c.name ?? "",
      c.role_title ?? "",
      c.email ?? "",
      c.phone ?? "",
    ]),
  ];

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const filename = `${org.name.replace(/[^a-z0-9]/gi, "_")}_contacts.csv`;

  return { csv, filename };
}

/** Export org basic info as CSV. */
export async function exportOrgInfo(slug: string): Promise<{
  csv?: string;
  filename?: string;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  const { supabase } = auth.ctx;

  const { data: org } = await supabase
    .from("organizations")
    .select("name, city, province, website, phone, organization_type, fte")
    .eq("slug", slug)
    .single();

  if (!org) return { error: "Organization not found" };

  const rows = [
    ["Field", "Value"],
    ["Name", org.name ?? ""],
    ["Type", org.organization_type ?? ""],
    ["City", org.city ?? ""],
    ["Province", org.province ?? ""],
    ["Phone", org.phone ?? ""],
    ["Website", org.website ?? ""],
    ["FTE", org.fte?.toString() ?? ""],
  ];

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const filename = `${org.name.replace(/[^a-z0-9]/gi, "_")}_info.csv`;

  return { csv, filename };
}

/** Export an event as an ICS calendar file. */
export async function exportEventICS(slug: string): Promise<{
  ics?: string;
  filename?: string;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  const { supabase } = auth.ctx;

  const { data: event } = await supabase
    .from("events")
    .select("id, title, description, starts_at, ends_at, location, slug")
    .eq("slug", slug)
    .single();

  if (!event) return { error: "Event not found" };

  const normalizeTs = (s: string) =>
    s.endsWith("Z") || s.includes("+") ? s : s.replace(" ", "T") + "Z";

  const dtstart = event.starts_at ? toICSDate(new Date(normalizeTs(event.starts_at))) : toICSDate(new Date());
  const dtend = event.ends_at ? toICSDate(new Date(normalizeTs(event.ends_at))) : dtstart;

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CSC Website//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@csc.ca`,
    `DTSTAMP:${toICSDate(new Date())}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${icsEscape(event.title)}`,
    event.description ? `DESCRIPTION:${icsEscape(event.description)}` : "",
    event.location ? `LOCATION:${icsEscape(event.location)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  const filename = `${event.slug ?? event.title.replace(/[^a-z0-9]/gi, "_")}.ics`;
  return { ics, filename };
}

/** Export the member directory as CSV (visible fields only). */
export async function exportMembersDirectory(): Promise<{
  csv?: string;
  filename?: string;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  const { supabase } = auth.ctx;

  const { data: orgs, error } = await supabase
    .from("organizations")
    .select("name, city, province, website, organization_type")
    .eq("organization_type", "member")
    .order("name");

  if (error) return { error: "Failed to load directory" };

  const rows = [
    ["Name", "City", "Province", "Type", "Website"],
    ...(orgs ?? []).map((o) => [
      o.name ?? "",
      o.city ?? "",
      o.province ?? "",
      o.organization_type ?? "",
      o.website ?? "",
    ]),
  ];

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  return { csv, filename: "csc_members.csv" };
}

/** Export the partner directory as CSV. */
export async function exportPartnersDirectory(): Promise<{
  csv?: string;
  filename?: string;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  const { supabase } = auth.ctx;

  const { data: orgs, error } = await supabase
    .from("organizations")
    .select("name, city, province, website, primary_category")
    .eq("organization_type", "partner")
    .order("name");

  if (error) return { error: "Failed to load directory" };

  const rows = [
    ["Name", "Category", "City", "Province", "Website"],
    ...(orgs ?? []).map((o) => [
      o.name ?? "",
      o.primary_category ?? "",
      o.city ?? "",
      o.province ?? "",
      o.website ?? "",
    ]),
  ];

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  return { csv, filename: "csc_partners.csv" };
}

/**
 * Partner-only export: for each active member org that carries the partner's
 * primary category, return the assigned buyer contact plus key procurement
 * context — province, institution type, buying window, preferences.
 *
 * Fallback: if no buyer is assigned for the category, the org's primary
 * contact is used instead (flagged as "Primary Contact" in the Contact Type column).
 * Orgs that don't carry the category are excluded entirely.
 */
export async function exportMemberBuyersCSV(): Promise<{
  csv?: string;
  filename?: string;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userSb = auth.ctx.supabase as any;
  const db = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  // Get the user's active org memberships to check partner status + get category
  const { data: memberships } = await userSb
    .from("user_organizations")
    .select("organization:organizations(type, primary_category, certifications)")
    .eq("user_id", auth.ctx.userId)
    .eq("status", "active");

  // Must belong to a Vendor Partner org
  const isPartner = (memberships ?? []).some((m: any) => m.organization?.type === "Vendor Partner");
  if (!isPartner) return { error: "Partners only" };

  let partnerCategory: string | null = null;
  for (const row of (memberships ?? []) as any[]) {
    if (row.organization?.type === "Vendor Partner" && row.organization?.primary_category) {
      partnerCategory = row.organization.primary_category as string;
      break;
    }
  }
  if (!partnerCategory) return { error: "No primary category set on your partner profile." };

  // Fetch all active member orgs with procurement_info
  const { data: orgs, error: orgsError } = await db
    .from("organizations")
    .select("id, name, province, institution_type: benchmarking(institution_type), procurement_info")
    .eq("type", "Member")
    .eq("membership_status", "active")
    .is("archived_at", null)
    .order("name");

  if (orgsError) return { error: "Failed to load member data" };

  // Fetch all relevant contacts in one query (IDs we collect from procurement_info)
  const contactIdSet = new Set<string>();
  for (const org of (orgs ?? []) as any[]) {
    const pi = org.procurement_info as Record<string, unknown> | null;
    const buyers = Array.isArray(pi?.category_buyers) ? pi!.category_buyers as any[] : [];
    const entry = buyers.find((b: any) => b.category === partnerCategory);
    if (entry && Array.isArray(entry.contact_ids)) {
      for (const id of entry.contact_ids) contactIdSet.add(String(id));
    }
  }

  const contactById = new Map<string, { name: string; roleTitle: string | null; email: string | null; phone: string | null }>();
  if (contactIdSet.size > 0) {
    const { data: contactRows } = await db
      .from("contacts")
      .select("id, name, role_title, work_email, email, work_phone_number, phone")
      .in("id", Array.from(contactIdSet))
      .is("archived_at", null)
      .not("hidden", "eq", true);

    for (const c of (contactRows ?? []) as any[]) {
      contactById.set(String(c.id), {
        name: String(c.name ?? ""),
        roleTitle: (c.role_title as string | null) ?? null,
        email: (c.work_email || c.email || null) as string | null,
        phone: (c.work_phone_number || c.phone || null) as string | null,
      });
    }
  }

  const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const fmtMonth = (iso: string) => {
    if (iso.includes("-")) return MONTH_ABBR[parseInt(iso.split("-")[1] ?? "0") - 1] ?? iso;
    return iso.slice(0, 3);
  };

  // First pass: collect orgs that carry this category and identify those with no resolved buyer
  type OrgEntry = { org: any; pi: Record<string, unknown>; entry: any; hasBuyer: boolean };
  const qualifying: OrgEntry[] = [];
  const needsPrimaryContactOrgIds: string[] = [];

  for (const org of (orgs ?? []) as any[]) {
    const pi = org.procurement_info as Record<string, unknown> | null;
    if (!pi) continue;
    if (pi.show_categories === false) continue;

    const buyers = Array.isArray(pi.category_buyers) ? pi.category_buyers as any[] : [];
    const entry = buyers.find((b: any) => b.category === partnerCategory);
    if (!entry) continue; // doesn't carry this category

    const contactIds: string[] = Array.isArray(entry.contact_ids) ? entry.contact_ids.map(String) : [];
    const hasBuyer = contactIds.some((id) => contactById.has(id));

    qualifying.push({ org, pi, entry, hasBuyer });
    if (!hasBuyer) needsPrimaryContactOrgIds.push(String(org.id));
  }

  // Fetch primary contacts for orgs that had no assigned buyer
  const primaryContactByOrgId = new Map<string, { name: string; roleTitle: string | null; email: string | null; phone: string | null }>();
  if (needsPrimaryContactOrgIds.length > 0) {
    const { data: primaryRows } = await db
      .from("contacts")
      .select("id, organization_id, name, role_title, work_email, email, work_phone_number, phone")
      .in("organization_id", needsPrimaryContactOrgIds)
      .eq("is_primary", true)
      .is("archived_at", null)
      .not("hidden", "eq", true)
      .limit(needsPrimaryContactOrgIds.length);

    for (const c of (primaryRows ?? []) as any[]) {
      const orgId = String(c.organization_id);
      if (!primaryContactByOrgId.has(orgId)) {
        primaryContactByOrgId.set(orgId, {
          name: String(c.name ?? ""),
          roleTitle: (c.role_title as string | null) ?? null,
          email: (c.work_email || c.email || null) as string | null,
          phone: (c.work_phone_number || c.phone || null) as string | null,
        });
      }
    }
  }

  const rows: string[][] = [
    ["Organization", "Province", "Institution Type", "Contact Type", "Buyer Name", "Buyer Role", "Buyer Email", "Buyer Phone", "Buying Window", "Vendor Preferences"],
  ];

  for (const { org, pi, entry, hasBuyer } of qualifying) {
    // Resolve buyer contact
    const contactIds: string[] = Array.isArray(entry.contact_ids) ? entry.contact_ids.map(String) : [];
    let contactType = "Category Buyer";
    let buyerName = "", buyerRole = "", buyerEmail = "", buyerPhone = "";

    if (hasBuyer) {
      for (const id of contactIds) {
        const c = contactById.get(id);
        if (c) { buyerName = c.name; buyerRole = c.roleTitle ?? ""; buyerEmail = c.email ?? ""; buyerPhone = c.phone ?? ""; break; }
      }
    } else {
      // Fallback: use the org's primary contact
      const primary = primaryContactByOrgId.get(String(org.id));
      if (primary) {
        contactType = "Primary Contact";
        buyerName = primary.name;
        buyerRole = primary.roleTitle ?? "";
        buyerEmail = primary.email ?? "";
        buyerPhone = primary.phone ?? "";
      }
      // If no primary either, row still included with empty contact fields
    }

    // Buying window (respect visibility flag)
    let buyingWindow = "";
    if (pi.show_buying_cycle !== false) {
      const bc = pi.buying_cycle as Record<string, unknown> | null | undefined;
      if (bc?.rfp_start && bc?.rfp_end) buyingWindow = `${fmtMonth(String(bc.rfp_start))} – ${fmtMonth(String(bc.rfp_end))}`;
      else if (bc?.rfp_start) buyingWindow = `From ${fmtMonth(String(bc.rfp_start))}`;
      else if (bc?.fiscal_year_start) buyingWindow = `FY starts ${fmtMonth(String(bc.fiscal_year_start))}`;
    }

    // Vendor preferences (respect visibility flag)
    let prefs = "";
    if (pi.show_certifications !== false && Array.isArray(pi.preferred_certifications)) {
      prefs = (pi.preferred_certifications as string[]).join("; ");
    }

    // Institution type — benchmarking is a joined array; take first row
    const benchRows = Array.isArray(org.institution_type) ? org.institution_type : [];
    const instType = (benchRows[0] as any)?.institution_type ?? "";

    rows.push([
      org.name ?? "",
      org.province ?? "",
      instType,
      contactType,
      buyerName,
      buyerRole,
      buyerEmail,
      buyerPhone,
      buyingWindow,
      prefs,
    ]);
  }

  if (rows.length === 1) return { error: `No members carry ${partnerCategory} in their procurement profile yet.` };

  const year = new Date().getFullYear();
  const categorySlug = partnerCategory.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  return { csv, filename: `csc-${categorySlug}-buyers-${year}.csv` };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function icsEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toICSDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}
