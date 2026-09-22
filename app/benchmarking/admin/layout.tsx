import { redirect } from "next/navigation";
import { isGlobalAdmin, requireAuthenticated } from "@/lib/auth/guards";
import {
  CAPABILITIES,
  opensBenchmarkingAdmin,
} from "@/lib/auth/capability-names";
import AdminSidebar from "@/components/benchmarking/admin/AdminSidebar";
import PresentationBlock from "@/components/presentation/PresentationBlock";

export const metadata = {
  title: "Benchmarking Admin | Campus Stores Canada",
};

/**
 * The benchmarking back office.
 *
 * A benchmarking invitation is a task, not committee membership: one
 * capability opens one door. So this shell admits only the people who have a
 * page inside it — the office, the committee lead, and whoever holds
 * Interpretation. Question review's work lives at /benchmarking/review, which
 * is not in here, and a question reviewer sent to this URL is redirected to
 * their own task rather than shown a sidebar of things they cannot open.
 *
 * Every page in here gates itself as well. This layout is the front door, not
 * the lock: `submissions` and `flags` once carried no check of their own and
 * inherited whoever the shell let in, which is how question reviewers ended up
 * able to rule on other stores' figures.
 */
export default async function BenchmarkingAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const { globalRole, capabilities } = auth.ctx;
  const isAdmin = isGlobalAdmin(globalRole);
  const holds = (c: string) => capabilities.includes(c);

  if (!isAdmin && !opensBenchmarkingAdmin(capabilities)) {
    // Send them to their own task, not to a dead end.
    redirect(
      holds(CAPABILITIES.BENCHMARKING_CONTENT_REVIEW)
        ? "/benchmarking/review"
        : "/benchmarking",
    );
  }

  // The submissions list, drift report, flag queue and trace all render filed
  // rows for named stores in full. Nothing here is maskable — see the note in
  // components/presentation/PresentationBlock.tsx.
  //
  // After the capability gate, not before it: who may enter at all is a
  // different question from what a demo audience is allowed to see, and a
  // viewer who should be redirected to their own task should be redirected
  // whether or not presentation mode happens to be on.
  if (auth.ctx.presentationMode) {
    return (
      <PresentationBlock
        level={auth.ctx.presentationMode}
        area="Benchmarking admin"
      />
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 flex gap-8">
      <AdminSidebar isAdmin={isAdmin} capabilities={capabilities} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
