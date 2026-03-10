import { redirect } from "next/navigation";
import { isGlobalAdmin, requireReviewerOrAdmin } from "@/lib/auth/guards";
import AdminSidebar from "@/components/benchmarking/admin/AdminSidebar";

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
  const isAdmin = isGlobalAdmin(auth.ctx.globalRole);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 flex gap-8">
      <AdminSidebar isAdmin={isAdmin} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
