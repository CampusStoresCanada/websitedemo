import { resolveOrgSlug } from "@/lib/org/resolve";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { OrgUserTable } from "@/components/org/admin/OrgUserTable";
import { InviteUserDialog } from "@/components/org/admin/InviteUserDialog";

interface OrgUsersPageProps {
  params: Promise<{ slug: string }>;
}

export interface OrgUserRow {
  userId: string;
  displayName: string | null;
  email: string | null;
  role: string;
  status: string;
  hidden: boolean;
  avatarUrl: string | null;
  membershipId: string;
}

interface MembershipProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface MembershipRow {
  id: string;
  user_id: string;
  role: string;
  status: string;
  hidden: boolean;
  profiles: MembershipProfile | MembershipProfile[] | null;
}

export default async function OrgUsersPage({ params }: OrgUsersPageProps) {
  const { slug } = await params;
  const org = await resolveOrgSlug(slug);
  if (!org) notFound();

  const adminClient = createAdminClient();

  // Fetch all user_organizations for this org, joined with profiles
  const { data: membershipsRaw, error } = await adminClient
    .from("user_organizations")
    .select(
      `
      id,
      user_id,
      role,
      status,
      hidden,
      profiles!inner(
        id,
        display_name,
        avatar_url
      )
    `
    )
    .eq("organization_id", org.id)
    .order("role", { ascending: true })
    .order("status", { ascending: true });

  if (error) {
    console.error("[OrgUsersPage] Failed to fetch memberships:", error);
  }

  const memberships: MembershipRow[] = (membershipsRaw ?? []) as unknown as MembershipRow[];

  // Also fetch auth emails for each user (profiles don't always have emails)
  const userIds = memberships.map((m) => m.user_id);
  let emailMap: Record<string, string> = {};

  if (userIds.length > 0) {
    const { data: authUsers } = await adminClient.auth.admin.listUsers();
    if (authUsers?.users) {
      emailMap = Object.fromEntries(
        authUsers.users
          .filter((u) => userIds.includes(u.id))
          .map((u) => [u.id, u.email ?? ""])
      );
    }
  }

  // Map to flat array for the client component
  const users: OrgUserRow[] = memberships.map((m) => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;

    return {
      userId: m.user_id,
      displayName: profile?.display_name ?? null,
      email: emailMap[m.user_id] ?? null,
      role: m.role,
      status: m.status,
      hidden: m.hidden ?? false,
      avatarUrl: profile?.avatar_url ?? null,
      membershipId: m.id,
    };
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Users — {org.name}
        </h1>
        <InviteUserDialog orgId={org.id} />
      </div>

      <OrgUserTable users={users} orgId={org.id} />
    </div>
  );
}
