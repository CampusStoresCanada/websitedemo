import { redirect } from "next/navigation";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getUserBookmarks } from "@/lib/actions/bookmarks";
import BookmarksClient from "./BookmarksClient";

export const metadata = {
  title: "My Bookmarks | Campus Stores Canada",
};

export default async function MyBookmarksPage() {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const { bookmarks } = await getUserBookmarks();

  return (
    <main className="max-w-4xl mx-auto px-4 py-10 space-y-6">
      <div>
        <a href="/me" className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          My Account
        </a>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">My Bookmarks</h1>
        <p className="mt-1 text-sm text-gray-500">
          {bookmarks.length === 0
            ? "No bookmarks yet. Use the toolkit to save pages and sections."
            : `${bookmarks.length} bookmark${bookmarks.length !== 1 ? "s" : ""}`}
        </p>
      </div>

      <BookmarksClient initialBookmarks={bookmarks} />
    </main>
  );
}
