import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import AdminBreadcrumbs from "@/components/admin/AdminBreadcrumbs";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { resolveBoardRenewalWindow } from "@/lib/renewal/board-report";

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

  // Conditions the sidebar cannot resolve itself — it is a client component,
  // and the window comes from the same policy config the reminder and grace
  // crons run on. getRenewalConfig() is cached, so this is not a query per
  // admin page load.
  const conditions = {
    renewalBoardWindow:
      (await resolveBoardRenewalWindow(new Date().toISOString().slice(0, 10))) !== null,
  };

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      <AdminSidebar globalRole={auth.ctx.globalRole} conditions={conditions} />
      <div className="flex-1 min-w-0 px-6 py-6">
        <AdminBreadcrumbs />
        {children}
      </div>
    </div>
  );
}
