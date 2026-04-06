import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin, requireAdmin } from "@/lib/auth/guards";
import PeopleDirectory from "@/components/admin/PeopleDirectory";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export const metadata = { title: "People | Admin" };

export default async function PeopleAdminPage() {
  const auth = await requireAdmin();
  if (!auth.ok || !isSuperAdmin(auth.ctx.globalRole)) {
    return (
      <main className="text-center py-12 text-gray-500">
        Super admin access required.
      </main>
    );
  }

  const adminClient = createAdminClient();

  type ProfileWithOrgs = {
    id: string;
    display_name: string | null;
    global_role: string | null;
    created_at: string | null;
    user_organizations: Array<{
      organization_id: string;
      role: string;
      status: string;
      organizations: { id: string; name: string; slug: string } | null;
    }>;
  };

  // Load profiles with org memberships
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error -- nested Supabase select causes "type instantiation excessively deep" false positive
  const { data: rawProfiles } = await adminClient
    .from("profiles")
    .select(
      `id, display_name, global_role, created_at,
       user_organizations(organization_id, role, status, organizations(id, name, slug))`
    )
    .order("display_name");
  const profiles = (rawProfiles ?? []) as unknown as ProfileWithOrgs[];

  // Load auth emails
  const { data: authUsers } = await adminClient.auth.admin.listUsers();
  const emailMap: Record<string, string> = {};
  if (authUsers?.users) {
    for (const u of authUsers.users) {
      if (u.email) emailMap[u.id] = u.email;
    }
  }

  // Merge into flat rows
  const people = profiles.map((p) => ({
    id: p.id,
    display_name: p.display_name,
    email: emailMap[p.id] ?? null,
    global_role: p.global_role ?? "user",
    created_at: p.created_at,
    orgs: (p.user_organizations ?? [])
      .filter((uo) => uo.status === "active" && uo.organizations)
      .map((uo) => ({
        org_id: uo.organizations!.id,
        org_name: uo.organizations!.name,
        org_slug: uo.organizations!.slug,
        role: uo.role,
        status: uo.status,
      })),
  }));

  return (
    <main>
      <AdminPageHeader
        title="People"
        description="All user accounts across the platform."
      />
      <PeopleDirectory initialPeople={people} />
    </main>
  );
}
