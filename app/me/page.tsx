import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = {
  title: "My Account | Campus Stores Canada",
};

export default async function MyAccountPage() {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const adminClient = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userSb = auth.ctx.supabase as any;
  const [profileResult, orgResult, circleResult] = (await Promise.all([
    userSb
      .from("profiles")
      .select("display_name, global_role")
      .eq("id", auth.ctx.userId)
      .maybeSingle(),
    userSb
      .from("user_organizations")
      .select("id, role, organization:organizations(id, name, slug)")
      .eq("user_id", auth.ctx.userId)
      .eq("status", "active"),
    adminClient
      .from("contacts")
      .select("circle_id, synced_to_circle_at")
      .eq("user_id", auth.ctx.userId)
      .not("circle_id", "is", null)
      .limit(1)
      .maybeSingle(),
  ])) as [{ data: any }, { data: any[] | null }, { data: any }];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: conferencePeopleRows } = (await (adminClient as any)
    .from("conference_people")
    .select("conference_id, conference_instances!inner(id, name, year, edition_code)")
    .eq("user_id", auth.ctx.userId)) as { data: any[] | null };

  const myConferenceLinks = (conferencePeopleRows ?? [])
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

  const orgs = (orgResult.data ?? []) as Array<{
    id: string;
    role: string;
    organization: { id: string; name: string; slug: string };
  }>;

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">My Account</h1>
        <p className="mt-2 text-sm text-gray-600">Manage your profile and linked organization access.</p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-gray-900">Profile</h2>
        <dl className="mt-3 grid gap-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-gray-500">Display Name</dt>
            <dd className="text-gray-900">{profileResult.data?.display_name || "Not set"}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-gray-500">Email</dt>
            <dd className="text-gray-900">{auth.ctx.userEmail || "Unknown"}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-gray-500">Global Role</dt>
            <dd className="text-gray-900">{profileResult.data?.global_role || "user"}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-gray-900">Circle Linkage</h2>
        <p className="mt-2 text-sm text-gray-600">
          {circleResult.data?.circle_id
            ? `Linked to Circle member #${circleResult.data.circle_id}.`
            : "No Circle account link found yet."}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Last sync: {circleResult.data?.synced_to_circle_at || "Never"}
        </p>
        <div className="mt-4">
          <a
            href="/api/circle/member-space"
            className="inline-flex items-center rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:border-gray-400"
          >
            Open Member Space
          </a>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-gray-900">My Organizations</h2>
        {orgs.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No active organization memberships.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {orgs.map((org) => (
              <li key={org.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">{org.organization?.name}</p>
                  <p className="text-xs text-gray-500">Role: {org.role}</p>
                </div>
                {org.organization?.slug ? (
                  <Link href={`/org/${org.organization.slug}`} className="text-sm text-[#D60001] hover:text-[#B00001]">
                    Open
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-gray-900">My Conferences</h2>
        {myConferenceLinks.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No conference access records yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {myConferenceLinks.map((conference) => (
              <li
                key={conference.id}
                className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {conference.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {conference.year} • {conference.editionCode}
                  </p>
                </div>
                <Link
                  href={`/me/conference/${conference.id}`}
                  className="text-sm text-[#D60001] hover:text-[#B00001]"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
