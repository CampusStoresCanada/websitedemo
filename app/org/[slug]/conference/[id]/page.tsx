import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isGlobalAdmin,
  requireOrgAdminOrSuperAdmin,
} from "@/lib/auth/guards";
import { resolveOrgSlug } from "@/lib/org/resolve";
import { assignConferenceEntitlement } from "@/lib/actions/conference-people";
import { computeConferenceReadiness } from "@/lib/conference/readiness";

type OrgConferencePersonRow = {
  id: string;
  user_id: string | null;
  source_type: string;
  source_id: string;
  person_kind: string;
  display_name: string | null;
  contact_email: string | null;
  assignment_status: string;
  entitlement_type: string | null;
  conference_entitlement_id: string | null;
  assigned_email_snapshot: string | null;
  schedule_scope: string;
  travel_mode: string | null;
  road_origin_address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  data_quality_flags: string[] | null;
  badge_print_status: string;
  checked_in_at: string | null;
  hotel_name: string | null;
  hotel_confirmation_code: string | null;
  admin_notes: string | null;
};

type OrgMember = {
  userId: string;
  displayName: string | null;
  email: string | null;
  role: string;
};

type ConferenceInstanceRow = {
  id: string;
  name: string;
  year: number;
  edition_code: string;
};

type MembershipRow = {
  user_id: string | null;
  role: string;
  status: string;
  profiles: { display_name: string | null } | { display_name: string | null }[] | null;
};

type SchedulerRunRow = {
  id: string;
};

export const dynamic = "force-dynamic";

export default async function OrgConferencePage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id: conferenceId } = await params;
  const org = await resolveOrgSlug(slug);
  if (!org) notFound();
  const orgId = org.id;
  const orgName = org.name;

  const auth = await requireOrgAdminOrSuperAdmin(orgId);
  if (!auth.ok) {
    redirect(auth.status === 401 ? "/login" : `/org/${slug}`);
  }

  const canSeeAdminNotes = isGlobalAdmin(auth.ctx.globalRole);
  const adminClient = createAdminClient();

  const [conferenceResult, peopleResult, membershipsResult, activeRunResult] =
    await Promise.all([
      adminClient
        .from("conference_instances")
        .select("id, name, year, edition_code")
        .eq("id", conferenceId)
        .maybeSingle(),
      adminClient
        .from("conference_people")
        .select(
          "id, user_id, source_type, source_id, person_kind, display_name, contact_email, assignment_status, entitlement_type, conference_entitlement_id, assigned_email_snapshot, schedule_scope, travel_mode, road_origin_address, emergency_contact_name, emergency_contact_phone, data_quality_flags, badge_print_status, checked_in_at, hotel_name, hotel_confirmation_code, admin_notes"
        )
        .eq("conference_id", conferenceId)
        .eq("organization_id", orgId)
        .order("person_kind", { ascending: true })
        .order("display_name", { ascending: true }),
      adminClient
        .from("user_organizations")
        .select(
          "user_id, role, status, profiles!inner(display_name)"
        )
        .eq("organization_id", orgId)
        .eq("status", "active")
        .order("role", { ascending: true }),
      adminClient
        .from("scheduler_runs")
        .select("id")
        .eq("conference_id", conferenceId)
        .eq("run_mode", "active")
        .eq("status", "completed")
        .maybeSingle(),
    ]);

  const conference = conferenceResult.data as ConferenceInstanceRow | null;
  if (!conference) {
    return <main className="max-w-6xl mx-auto px-4 py-8">Conference not found.</main>;
  }

  const people = (peopleResult.data ?? []) as OrgConferencePersonRow[];
  const memberships = (membershipsResult.data ?? []) as unknown as MembershipRow[];
  const activeRun = activeRunResult.data as SchedulerRunRow | null;

  const memberUserIds = memberships
    .map((row) => row.user_id)
    .filter((userId): userId is string => Boolean(userId));
  let emailByUserId: Record<string, string> = {};
  if (memberUserIds.length > 0) {
    const { data: authUsers } = await adminClient.auth.admin.listUsers();
    emailByUserId = Object.fromEntries(
      (authUsers?.users ?? [])
        .filter((user) => memberUserIds.includes(user.id))
        .map((user) => [user.id, user.email ?? ""])
    );
  }

  const orgMembers: OrgMember[] = memberships
    .filter((row): row is MembershipRow & { user_id: string } => Boolean(row.user_id))
    .map((row) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        userId: row.user_id,
        displayName: profile?.display_name ?? null,
        email: emailByUserId[row.user_id] ?? null,
        role: row.role,
      };
    });

  const readinessRows = people
    .filter((row) => row.assignment_status !== "canceled")
    .map((row) => ({
      person: row,
      readiness: computeConferenceReadiness({
        personKind: row.person_kind,
        displayName: row.display_name,
        contactEmail: row.contact_email,
        assignmentStatus: row.assignment_status,
        travelMode: row.travel_mode,
        roadOriginAddress: row.road_origin_address,
        emergencyContactName: row.emergency_contact_name,
        emergencyContactPhone: row.emergency_contact_phone,
        dataQualityFlags: row.data_quality_flags,
      }),
    }));

  const notReadyCount = readinessRows.filter((row) => !row.readiness.isReady).length;
  const exhibitorRows = people.filter((row) => row.person_kind === "exhibitor");
  const unassignedEntitlements = people.filter(
    (row) =>
      row.source_type === "entitlement" &&
      (row.assignment_status === "unassigned" || row.assignment_status === "pending_user_activation")
  );

  async function assignToExistingUser(formData: FormData) {
    "use server";
    const entitlementId = String(formData.get("entitlement_id") ?? "");
    const entitlementType = String(formData.get("entitlement_type") ?? "delegate");
    const targetUserId = String(formData.get("target_user_id") ?? "");
    if (!entitlementId || !targetUserId) return;
    const result = await assignConferenceEntitlement(conferenceId, orgId, entitlementId, {
      entitlementType: entitlementType || "delegate",
      targetUserId,
    });
    if (result.success) {
      revalidatePath(`/org/${slug}/conference/${conferenceId}`);
    }
  }

  async function assignByInvite(formData: FormData) {
    "use server";
    const entitlementId = String(formData.get("entitlement_id") ?? "");
    const entitlementType = String(formData.get("entitlement_type") ?? "delegate");
    const targetEmail = String(formData.get("target_email") ?? "").trim().toLowerCase();
    if (!entitlementId || !targetEmail) return;
    const result = await assignConferenceEntitlement(conferenceId, orgId, entitlementId, {
      entitlementType: entitlementType || "delegate",
      targetEmail,
    });
    if (result.success) {
      revalidatePath(`/org/${slug}/conference/${conferenceId}`);
    }
  }

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">
            {conference.name} - {orgName}
          </h1>
          <p className="text-sm text-gray-600">Org Conference Roster</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/conference/${conference.year}/${conference.edition_code}`}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            Open Conference Hub
          </Link>
          <Link
            href={`/org/${slug}/admin`}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            Back to Org Admin
          </Link>
          <Link
            href={`/conference/${conference.year}/${conference.edition_code}/schedule`}
            className="rounded-md bg-[#D60001] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001]"
          >
            Open Schedule + Swaps
          </Link>
        </div>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Org Readiness</h2>
        <p className="mt-2 text-sm text-gray-700">
          {notReadyCount === 0
            ? "All assigned conference people are ready."
            : `${notReadyCount} people need required data updates before conference readiness.`}
        </p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Exhibitor Shared Schedule Context</h2>
        <p className="mt-2 text-sm text-gray-700">
          Active run: {activeRun?.id ?? "Not published"} | Exhibitor records:{" "}
          {exhibitorRows.length}
        </p>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Unassigned Purchased Entitlements</h2>
        {unassignedEntitlements.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No unassigned or pending entitlements.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {unassignedEntitlements.map((row) => {
              const entitlementId = row.conference_entitlement_id ?? row.source_id;
              const entitlementType = row.entitlement_type ?? "delegate";
              return (
                <div key={row.id} className="rounded-lg border border-gray-200 p-3">
                  <p className="text-sm text-gray-800">
                    Entitlement <span className="font-mono text-xs">{entitlementId}</span> (
                    {entitlementType}) - {row.assignment_status}
                  </p>
                  {row.assigned_email_snapshot ? (
                    <p className="mt-1 text-xs text-gray-600">
                      Pending email: {row.assigned_email_snapshot}
                    </p>
                  ) : null}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <form action={assignToExistingUser} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="entitlement_id" value={entitlementId} />
                      <input type="hidden" name="entitlement_type" value={entitlementType} />
                      <select
                        name="target_user_id"
                        required
                        className="min-w-[220px] rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">Assign to existing org user</option>
                        {orgMembers.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.displayName ?? member.email ?? member.userId} ({member.role})
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Assign
                      </button>
                    </form>
                    <form action={assignByInvite} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="entitlement_id" value={entitlementId} />
                      <input type="hidden" name="entitlement_type" value={entitlementType} />
                      <input
                        type="email"
                        name="target_email"
                        required
                        placeholder="Invite by email"
                        className="min-w-[220px] rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      />
                      <button
                        type="submit"
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Invite + Assign
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-semibold text-gray-900">Conference People (Org Scope)</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Person</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Kind</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Assignment</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Badge</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Check-in</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Readiness</th>
                {canSeeAdminNotes ? (
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Admin Notes</th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {readinessRows.map(({ person, readiness }) => (
                <tr key={person.id}>
                  <td className="px-3 py-2 text-gray-900">
                    {person.display_name ?? person.contact_email ?? person.id}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{person.person_kind}</td>
                  <td className="px-3 py-2 text-gray-700">{person.assignment_status}</td>
                  <td className="px-3 py-2 text-gray-700">{person.badge_print_status}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {person.checked_in_at ? "Checked in" : "Not checked in"}
                  </td>
                  <td className="px-3 py-2 text-gray-700">
                    {readiness.isReady
                      ? "Ready"
                      : `${readiness.missing.length + readiness.blockers.length} item(s)`}
                  </td>
                  {canSeeAdminNotes ? (
                    <td className="px-3 py-2 text-gray-700">{person.admin_notes ?? "—"}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
