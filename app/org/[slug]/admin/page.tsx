import Link from "next/link";
import { resolveOrgSlug } from "@/lib/org/resolve";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { PendingTransferBanner } from "@/components/org/admin/PendingTransferBanner";
import { CircleSyncStatusCard } from "@/components/circle/CircleSyncStatusCard";

interface OrgAdminPageProps {
  params: Promise<{ slug: string }>;
}

export default async function OrgAdminPage({ params }: OrgAdminPageProps) {
  const { slug } = await params;
  const org = await resolveOrgSlug(slug);
  if (!org) notFound();

  // Check for pending admin transfer
  const adminClient = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ac = adminClient as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pendingTransfer } = (await ac
    .from("admin_transfer_requests")
    .select("id, from_user_id, to_user_id, status, requested_at, timeout_at")
    .eq("organization_id", org.id)
    .eq("status", "pending")
    .maybeSingle()) as { data: any };

  // Get user counts for the summary card
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: userCount } = (await ac
    .from("user_organizations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)
    .eq("status", "active")) as { count: number | null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: conferencePeopleRows } = (await ac
    .from("conference_people")
    .select("conference_id, conference_instances!inner(id, name, year, edition_code)")
    .eq("organization_id", org.id)) as { data: any[] | null };

  const conferenceLinks = (conferencePeopleRows ?? [])
    .map((row) => {
      const conference = row.conference_instances as {
        id: string;
        name: string;
        year: number;
        edition_code: string;
      };
      return {
        id: conference.id,
        name: conference.name,
        year: conference.year,
        editionCode: conference.edition_code,
      };
    })
    .filter(
      (item, index, all) => all.findIndex((value) => value.id === item.id) === index
    );

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">
        {org.name} — Admin Dashboard
      </h1>

      {/* Pending Transfer Banner */}
      {pendingTransfer && (
        <PendingTransferBanner
          requestId={pendingTransfer.id}
          fromUserId={pendingTransfer.from_user_id}
          toUserId={pendingTransfer.to_user_id}
          timeoutAt={pendingTransfer.timeout_at}
          orgSlug={slug}
        />
      )}

      {/* Quick Links Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Users Card */}
        <Link
          href={`/org/${slug}/admin/users`}
          className="bg-white rounded-lg p-6 shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-[#EE2A2E]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Users</h2>
          </div>
          <p className="text-sm text-gray-500">
            {userCount ?? 0} active member{userCount !== 1 ? "s" : ""}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Invite, deactivate, and manage roles
          </p>
        </Link>

        {/* Transfer Admin Card */}
        <Link
          href={`/org/${slug}/admin/transfer`}
          className="bg-white rounded-lg p-6 shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">
              Transfer Admin
            </h2>
          </div>
          <p className="text-sm text-gray-500">
            {pendingTransfer ? "Transfer in progress" : "No pending transfer"}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Transfer admin rights to another user
          </p>
        </Link>

        {/* Org Profile Card */}
        <Link
          href={`/org/${slug}`}
          className="bg-white rounded-lg p-6 shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">
              Org Profile
            </h2>
          </div>
          <p className="text-sm text-gray-500">
            Status: {org.membership_status ?? "unknown"}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            View and edit organization details
          </p>
        </Link>

        {/* Circle Sync Status */}
        <CircleSyncStatusCard orgId={org.id} orgSlug={slug} />

        {/* Conference Roster Card */}
        <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-rose-50 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Conference Roster</h2>
          </div>
          {conferenceLinks.length === 0 ? (
            <p className="text-sm text-gray-500">No conference roster data yet.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {conferenceLinks.slice(0, 3).map((conference) => (
                <li key={conference.id}>
                  <Link
                    href={`/org/${slug}/conference/${conference.id}`}
                    className="text-sm text-[#EE2A2E] hover:text-[#D92327]"
                  >
                    {conference.name} ({conference.year} - {conference.editionCode})
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
