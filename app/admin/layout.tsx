import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import AdminBreadcrumbs from "@/components/admin/AdminBreadcrumbs";
import AdminSidebar from "@/components/admin/AdminSidebar";

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
    <div className="flex min-h-[calc(100vh-4rem)]">
      <AdminSidebar globalRole={auth.ctx.globalRole} />
      <div className="flex-1 min-w-0 px-6 py-6">
        <AdminBreadcrumbs />
        {children}
      </div>
    </div>
  );
}
