import { getAnnouncementPosts } from "@/lib/circle/announcements";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Server component — fetches recent announcements from Circle.
 * Falls back to a placeholder UI when Circle is not configured or returns no posts.
 * Replaces the old AnnouncementsStub.
 */
export default async function CircleAnnouncementFeed() {
  const posts = await getAnnouncementPosts(4);

  // Fallback: Circle not configured or no posts
  if (posts.length === 0) {
    return (
      <section className="py-16 md:py-20 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-2xl md:text-3xl font-bold text-[#1A1A1A] tracking-tight mb-3">
            Latest Announcements
          </h2>
          <p className="text-[#6B6B6B] max-w-2xl mb-10">
            Stay up to date with the latest news, events, and discussions from
            the CSC community.
          </p>

          {/* Placeholder cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {["Events", "News", "Community", "Advocacy"].map((category) => (
              <div
                key={category}
                className="bg-white rounded-xl border border-[#E5E5E5] p-5"
              >
                <div className="text-xs text-[#9B9B9B] uppercase tracking-wide mb-2">
                  {category}
                </div>
                <div className="h-4 bg-gray-100 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-50 rounded w-full mb-1" />
                <div className="h-3 bg-gray-50 rounded w-2/3" />
              </div>
            ))}
          </div>

          <p className="text-center text-sm text-[#9B9B9B] mt-8">
            Community feed powered by Circle — loading...
          </p>
        </div>
      </section>
    );
  }

  // Live feed
  return (
    <section className="py-16 md:py-20 bg-slate-50">
      <div className="max-w-7xl mx-auto px-6">
        <h2 className="text-2xl md:text-3xl font-bold text-[#1A1A1A] tracking-tight mb-3">
          Latest Announcements
        </h2>
        <p className="text-[#6B6B6B] max-w-2xl mb-10">
          Stay up to date with the latest news, events, and discussions from
          the CSC community.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {posts.map((post) => (
            <a
              key={post.id}
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white rounded-xl border border-[#E5E5E5] p-5 hover:shadow-md transition-shadow group"
            >
              <div className="text-xs text-[#9B9B9B] uppercase tracking-wide mb-2">
                Community
              </div>
              <h3 className="font-semibold text-[#1A1A1A] mb-2 line-clamp-2 group-hover:text-[#1B4332]">
                {post.name}
              </h3>
              {post.body && (
                <p className="text-sm text-[#6B6B6B] line-clamp-3">
                  {stripHtml(post.body).slice(0, 150)}
                </p>
              )}
              <p className="text-xs text-[#9B9B9B] mt-3">
                {post.user?.name ?? "CSC Team"} &middot;{" "}
                {formatRelativeDate(post.created_at)}
              </p>
            </a>
          ))}
        </div>

        <p className="text-center text-sm text-[#9B9B9B] mt-8">
          Community feed powered by{" "}
          <span className="font-medium">Circle</span>
        </p>
      </div>
    </section>
  );
}
