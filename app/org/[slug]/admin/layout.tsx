import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { resolveOrgSlug } from "@/lib/org/resolve";
import { requireOrgAdminOrSuperAdmin } from "@/lib/auth/guards";

interface OrgAdminLayoutProps {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function OrgAdminLayout({
  children,
  params,
}: OrgAdminLayoutProps) {
  const { slug } = await params;

  // Resolve slug → org
  const org = await resolveOrgSlug(slug);
  if (!org) {
    notFound();
  }

  // Auth guard: org_admin of this org, or global admin/super_admin
  const auth = await requireOrgAdminOrSuperAdmin(org.id);
  if (!auth.ok) {
    redirect(auth.status === 401 ? "/login" : `/org/${slug}`);
  }

  return (
    <div className="min-h-screen bg-[#EEEEF0]">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-gray-500 mb-6">
          <Link href={`/org/${slug}`} className="hover:text-gray-700">
            {org.name}
          </Link>
          <span>/</span>
          <span className="text-gray-900 font-medium">Admin</span>
        </nav>

        {/* Org admin navigation */}
        <div className="flex gap-4 mb-8 border-b border-gray-300 pb-3">
          <Link
            href={`/org/${slug}/admin`}
            className="text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-md hover:bg-white/50 transition-colors"
          >
            Dashboard
          </Link>
          <Link
            href={`/org/${slug}/admin/users`}
            className="text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-md hover:bg-white/50 transition-colors"
          >
            Users
          </Link>
          <Link
            href={`/org/${slug}/admin/transfer`}
            className="text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-md hover:bg-white/50 transition-colors"
          >
            Transfer Admin
          </Link>
        </div>

        {children}
      </div>
    </div>
  );
}
