import { redirect } from "next/navigation";
import { isGlobalAdmin, requireReviewerOrAdmin } from "@/lib/auth/guards";
import AdminSidebar from "@/components/benchmarking/admin/AdminSidebar";
import PresentationBlock from "@/components/presentation/PresentationBlock";

export const metadata = {
  title: "Benchmarking Admin | Campus Stores Canada",
};

export default async function BenchmarkingAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await requireReviewerOrAdmin();
  if (!auth.ok) {
    redirect("/benchmarking");
  }

  // The submissions list, drift report, flag queue and trace all render filed
  // rows for named stores in full. Nothing here is maskable — see the note in
  // components/presentation/PresentationBlock.tsx.
  if (auth.ctx.presentationMode) {
    return (
      <PresentationBlock
        level={auth.ctx.presentationMode}
        area="Benchmarking admin"
      />
    );
  }
  const isAdmin = isGlobalAdmin(auth.ctx.globalRole);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 flex gap-8">
      <AdminSidebar isAdmin={isAdmin} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
