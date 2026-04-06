import { notFound } from "next/navigation";
import { getViewerContext } from "@/lib/visibility/viewer";
import { getOrganizationForViewer } from "@/lib/visibility/data";
import { createAdminClient } from "@/lib/supabase/admin";
import MemberProfile from "@/components/org/MemberProfile";
import PartnerProfile from "@/components/org/PartnerProfile";

type OrgConferenceAttendanceRow = {
  id: string;
  conferenceId: string;
  conferenceName: string;
  conferenceYear: number;
  conferenceEditionCode: string;
  conferenceStartDate: string | null;
  organizationId: string;
  sourceType: string;
  sourceId: string;
  personKind: string;
  displayName: string | null;
  contactEmail: string | null;
  userId: string | null;
  assignmentStatus: string;
  entitlementId: string | null;
  entitlementType: string | null;
  badgeStatus: string;
  checkedInAt: string | null;
};

type RawConferenceAttendanceRow = {
  id: string;
  conference_id: string;
  organization_id: string;
  source_type: string;
  source_id: string;
  person_kind: string;
  display_name: string | null;
  contact_email: string | null;
  user_id: string | null;
  assignment_status: string;
  conference_entitlement_id: string | null;
  entitlement_type: string | null;
  badge_print_status: string;
  checked_in_at: string | null;
  conference_instances: {
    name: string;
    year: number;
    edition_code: string;
    start_date: string | null;
  } | null;
};

type OrgAssignableUser = {
  userId: string;
  displayName: string | null;
  email: string | null;
  role: string;
};

// Viewer-dependent masking means different responses per viewer
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function OrgProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const viewer = await getViewerContext();
  const { organization, contacts, brandColors, benchmarking, allBenchmarking } =
    await getOrganizationForViewer(slug, viewer);

  if (!organization) {
    notFound();
  }

  const canViewConferenceAttendance = viewer.viewerLevel !== "public";
  let conferenceAttendance: OrgConferenceAttendanceRow[] = [];
  let orgAssignableUsers: OrgAssignableUser[] = [];

  if (canViewConferenceAttendance) {
    const adminClient = createAdminClient();
    const { data: rows } = (await adminClient
      .from("conference_people")
      .select(
        "id, conference_id, organization_id, source_type, source_id, person_kind, display_name, contact_email, user_id, assignment_status, conference_entitlement_id, entitlement_type, badge_print_status, checked_in_at, conference_instances!inner(name, year, edition_code, start_date)"
      )
      .eq("organization_id", organization.id)
      .neq("assignment_status", "canceled")
      .order("updated_at", { ascending: false })) as {
      data: RawConferenceAttendanceRow[] | null;
    };

    const { data: orgMemberships } = await adminClient
      .from("user_organizations")
      .select("user_id, role")
      .eq("organization_id", organization.id)
      .eq("status", "active");

    const userIds = Array.from(
      new Set(
        [
          ...(rows ?? []).map((row) => row.user_id),
          ...((orgMemberships ?? []).map((row) => row.user_id as string | null)),
        ].filter((value): value is string => Boolean(value))
      )
    );
    const profileNameById = new Map<string, string | null>();
    const emailById = new Map<string, string | null>();

    if (userIds.length > 0) {
      const { data: profiles } = await adminClient
        .from("profiles")
        .select("id, display_name")
        .in("id", userIds);
      for (const profile of profiles ?? []) {
        profileNameById.set(profile.id as string, (profile.display_name as string | null) ?? null);
      }

      const authUsersResult = await adminClient.auth.admin.listUsers();
      for (const user of authUsersResult.data?.users ?? []) {
        if (!userIds.includes(user.id)) continue;
        emailById.set(user.id, user.email ?? null);
      }
    }

    conferenceAttendance = (rows ?? []).map((row) => ({
      id: row.id,
      conferenceId: row.conference_id,
      conferenceName: row.conference_instances?.name ?? "Conference",
      conferenceYear: row.conference_instances?.year ?? 0,
      conferenceEditionCode: row.conference_instances?.edition_code ?? "",
      conferenceStartDate: row.conference_instances?.start_date ?? null,
      organizationId: row.organization_id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      personKind: row.person_kind,
      displayName:
        row.display_name ??
        (row.user_id ? (profileNameById.get(row.user_id) ?? null) : null),
      contactEmail:
        row.contact_email ??
        (row.user_id ? (emailById.get(row.user_id) ?? null) : null),
      userId: row.user_id,
      assignmentStatus: row.assignment_status,
      entitlementId: row.conference_entitlement_id ?? null,
      entitlementType: row.entitlement_type ?? null,
      badgeStatus: row.badge_print_status,
      checkedInAt: row.checked_in_at,
    }));

    orgAssignableUsers = (orgMemberships ?? [])
      .map((membership) => {
        const userId = membership.user_id as string | null;
        if (!userId) return null;
        return {
          userId,
          displayName: profileNameById.get(userId) ?? null,
          email: emailById.get(userId) ?? null,
          role: (membership.role as string | null) ?? "member",
        };
      })
      .filter((row): row is OrgAssignableUser => Boolean(row))
      .sort((a, b) => {
        const aName = (a.displayName ?? a.email ?? a.userId).toLowerCase();
        const bName = (b.displayName ?? b.email ?? b.userId).toLowerCase();
        return aName.localeCompare(bName);
      });
  }

  console.log(`[org/${slug}] viewer=${viewer.viewerLevel} contacts sample: ${JSON.stringify(contacts.slice(0,3).map(c => ({ id: c.id, name: c.name, circle_id: (c as Record<string,unknown>).circle_id })))}`);

  // Render different layouts based on organization type
  if (organization.type === "Member") {
    return (
      <MemberProfile
        organization={organization}
        contacts={contacts}
        brandColors={brandColors}
        benchmarking={benchmarking}
        allBenchmarking={allBenchmarking}
        viewerLevel={viewer.viewerLevel}
        conferenceAttendance={conferenceAttendance}
        orgAssignableUsers={orgAssignableUsers}
      />
    );
  }

  // Partner/Vendor layout
  return (
    <PartnerProfile
      organization={organization}
      contacts={contacts}
      brandColors={brandColors}
      viewerLevel={viewer.viewerLevel}
      conferenceAttendance={conferenceAttendance}
      orgAssignableUsers={orgAssignableUsers}
    />
  );
}
