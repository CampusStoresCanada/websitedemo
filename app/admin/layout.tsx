import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import AdminBreadcrumbs from "@/components/admin/AdminBreadcrumbs";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { resolveBoardRenewalWindow } from "@/lib/renewal/board-report";
import PresentationBlock from "@/components/presentation/PresentationBlock";

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

  // Every page under here reads through createAdminClient(), so the visibility
  // mask never sees them. Shut the whole area rather than let one of them paint
  // live staff data onto a screen share. See components/presentation/.
  if (auth.ctx.presentationMode) {
    return (
      <PresentationBlock level={auth.ctx.presentationMode} area="The admin area" />
    );
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
