/**
 * Generic loading skeleton for admin pages.
 * Used by route-level loading.tsx files to show while page data fetches.
 */
export default function AdminLoadingSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded bg-gray-200" />
          <div className="h-4 w-72 rounded bg-gray-100" />
        </div>
      </div>
      {/* Content rows */}
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-gray-100" />
        ))}
      </div>
    </div>
  );
}
