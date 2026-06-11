import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMyPendingChanges } from "@/lib/actions/pending-content-changes";
import { getUserBookmarks } from "@/lib/actions/bookmarks";
import MyPendingChanges from "@/components/me/MyPendingChanges";
import SelfEditModal, { type OrgEditData } from "@/components/me/SelfEditModal";
import type { ProcurementInfo } from "@/lib/types/procurement";
import { getMemberSupplierData, type SupplierData } from "@/lib/actions/member-suppliers";
import { getPartnerMarketData, checkNudgeCooldown, type MarketData } from "@/lib/actions/partner-market";
import MemberSupplierPanel from "@/components/org/MemberSupplierPanel";
import PartnerMarketPanel from "@/components/org/PartnerMarketPanel";

export const metadata = {
  title: "My Account | Campus Stores Canada",
};

const ORG_ROLE_LABELS: Record<string, string> = {
  org_admin: "Admin",
  member:    "Member",
  partner:   "Partner",
};

export default async function MyAccountPage() {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const db = createAdminClient();
  const userId = auth.ctx.userId;
  const userEmail = auth.ctx.userEmail;

  const [profileResult, orgResult, allContactsResult, pendingChangesResult, bookmarksResult] =
    await Promise.all([
      db.from("profiles").select("display_name, global_role").eq("id", userId).maybeSingle(),
      db
        .from("user_organizations")
        .select("id, role, organization:organizations(id, name, slug, type, primary_category)")
        .eq("user_id", userId)
        .eq("status", "active"),
      // Fetch all contact rows for this user across all orgs
      userEmail
        ? (db as any)
            .from("contacts")
            .select("id, name, role_title, email, work_email, work_phone_number, phone, hidden, organization_id, circle_id")
            .or(`email.eq.${userEmail},work_email.eq.${userEmail}`)
            .is("archived_at", null)
        : Promise.resolve({ data: [] }),
      isGlobalAdmin(auth.ctx.globalRole)
        ? getMyPendingChanges()
        : Promise.resolve({ success: true, changes: [] }),
      getUserBookmarks(),
    ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: conferencePeopleRows } = await (db as any)
    .from("conference_people")
    .select("conference_id, conference_instances!inner(id, name, year, edition_code)")
    .eq("user_id", userId) as { data: any[] | null };

  const { data: myRegistrationRows } = await db
    .from("event_registrations")
    .select("id")
    .eq("user_id", userId)
    .in("status", ["registered", "waitlisted", "promoted"]) as { data: any[] | null };

  const { data: myCreatedEventRows } = await db
    .from("events")
    .select("id")
    .eq("created_by", userId) as { data: any[] | null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orgs = (orgResult.data ?? []) as Array<{
    id: string;
    role: string;
    organization: { id: string; name: string; slug: string; type: string; primary_category: string | null };
  }>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allContacts = ((allContactsResult as any).data ?? []) as Array<{
    id: string;
    name: string | null;
    role_title: string | null;
    email: string | null;
    work_email: string | null;
    work_phone_number: string | null;
    phone: string | null;
    hidden: boolean | null;
    organization_id: string | null;
    circle_id: number | null;
  }>;

  // Contact used for display (first found, for header name/role)
  const contact = allContacts[0] ?? null;

  // Fetch procurement_info for member-type orgs
  const memberOrgIds = orgs
    .filter((o) => o.organization.type === "Member")
    .map((o) => o.organization.id);

  const procurementByOrgId: Record<string, ProcurementInfo> = {};
  if (memberOrgIds.length > 0) {
    const { data: procRows } = await db
      .from("organizations")
      .select("id, procurement_info")
      .in("id", memberOrgIds) as { data: Array<{ id: string; procurement_info: unknown }> | null };
    for (const row of procRows ?? []) {
      if (row.procurement_info) {
        procurementByOrgId[row.id] = row.procurement_info as ProcurementInfo;
      }
    }
  }

  // Build per-org edit data — only orgs where the user has a contact row
  const contactByOrgId = new Map(allContacts.map((c) => [c.organization_id, c]));
  const orgEditData: OrgEditData[] = orgs
    .filter((o) => contactByOrgId.has(o.organization.id))
    .map((o) => ({
      orgId: o.organization.id,
      orgName: o.organization.name,
      orgType: o.organization.type,
      role: o.role,
      contact: contactByOrgId.get(o.organization.id)!,
      procurementInfo: procurementByOrgId[o.organization.id] ?? null,
    }));

  // ── Possible Suppliers — for each Member org where this user has a contact,
  // show partners matched to their personal buying-category assignments
  // (mirrors MemberSupplierPanel on the org page, consolidated here).
  const supplierSections: Array<{ orgId: string; orgName: string; data: SupplierData }> = [];
  for (const org of orgEditData) {
    if (org.orgType !== "Member") continue;
    const result = await getMemberSupplierData(userEmail ?? null, org.orgId);
    if (result.success && result.data) {
      supplierSections.push({ orgId: org.orgId, orgName: org.orgName, data: result.data });
    }
  }

  // ── Your Market — for each Vendor Partner org where this user has a contact,
  // show member stores matched to the org's categories (org-level, not personal).
  const marketSections: Array<{
    orgId: string;
    orgName: string;
    data: MarketData;
    canNudge: boolean;
    nudgeAvailableAt: string | null;
  }> = [];
  for (const o of orgs) {
    if (o.organization.type !== "Vendor Partner") continue;
    if (!contactByOrgId.has(o.organization.id)) continue;
    const result = await getPartnerMarketData(o.organization.id, o.organization.primary_category);
    if (!result.success || !result.data) continue;

    let canNudge = false;
    let nudgeAvailableAt: string | null = null;
    if (o.role === "org_admin") {
      const cooldown = await checkNudgeCooldown();
      canNudge = cooldown.canSend;
      nudgeAvailableAt = cooldown.availableAt ?? null;
    }

    marketSections.push({
      orgId: o.organization.id,
      orgName: o.organization.name,
      data: result.data,
      canNudge,
      nudgeAvailableAt,
    });
  }

  const profile = profileResult.data as { display_name: string | null; global_role: string } | null;

  const displayName = profile?.display_name || contact?.name || userEmail?.split("@")[0] || "You";
  const roleTitle   = contact?.role_title ?? null;
  const initials = displayName
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const myConferenceLinks = (conferencePeopleRows ?? [])
    .map((row: any) => ({
      id:         (row.conference_instances as any)?.id,
      name:       (row.conference_instances as any)?.name,
      year:       (row.conference_instances as any)?.year,
      editionCode:(row.conference_instances as any)?.edition_code,
    }))
    .filter((item, index, all) => all.findIndex((x) => x.id === item.id) === index);

  const eventCount      = (myRegistrationRows ?? []).length + (myCreatedEventRows ?? []).length;
  const bookmarkCount   = bookmarksResult.bookmarks?.length ?? 0;
  const conferenceCount = myConferenceLinks.length;

  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-4">

      {/* ── Profile header ── */}
      <div className="rounded-2xl bg-white border border-gray-200 p-6">
        <div className="flex items-start gap-5">

          {/* Avatar */}
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold flex-shrink-0 select-none"
            style={{ backgroundColor: "#EE2A2E" }}
          >
            {initials}
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-[#1A1A1A] leading-tight">{displayName}</h1>
            {roleTitle && (
              <p className="text-sm text-gray-500 mt-0.5">{roleTitle}</p>
            )}
            <p className="text-xs text-gray-400 mt-0.5">{userEmail}</p>

            {/* Org badges */}
            {orgs.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {orgs.map((org) => (
                  <Link
                    key={org.id}
                    href={`/org/${org.organization?.slug}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                  >
                    {org.organization?.name}
                    <span className="text-gray-300 mx-0.5">·</span>
                    {ORG_ROLE_LABELS[org.role] ?? org.role}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Self-edit — only shown when there are editable contact rows */}
          {orgEditData.length > 0 && (
            <SelfEditModal orgEditData={orgEditData} />
          )}
        </div>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-3 gap-4">
        <Link
          href="/me/events"
          className="group rounded-2xl bg-white border border-gray-200 p-5 hover:border-[#EE2A2E]/30 hover:shadow-sm transition-all"
        >
          <p className="text-3xl font-bold text-[#1A1A1A] group-hover:text-[#EE2A2E] transition-colors tabular-nums">
            {eventCount}
          </p>
          <p className="text-xs text-gray-400 mt-1 uppercase tracking-wider">Events</p>
        </Link>

        <Link
          href="/me/bookmarks"
          className="group rounded-2xl bg-white border border-gray-200 p-5 hover:border-[#EE2A2E]/30 hover:shadow-sm transition-all"
        >
          <p className="text-3xl font-bold text-[#1A1A1A] group-hover:text-[#EE2A2E] transition-colors tabular-nums">
            {bookmarkCount}
          </p>
          <p className="text-xs text-gray-400 mt-1 uppercase tracking-wider">Bookmarks</p>
        </Link>

        <div className="rounded-2xl bg-white border border-gray-200 p-5">
          <p className="text-3xl font-bold text-[#1A1A1A] tabular-nums">{conferenceCount}</p>
          <p className="text-xs text-gray-400 mt-1 uppercase tracking-wider">Conferences</p>
        </div>
      </div>

      {/* ── Organizations ── */}
      {orgs.length > 0 && (
        <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden">
          <p className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
            Your Organizations
          </p>
          {orgs.map((org, i) => (
            <div
              key={org.id}
              className={`flex items-center justify-between px-5 py-4 ${i > 0 ? "border-t border-gray-100" : ""}`}
            >
              <div>
                <p className="text-sm font-semibold text-[#1A1A1A]">{org.organization?.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {ORG_ROLE_LABELS[org.role] ?? org.role}
                  {org.organization?.type ? ` · ${org.organization.type}` : ""}
                </p>
              </div>
              {org.organization?.slug && (
                <Link
                  href={`/org/${org.organization.slug}`}
                  className="flex items-center gap-1 text-xs font-medium text-[#EE2A2E] hover:text-[#D92327] transition-colors"
                >
                  Open
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                  </svg>
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Possible Suppliers (Member orgs — matched to your buying categories) ── */}
      {supplierSections.map((section) => (
        <MemberSupplierPanel
          key={section.orgId}
          data={section.data}
          orgName={supplierSections.length > 1 ? section.orgName : undefined}
          anchorId={`my-suppliers-${section.orgId}`}
          containerClassName="rounded-2xl bg-white border border-gray-200 overflow-hidden"
          emptyStateContext="account"
        />
      ))}

      {/* ── Your Market (Vendor Partner orgs — member stores matched to your categories) ── */}
      {marketSections.map((section) => (
        <PartnerMarketPanel
          key={section.orgId}
          market={section.data}
          canNudge={section.canNudge}
          nudgeAvailableAt={section.nudgeAvailableAt}
          orgName={marketSections.length > 1 ? section.orgName : undefined}
          anchorId={`your-market-${section.orgId}`}
          containerClassName="rounded-2xl bg-white border border-gray-200 overflow-hidden"
        />
      ))}

      {/* ── Conferences ── */}
      {myConferenceLinks.length > 0 && (
        <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden">
          <p className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
            Conferences
          </p>
          {myConferenceLinks.map((conf: any, i: number) => (
            <div
              key={conf.id}
              className={`flex items-center justify-between px-5 py-4 ${i > 0 ? "border-t border-gray-100" : ""}`}
            >
              <div>
                <p className="text-sm font-semibold text-[#1A1A1A]">{conf.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{conf.year} · {conf.editionCode}</p>
              </div>
              <Link
                href={`/me/conference/${conf.id}`}
                className="flex items-center gap-1 text-xs font-medium text-[#EE2A2E] hover:text-[#D92327] transition-colors"
              >
                Open
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* ── Pending content changes (admins only) ── */}
      {(pendingChangesResult.changes?.length ?? 0) > 0 && (
        <div className="rounded-2xl bg-white border border-gray-200 overflow-hidden">
          <p className="px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
            Submitted Changes
          </p>
          <div className="px-5 py-4">
            <MyPendingChanges changes={pendingChangesResult.changes ?? []} />
          </div>
        </div>
      )}

    </main>
  );
}
