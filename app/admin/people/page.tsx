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

  // Load profiles
  const { data: rawProfiles } = await adminClient
    .from("profiles")
    .select("id, display_name, global_role, created_at")
    .order("display_name");
  const profiles = rawProfiles ?? [];

  // Load active org memberships separately — there's no direct FK between
  // profiles and user_organizations (both reference auth.users), so PostgREST
  // can't embed them in a single query.
  type Membership = {
    user_id: string;
    role: string;
    status: string;
    organizations: { id: string; name: string; slug: string } | null;
  };
  const { data: rawMemberships } = await adminClient
    .from("user_organizations")
    .select("user_id, role, status, organizations(id, name, slug)")
    .eq("status", "active");

  const orgsByUser = new Map<
    string,
    Array<{ org_id: string; org_name: string; org_slug: string; role: string; status: string }>
  >();
  for (const m of (rawMemberships ?? []) as unknown as Membership[]) {
    if (!m.organizations) continue;
    const list = orgsByUser.get(m.user_id) ?? [];
    list.push({
      org_id: m.organizations.id,
      org_name: m.organizations.name,
      org_slug: m.organizations.slug,
      role: m.role,
      status: m.status,
    });
    orgsByUser.set(m.user_id, list);
  }

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
    orgs: orgsByUser.get(p.id) ?? [],
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
