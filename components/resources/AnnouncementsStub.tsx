/**
 * Placeholder for Circle community announcements.
 * Will be replaced with a live feed from the Circle API in Chunk 10.
 */
export default function AnnouncementsStub() {
  return (
    <section className="py-16 md:py-20 bg-slate-50">
      <div className="max-w-7xl mx-auto px-6">
        <h2 className="text-2xl md:text-3xl font-bold text-[#1A1A1A] tracking-tight mb-3">
          Latest Announcements
        </h2>
        <p className="text-[#6B6B6B] max-w-2xl mb-10">
          Stay up to date with the latest news, events, and discussions from the
          CSC community.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLACEHOLDER_POSTS.map((post, i) => (
            <div
              key={i}
              className="bg-white rounded-xl border border-[#E5E5E5] p-5"
            >
              <div className="text-xs text-[#9B9B9B] uppercase tracking-wide mb-2">
                {post.category}
              </div>
              <h3 className="font-semibold text-[#1A1A1A] mb-2 line-clamp-2">
                {post.title}
              </h3>
              <p className="text-sm text-[#6B6B6B] line-clamp-3">
                {post.excerpt}
              </p>
            </div>
          ))}
        </div>

        <p className="text-center text-sm text-[#9B9B9B] mt-8">
          Community feed powered by Circle — coming soon.
        </p>
      </div>
    </section>
  );
}

const PLACEHOLDER_POSTS = [
  {
    category: "Events",
    title: "CSC Annual Conference 2026",
    excerpt:
      "Registration is now open for this year's annual conference. Join campus store leaders from across Canada.",
  },
  {
    category: "News",
    title: "Benchmarking Survey Results",
    excerpt:
      "The latest benchmarking data is now available for member institutions. Log in to access your reports.",
  },
  {
    category: "Community",
    title: "Regional Meetup: Western Canada",
    excerpt:
      "Connect with fellow campus store managers in BC and Alberta at our next regional gathering.",
  },
  {
    category: "Advocacy",
    title: "Independence Defense Network",
    excerpt:
      "Resources and support for campus stores facing institutional governance challenges.",
  },
];
