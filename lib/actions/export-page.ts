"use server";

import { requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { PUBLIC_LISTABLE_ORG_STATUSES, ORG_ACCESS_ACTIVE_STATUSES } from "@/lib/membership/status";
import { getOrgPageViewerContext } from "@/lib/visibility/viewer";
import { getOrganizationForViewer } from "@/lib/visibility/data";
import { isVisibleTo } from "@/lib/contacts/visibility";

/**
 * Export contacts for an org as CSV rows — exactly the contacts the caller can
 * see on that org's page, resolved by the same reader the page uses.
 *
 * This used to query `contacts` through the caller's own session client. That
 * table has no public SELECT policy (the PII fix in
 * 20260723220000_scope_contacts_select_to_service_role.sql); the only surviving
 * policy is "your own org". So on anyone else's org page RLS filtered every row
 * away and returned `error: null`, and the button handed over a file containing
 * nothing but the header — no error, no explanation. Meanwhile the page beside
 * it was rendering those same contacts in full, because it reads through
 * getOrganizationForViewer (admin client + field masking).
 *
 * Going through getOrganizationForViewer makes the file and the screen one
 * answer. Masking still applies — an export can't reveal what the page won't.
 */
export async function exportOrgContacts(slug: string): Promise<{
  csv?: string;
  filename?: string;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  const { effectiveViewer } = await getOrgPageViewerContext(slug);
  const { organization, contacts } = await getOrganizationForViewer(slug, effectiveViewer);

  if (!organization) return { error: "Organization not found" };

  // A masked-away contact still comes back as a row — the mask nulls the
  // fields, it doesn't drop the person. One partner exporting another
  // partner's page hits exactly that (contact PII between vendors is withheld
  // outright, not even teased), so drop rows the viewer can read nothing from
  // rather than handing over a file of bare commas.
  const exportable = contacts
    .map((c) => [
      c.name ?? "",
      c.role_title ?? "",
      c.work_email || c.email || "",
      c.work_phone_number || c.phone || "",
    ])
    .filter(([name, , email, phone]) => name || email || phone);

  // Empty is a real answer here — the org hid its contact section, everyone
  // there opted out, this viewer isn't entitled to any of it, or there's simply
  // nobody on file. Say so instead of downloading a header-only file that reads
  // as a broken button.
  if (exportable.length === 0) {
    return { error: `No contact details are available to you for ${organization.name}.` };
  }

  const rows = [["Name", "Title", "Email", "Phone"], ...exportable];

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  const filename = `${organization.name.replace(/[^a-z0-9]/gi, "_")}_contacts.csv`;

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
    .select("name, city, province, website, type")
    .eq("type", "Member")
    .in("membership_status", PUBLIC_LISTABLE_ORG_STATUSES)
    .is("archived_at", null)
    .eq("is_test", false)
    .order("name");

  if (error) return { error: "Failed to load directory" };

  const rows = [
    ["Name", "City", "Province", "Type", "Website"],
    ...(orgs ?? []).map((o) => [
      o.name ?? "",
      o.city ?? "",
      o.province ?? "",
      o.type ?? "",
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
    .eq("type", "Vendor Partner")
    .in("membership_status", PUBLIC_LISTABLE_ORG_STATUSES)
    .is("archived_at", null)
    .eq("is_test", false)
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
 * Partner-only export: the full visible member directory (same "visible"
 * definition as the public /members page — active/reactivated, not
 * archived, not a test org), one row per PERSON at each member — every
 * non-hidden, non-archived contact, not just the primary. Unlike
 * exportMemberBuyersCSV (scoped to the partner's own category), this is the
 * literal "give me everyone" list a partner asked for.
 *
 * A member with zero eligible contacts (all hidden, or none on file) still
 * gets exactly one row with blank contact fields — organizations have no
 * visibility opt-out of their own directory listing, only individual people
 * do, so the org stays discoverable even when every person there has opted
 * out. Hidden contacts are simply never in the pool a row can be built from.
 */
export async function exportFullMemberDirectoryCSV(): Promise<{
  csv?: string;
  filename?: string;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userSb = auth.ctx.supabase as any;
  const { data: memberships } = await userSb
    .from("user_organizations")
    .select("role, organization:organizations(type)")
    .eq("user_id", auth.ctx.userId)
    .eq("status", "active");

  const isPartnerAdmin = (memberships ?? []).some(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (m: any) => m.organization?.type === "Vendor Partner" && m.role === "org_admin"
  );
  // CSC staff too — they field the "can you send me the member list" requests,
  // and a gate that locks out the only people who can answer one just moves the
  // work to a manual export. They already see every contact on every org page.
  const isCscAdmin = ["admin", "super_admin"].includes(auth.ctx.globalRole ?? "");
  if (!isPartnerAdmin && !isCscAdmin) return { error: "Partner org admin access required" };

  // Admin client: this crosses into contacts on orgs the partner has no
  // membership in, which is exactly what a directory export needs to do —
  // the RLS policy on contacts (correctly) only covers your own org.
  const db = createAdminClient();

  // ⛔ Entitlement, not public listing. This used to filter on
  // PUBLIC_LISTABLE_ORG_STATUSES (active/reactivated), which silently dropped
  // every member in grace — 20 of 52 stores and 181 of 371 people on the day
  // this was found, because renewals run Aug–Oct and grace is where a member
  // sits while theirs is in flight. A partner pays for the member list; a
  // store being late on its invoice is not a reason to withhold it.
  const { data: orgs, error: orgsError } = await db
    .from("organizations")
    .select("id, name, city, province, website")
    .eq("type", "Member")
    .in("membership_status", ORG_ACCESS_ACTIVE_STATUSES)
    .is("archived_at", null)
    .eq("is_test", false)
    .order("name");

  if (orgsError) return { error: "Failed to load directory" };
  if (!orgs || orgs.length === 0) return { error: "No visible members found." };

  const orgIds = orgs.map((o) => o.id);
  // ⛔ Consent is per person and it is THEIRS. Filtering on the legacy `hidden`
  // boolean alone only worked because setMyDirectoryVisibility happens to keep
  // the two in step; any other writer of either column reintroduces the drift,
  // and a CSV already in a vendor's CRM cannot be recalled. So ask
  // lib/contacts/visibility.ts, which is the one place that rule lives.
  // Viewer "member" is the right audience: the choice partners fall under is
  // literally labelled "Members and partners only".
  const { data: contactRows } = await db
    .from("contacts")
    .select("organization_id, name, role_title, work_email, email, work_phone_number, phone, hidden, directory_visibility")
    .in("organization_id", orgIds)
    .is("archived_at", null)
    .order("name");

  const contacts = (contactRows ?? []).filter((c) => isVisibleTo(c, "member"));

  const contactsByOrgId = new Map<string, { name: string; roleTitle: string; email: string; phone: string }[]>();
  for (const c of contacts) {
    if (!c.organization_id) continue;
    const list = contactsByOrgId.get(c.organization_id) ?? [];
    list.push({
      name: c.name ?? "",
      roleTitle: c.role_title ?? "",
      email: c.work_email || c.email || "",
      phone: c.work_phone_number || c.phone || "",
    });
    contactsByOrgId.set(c.organization_id, list);
  }

  const rows = [["Name", "City", "Province", "Website", "Contact Name", "Contact Title", "Contact Email", "Contact Phone"]];
  for (const o of orgs) {
    const orgContacts = contactsByOrgId.get(o.id) ?? [];
    const base = [o.name ?? "", o.city ?? "", o.province ?? "", o.website ?? ""];
    if (orgContacts.length === 0) {
      rows.push([...base, "", "", "", ""]);
      continue;
    }
    for (const c of orgContacts) {
      rows.push([...base, c.name, c.roleTitle, c.email, c.phone]);
    }
  }

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  return { csv, filename: `csc_members_full_${new Date().toISOString().slice(0, 10)}.csv` };
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
    // Same entitlement set as the full directory export — a member in grace is
    // still a buyer the partner paid to reach.
    .in("membership_status", ORG_ACCESS_ACTIVE_STATUSES)
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
      .select("id, name, role_title, work_email, email, work_phone_number, phone, hidden, directory_visibility")
      .in("id", Array.from(contactIdSet))
      .is("archived_at", null);

    // Same per-person consent rule as the full directory export — being named
    // as a category buyer by your org is not you agreeing to be listed.
    for (const c of ((contactRows ?? []) as any[]).filter((c) => isVisibleTo(c, "member"))) {
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
      .select("id, organization_id, name, role_title, work_email, email, work_phone_number, phone, hidden, directory_visibility")
      .in("organization_id", needsPrimaryContactOrgIds)
      .eq("is_primary", true)
      .is("archived_at", null)
      .limit(needsPrimaryContactOrgIds.length);

    for (const c of ((primaryRows ?? []) as any[]).filter((c) => isVisibleTo(c, "member"))) {
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

/** Returns whether the current user can export attendees for this event. */
export async function canExportEventAttendees(slug: string): Promise<boolean> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return false;

  const isAdmin = ["admin", "super_admin"].includes(auth.ctx.globalRole ?? "");
  if (isAdmin) return true;

  const db = createAdminClient();
  const { data: event } = await db
    .from("events")
    .select("created_by")
    .eq("slug", slug)
    .single();

  return !!event && event.created_by === auth.ctx.userId;
}

/** Export attendee list for an event as CSV.
 *  Accessible by the event creator and global admins only. */
export async function exportEventAttendees(slug: string): Promise<{
  csv?: string;
  filename?: string;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  const db = createAdminClient();
  const isAdmin = ["admin", "super_admin"].includes(auth.ctx.globalRole ?? "");

  // Resolve slug → event
  const { data: event } = await db
    .from("events")
    .select("id, title, slug, created_by")
    .eq("slug", slug)
    .single();

  if (!event) return { error: "Event not found" };
  if (!isAdmin && event.created_by !== auth.ctx.userId) {
    return { error: "Only the event host or a CSC admin can export attendees" };
  }

  const { data: regs, error: regsError } = await db
    .from("event_registrations")
    .select("user_id, status, registered_at")
    .eq("event_id", event.id)
    .in("status", ["registered", "promoted", "cancelled"])
    .order("registered_at", { ascending: true });

  if (regsError) return { error: regsError.message };

  const userIds = (regs ?? []).map((r: any) => r.user_id);

  const [profileResult, checkinResult] = await Promise.all([
    userIds.length > 0
      ? db.from("profiles").select("id, display_name, email").in("id", userIds)
      : Promise.resolve({ data: [] }),
    db
      .from("event_checkins")
      .select("user_id, checked_in_at")
      .eq("event_id", event.id)
      .in("user_id", userIds.length > 0 ? userIds : [""]),
  ]);

  const nameMap = new Map(
    (profileResult.data ?? []).map((p: any) => [p.id, { name: p.display_name ?? "", email: p.email ?? "" }])
  );
  const checkinMap = new Map<string, string | null>();
  for (const c of checkinResult.data ?? []) checkinMap.set(c.user_id, c.checked_in_at ?? null);

  const parseUTC = (s: string) =>
    new Date(s.endsWith("Z") || s.includes("+") ? s : s.replace(" ", "T") + "Z");

  const header = ["Name", "Email", "Status", "Registered At", "Checked In"];
  const rows = (regs ?? []).map((r: any) => {
    const profile = nameMap.get(r.user_id) ?? { name: "", email: "" };
    const checkinAt = checkinMap.get(r.user_id);
    return [
      profile.name,
      profile.email,
      r.status,
      parseUTC(r.registered_at).toLocaleString("en-CA"),
      checkinAt ? parseUTC(checkinAt).toLocaleString("en-CA") : checkinMap.has(r.user_id) ? "Yes" : "No",
    ];
  });

  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  const filename = `attendees-${event.slug ?? event.id}.csv`;
  return { csv, filename };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ── Partner market export ────────────────────────────────────────────────────

export async function exportPartnerMarketCSV(): Promise<{
  csv?: string;
  filename?: string;
  error?: string;
}> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { error: "Not authenticated" };

  // Get the calling user's partner org
  const db = createAdminClient() as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  const { data: memberships } = await (auth.ctx.supabase as any)
    .from("user_organizations")
    .select("organization_id, role, organization:organizations(id, name, type, primary_category)")
    .eq("user_id", auth.ctx.userId)
    .eq("status", "active");

  const partnerMembership = (memberships ?? []).find(
    (m: any) => m.organization?.type === "Vendor Partner" && m.role === "org_admin"
  );

  if (!partnerMembership) return { error: "Partner org admin access required" };

  const { getPartnerMarketData } = await import("@/lib/actions/partner-market");
  const result = await getPartnerMarketData(
    partnerMembership.organization_id,
    partnerMembership.organization?.primary_category ?? null
  );

  if (!result.success || !result.data) return { error: result.error ?? "Failed to load market data" };

  const { matches } = result.data;
  if (matches.length === 0) return { error: "No matching members found. Add categories to your profile first." };

  const CONF_LABEL: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };

  const rows = [
    ["Institution", "Province", "Matching Category", "Subcategories", "Confidence", "Buyer Name", "Buyer Title", "Buyer Email", "General Email"],
    ...matches.map(m => [
      m.orgName,
      m.province ?? "",
      m.matchingCategory,
      m.matchingSubcategories.join("; "),
      CONF_LABEL[m.confidence] ?? m.confidence,
      m.buyer?.name ?? m.primaryContact?.name ?? "",
      m.buyer?.roleTitle ?? m.primaryContact?.roleTitle ?? "",
      m.buyer?.email ?? m.primaryContact?.email ?? "",
      m.publicEmail ?? "",
    ]),
  ];

  const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const orgName = (partnerMembership.organization?.name as string ?? "partner").replace(/[^a-z0-9]/gi, "-").toLowerCase();
  return { csv, filename: `${orgName}-market-${new Date().toISOString().slice(0, 10)}.csv` };
}

function icsEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function toICSDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}
