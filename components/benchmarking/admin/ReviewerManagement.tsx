"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  toggleBenchmarkingReviewer,
  searchUsersForReviewer,
} from "@/lib/actions/benchmarking-admin";

type ReviewerKind = "qa" | "content";

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
  isContentReviewer: boolean;
}

interface ReviewerManagementProps {
  /** Board QA committee — resolves flags, verifies submissions (Nov/Dec) */
  currentReviewers: Reviewer[];
  /** Store directors — question wording and worked examples (Sept) */
  currentContentReviewers: Reviewer[];
}

export default function ReviewerManagement({
  currentReviewers,
  currentContentReviewers,
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

  const handleToggle = async (
    userId: string,
    enable: boolean,
    kind: ReviewerKind,
  ) => {
    setSaving(userId + kind);
    setError(null);
    const result = await toggleBenchmarkingReviewer(userId, enable, kind);
    if (result.success) {
      router.refresh();
      // Update search results locally
      setSearchResults((prev) =>
        prev.map((u) =>
          u.id === userId
            ? kind === "content"
              ? { ...u, isContentReviewer: enable }
              : { ...u, isReviewer: enable }
            : u,
        ),
      );
    } else {
      setError(result.error ?? "Failed to update");
    }
    setSaving(null);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">
        Benchmarking Reviewers
      </h3>
      <p className="text-xs text-gray-500 mb-5">
        Two separate groups, doing different jobs at different times of year.
        Someone can hold both, but most people hold one.
      </p>

      <Roster
        title="Board QA Committee"
        blurb="Resolves flagged values and verifies submissions once collection closes. Sees every store's data. Nothing to do before November."
        people={currentReviewers}
        kind="qa"
        emptyHint="Nobody assigned. Search below to add board members."
        saving={saving}
        onRemove={(id) => handleToggle(id, false, "qa")}
      />

      <Roster
        title="Content Reviewers"
        blurb="Store directors correcting question wording and authoring worked examples. Field config only — never submission data."
        people={currentContentReviewers}
        kind="content"
        emptyHint="Nobody assigned. Search below to add store directors."
        saving={saving}
        onRemove={(id) => handleToggle(id, false, "content")}
      />

      {/* Search to add reviewers */}
      <div>
        <h4 className="text-xs font-medium text-gray-700 mb-2">Add Reviewer</h4>
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

        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

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
                <div className="flex items-center gap-2">
                  {user.isReviewer ? (
                    <span className="text-xs text-green-700 font-medium px-2 py-1 bg-green-50 rounded">
                      Board QA
                    </span>
                  ) : (
                    <button
                      onClick={() => handleToggle(user.id, true, "qa")}
                      disabled={saving === user.id + "qa"}
                      className="text-xs text-gray-700 hover:text-gray-900 font-medium px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 transition-colors"
                    >
                      {saving === user.id + "qa" ? "..." : "+ Board QA"}
                    </button>
                  )}
                  {user.isContentReviewer ? (
                    <span className="text-xs text-slate-700 font-medium px-2 py-1 bg-slate-100 rounded">
                      Content
                    </span>
                  ) : (
                    <button
                      onClick={() => handleToggle(user.id, true, "content")}
                      disabled={saving === user.id + "content"}
                      className="text-xs text-gray-700 hover:text-gray-900 font-medium px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 transition-colors"
                    >
                      {saving === user.id + "content" ? "..." : "+ Content"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// One roster block. Rendered twice — board QA and content reviewers.
// ─────────────────────────────────────────────────────────────────
function Roster({
  title,
  blurb,
  people,
  kind,
  emptyHint,
  saving,
  onRemove,
}: {
  title: string;
  blurb: string;
  people: Reviewer[];
  kind: ReviewerKind;
  emptyHint: string;
  saving: string | null;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between mb-1">
        <h4 className="text-xs font-semibold text-gray-700">
          {title} ({people.length})
        </h4>
      </div>
      <p className="text-xs text-gray-500 mb-2">{blurb}</p>
      {people.length > 0 ? (
        <div className="space-y-2">
          {people.map((person) => (
            <div
              key={person.id}
              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-900">
                  {person.displayName}
                </span>
                <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded">
                  {person.globalRole}
                </span>
              </div>
              <button
                onClick={() => onRemove(person.id)}
                disabled={saving === person.id + kind}
                className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
              >
                {saving === person.id + kind ? "..." : "Remove"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-3 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500">{emptyHint}</p>
        </div>
      )}
    </div>
  );
}
