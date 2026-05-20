"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { removeBookmark, updateBookmarkNote, type Bookmark } from "@/lib/actions/bookmarks";
import { findElementBySelector, findElementByText } from "@/lib/utils/dom-highlight";

type SortKey = "newest" | "oldest" | "title" | "url";
type FilterKey = "all" | "section" | "page";

function formatDate(iso: string) {
  const utc = iso.endsWith("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z";
  return new Date(utc).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

export default function BookmarksClient({ initialBookmarks }: { initialBookmarks: Bookmark[] }) {
  const router = useRouter();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(initialBookmarks);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNoteValue, setEditNoteValue] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const pathname = typeof window !== "undefined" ? window.location.pathname : "";

  const processed = useMemo(() => {
    let list = [...bookmarks];

    // Filter
    if (filter === "section") list = list.filter((b) => b.element_selector || b.element_text);
    if (filter === "page") list = list.filter((b) => !b.element_selector && !b.element_text);

    // Search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((b) =>
        b.title.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        (b.note ?? "").toLowerCase().includes(q) ||
        (b.element_text ?? "").toLowerCase().includes(q)
      );
    }

    // Sort
    list.sort((a, b) => {
      if (sort === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sort === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "url") return a.url.localeCompare(b.url);
      return 0;
    });

    return list;
  }, [bookmarks, search, sort, filter]);

  const sectionCount = bookmarks.filter((b) => b.element_selector || b.element_text).length;
  const pageCount = bookmarks.length - sectionCount;

  const handleJump = (b: Bookmark) => {
    if (b.url === pathname) {
      let el: Element | null = null;
      if (b.element_selector) el = findElementBySelector(b.element_selector);
      if (!el && b.element_text) el = findElementByText(b.element_text);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      const params = new URLSearchParams();
      if (b.element_selector) params.set("bmhs", b.element_selector);
      if (b.element_end_selector) params.set("bmhe", b.element_end_selector);
      if (b.element_text) params.set("bmt", encodeURIComponent(b.element_text));
      const qs = params.toString();
      router.push(qs ? `${b.url}?${qs}` : b.url);
    }
  };

  const startEdit = (b: Bookmark) => {
    setEditingId(b.id);
    setEditNoteValue(b.note ?? "");
  };

  const saveNote = async (id: string) => {
    await updateBookmarkNote(id, editNoteValue);
    setBookmarks((prev) => prev.map((b) => b.id === id ? { ...b, note: editNoteValue || null } : b));
    setEditingId(null);
  };

  const handleRemove = async (b: Bookmark) => {
    setRemoving(b.id);
    await removeBookmark(b.url);
    setBookmarks((prev) => prev.filter((bm) => bm.id !== b.id));
    setRemoving(null);
  };

  if (bookmarks.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
        <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center mx-auto mb-3">
          <svg className="w-5 h-5 text-yellow-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-gray-700">No bookmarks yet</p>
        <p className="text-xs text-gray-400 mt-1">Use the toolkit (bottom right) to bookmark pages and sections.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Controls row */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bookmarks…"
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-300 bg-white"
          />
        </div>

        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-yellow-300 text-gray-700"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="title">A → Z</option>
          <option value="url">By URL</option>
        </select>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2">
        {(["all", "section", "page"] as FilterKey[]).map((f) => {
          const label = f === "all"
            ? `All (${bookmarks.length})`
            : f === "section"
            ? `Sections (${sectionCount})`
            : `Pages (${pageCount})`;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                filter === f
                  ? "bg-yellow-500 text-white border-yellow-500"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* List */}
      {processed.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          {search ? `No matches for "${search}"` : "No bookmarks in this category."}
        </p>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-50 overflow-hidden">
          {processed.map((b) => (
            <div key={b.id} className="px-5 py-4 group hover:bg-gray-50 transition-colors">
              <div className="flex items-start gap-4">
                {/* Bookmark icon */}
                <div className="shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
                  </svg>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => handleJump(b)}
                      className="font-medium text-sm text-gray-900 hover:text-[#EE2A2E] transition-colors text-left"
                    >
                      {b.title}
                    </button>
                    {(b.element_selector || b.element_text) && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded-full shrink-0">
                        section
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-gray-400 mt-0.5 truncate">{b.url}</p>

                  {b.element_text && (
                    <p className="text-xs text-gray-400 italic mt-1 line-clamp-1">
                      &ldquo;{b.element_text.slice(0, 100)}&rdquo;
                    </p>
                  )}

                  {editingId === b.id ? (
                    <div className="mt-2 flex gap-2">
                      <input
                        className="flex-1 text-xs border border-yellow-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-yellow-200"
                        value={editNoteValue}
                        autoFocus
                        onChange={(e) => setEditNoteValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveNote(b.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        placeholder="Add a note…"
                      />
                      <button onClick={() => saveNote(b.id)} className="text-xs font-medium text-yellow-700 hover:text-yellow-900">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                    </div>
                  ) : b.note ? (
                    <p className="text-xs text-gray-500 mt-1 cursor-pointer hover:text-gray-700" onClick={() => startEdit(b)} title="Click to edit note">
                      {b.note}
                    </p>
                  ) : (
                    <button onClick={() => startEdit(b)} className="text-xs text-gray-300 hover:text-gray-500 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      + add note
                    </button>
                  )}

                  <p className="text-[10px] text-gray-300 mt-1.5">{formatDate(b.created_at)}</p>
                </div>

                {/* Actions */}
                <div className="shrink-0 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleJump(b)}
                    className="text-xs text-gray-400 hover:text-[#EE2A2E] transition-colors font-medium"
                  >
                    Open →
                  </button>
                  <button
                    onClick={() => handleRemove(b)}
                    disabled={removing === b.id}
                    className="text-gray-300 hover:text-red-400 transition-colors disabled:opacity-50"
                    title="Remove bookmark"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
