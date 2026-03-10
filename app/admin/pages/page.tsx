import Link from "next/link";

export const metadata = {
  title: "Pages & Permissions | Admin | Campus Stores Canada",
};

type PageRegistryRow = {
  route: string;
  owner: string;
  visibility: "public" | "authenticated" | "admin";
  requiredRole: string;
  health: "healthy" | "review";
};

const PAGE_REGISTRY: PageRegistryRow[] = [
  {
    route: "/",
    owner: "Public Site",
    visibility: "public",
    requiredRole: "none",
    health: "healthy",
  },
  {
    route: "/about",
    owner: "Content Admin",
    visibility: "public",
    requiredRole: "none",
    health: "healthy",
  },
  {
    route: "/admin",
    owner: "Global Admin",
    visibility: "admin",
    requiredRole: "admin|super_admin",
    health: "healthy",
  },
  {
    route: "/admin/ops",
    owner: "Operations",
    visibility: "admin",
    requiredRole: "admin|super_admin",
    health: "healthy",
  },
  {
    route: "/admin/policy",
    owner: "Policy",
    visibility: "admin",
    requiredRole: "admin|super_admin",
    health: "healthy",
  },
  {
    route: "/admin/pages",
    owner: "Operations",
    visibility: "admin",
    requiredRole: "admin|super_admin",
    health: "healthy",
  },
  {
    route: "/org/[slug]/admin",
    owner: "Org Admin",
    visibility: "authenticated",
    requiredRole: "org_admin|admin|super_admin",
    health: "review",
  },
  {
    route: "/conference/[year]/[edition]/register",
    owner: "Conference",
    visibility: "authenticated",
    requiredRole: "member/partner roles",
    health: "review",
  },
];

export default function AdminPagesPermissionsPage() {
  return (
    <main>
      <h1 className="text-2xl font-bold text-gray-900">Pages & Permissions</h1>
      <p className="mt-2 text-sm text-gray-600">
        v1.0 registry for discoverability and access correctness. This will grow into a full route
        health and permissions console.
      </p>

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Route</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Owner</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Visibility</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Required Role</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Health</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {PAGE_REGISTRY.map((row) => (
              <tr key={row.route}>
                <td className="px-4 py-3 text-gray-900 font-medium">{row.route}</td>
                <td className="px-4 py-3 text-gray-700">{row.owner}</td>
                <td className="px-4 py-3 text-gray-700">{row.visibility}</td>
                <td className="px-4 py-3 text-gray-700">{row.requiredRole}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.health === "healthy"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {row.health}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-sm text-gray-600">
        <p>
          Related tools: <Link className="text-blue-700 hover:underline" href="/admin/ops">Ops Health</Link>{" "}
          and <Link className="text-blue-700 hover:underline" href="/admin/policy">Policy Settings</Link>.
        </p>
      </div>
    </main>
  );
}
