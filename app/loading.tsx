import AdminLoadingSkeleton from "@/components/admin/AdminLoadingSkeleton";
import { WorkingStrip } from "@/components/ui/WorkingBar";

/**
 * Every page outside /admin, while it loads (Steve, 2026-11-05: "the page load
 * still goes blank to loaded").
 *
 * Without a loading file above them, member pages sent nothing until the whole
 * page was ready, so a slow connection saw a blank window. This boundary lets
 * the header go out at once with the working strip and a placeholder, and the
 * page streams in behind it. /admin keeps its own.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading">
      <div className="fixed inset-x-0 top-0 z-[400]">
        <WorkingStrip />
      </div>
      <div className="mx-auto max-w-5xl px-4 py-10">
        <AdminLoadingSkeleton />
      </div>
    </div>
  );
}
