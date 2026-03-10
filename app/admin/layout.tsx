import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import AdminBreadcrumbs from "@/components/admin/AdminBreadcrumbs";

export const metadata = {
  title: "Admin | Campus Stores Canada",
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    redirect(auth.status === 401 ? "/login" : "/");
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <AdminBreadcrumbs />
      {children}
    </div>
  );
}
