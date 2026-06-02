import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMyPendingChanges } from "@/lib/actions/pending-content-changes";
import { getUserBookmarks } from "@/lib/actions/bookmarks";
import MyPendingChanges from "@/components/me/MyPendingChanges";

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

  const [profileResult, orgResult, contactResult, mappingResult, pendingChangesResult, bookmarksResult] =
    await Promise.all([
      db.from("profiles").select("display_name, global_role").eq("id", userId).maybeSingle(),
      db
        .from("user_organizations")
        .select("id, role, organization:organizations(id, name, slug, type)")
        .eq("user_id", userId)
        .eq("status", "active"),
      // Fix: check both email and work_email
      userEmail
        ? (db as any)
            .from("contacts")
            .select("id, name, role_title, circle_id, work_phone_number")
            .or(`email.eq.${userEmail},work_email.eq.${userEmail}`)
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      // Get Circle public_uid for direct profile link
      (db as any)
        .from("circle_member_mapping")
        .select("circle_public_uid")
        .eq("supabase_user_id", userId)
        .not("circle_public_uid", "is", null)
        .limit(1)
        .maybeSingle(),
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
    organization: { id: string; name: string; slug: string; type: string };
  }>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contact = (contactResult as any).data as {
    id: string;
    name: string | null;
    role_title: string | null;
    circle_id: number | null;
    work_phone_number: string | null;
  } | null;

  const profile = profileResult.data as { display_name: string | null; global_role: string } | null;

  const displayName = profile?.display_name || contact?.name || userEmail?.split("@")[0] || "You";
  const roleTitle   = contact?.role_title ?? null;
  const circlePublicUid = (mappingResult as any)?.data?.circle_public_uid as string | null ?? null;
  const circleCommunityUrl = process.env.NEXT_PUBLIC_CIRCLE_COMMUNITY_URL ?? "https://memberspace.campusstores.ca";
  const circleProfileUrl = circlePublicUid
    ? `${circleCommunityUrl}/u/${circlePublicUid}`
    : null;

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

          {/* Circle profile link */}
          {circleProfileUrl && (
            <a
              href={circleProfileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:border-gray-300 hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              Edit profile
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
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
