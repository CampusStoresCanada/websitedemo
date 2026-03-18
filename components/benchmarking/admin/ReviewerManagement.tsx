"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  toggleBenchmarkingReviewer,
  searchUsersForReviewer,
} from "@/lib/actions/benchmarking-admin";

interface Reviewer {
  id: string;
  displayName: string;
  globalRole: string;
}

interface SearchResult {
  id: string;
  displayName: string;
  globalRole: string;
  isReviewer: boolean;
}

interface ReviewerManagementProps {
  currentReviewers: Reviewer[];
}

export default function ReviewerManagement({
  currentReviewers,
}: ReviewerManagementProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async () => {
    if (searchQuery.trim().length < 2) return;
    setSearching(true);
    setError(null);
    const result = await searchUsersForReviewer(searchQuery.trim());
    if (result.success && result.users) {
      setSearchResults(result.users);
    } else {
      setError(result.error ?? "Search failed");
      setSearchResults([]);
    }
    setSearching(false);
  };

  const handleToggle = async (userId: string, enable: boolean) => {
    setSaving(userId);
    setError(null);
    const result = await toggleBenchmarkingReviewer(userId, enable);
    if (result.success) {
      router.refresh();
      // Update search results locally
      setSearchResults((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, isReviewer: enable } : u))
      );
    } else {
      setError(result.error ?? "Failed to update");
    }
    setSaving(null);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
        Benchmarking Reviewers
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        Reviewers can view all submissions, review flagged values, and verify
        submissions — but cannot manage surveys.
      </p>

      {/* Current reviewers */}
      {currentReviewers.length > 0 ? (
        <div className="mb-6">
          <h4 className="text-xs font-medium text-gray-700 mb-2">
            Current Reviewers ({currentReviewers.length})
          </h4>
          <div className="space-y-2">
            {currentReviewers.map((reviewer) => (
              <div
                key={reviewer.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    {reviewer.displayName}
                  </span>
                  <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">
                    {reviewer.globalRole}
                  </span>
                </div>
                <button
                  onClick={() => handleToggle(reviewer.id, false)}
                  disabled={saving === reviewer.id}
                  className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
                >
                  {saving === reviewer.id ? "..." : "Remove"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg text-center">
          <p className="text-sm text-gray-500">
            No reviewers assigned yet. Search for users below to add them.
          </p>
        </div>
      )}

      {/* Search to add reviewers */}
      <div>
        <h4 className="text-xs font-medium text-gray-700 mb-2">
          Add Reviewer
        </h4>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search by name..."
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            onClick={handleSearch}
            disabled={searching || searchQuery.trim().length < 2}
            className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {searching ? "..." : "Search"}
          </button>
        </div>

        {error && (
          <p className="text-xs text-red-600 mb-2">{error}</p>
        )}

        {searchResults.length > 0 && (
          <div className="space-y-2 border border-gray-100 rounded-lg p-2">
            {searchResults.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-900">
                    {user.displayName}
                  </span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                    {user.globalRole}
                  </span>
                </div>
                {user.isReviewer ? (
                  <span className="text-xs text-green-600 font-medium px-2 py-1 bg-green-50 rounded">
                    Reviewer
                  </span>
                ) : (
                  <button
                    onClick={() => handleToggle(user.id, true)}
                    disabled={saving === user.id}
                    className="text-xs text-[#EE2A2E] hover:text-[#D92327] font-medium px-2 py-1 border border-blue-200 rounded hover:bg-blue-50 disabled:opacity-50 transition-colors"
                  >
                    {saving === user.id ? "..." : "Add as Reviewer"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
