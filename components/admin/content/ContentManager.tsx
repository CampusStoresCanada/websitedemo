"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SiteContent } from "@/lib/database.types";
import {
  createSiteContent,
  updateSiteContent,
} from "@/lib/actions/site-content";
import ContentEntryForm from "./ContentEntryForm";

interface ContentManagerProps {
  boardMembers: SiteContent[];
  staffMembers: SiteContent[];
}

type Tab = "board_of_directors" | "staff";

export default function ContentManager({
  boardMembers,
  staffMembers,
}: ContentManagerProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<Tab>("board_of_directors");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const entries =
    activeTab === "board_of_directors" ? boardMembers : staffMembers;
  const label =
    activeTab === "board_of_directors" ? "Board Member" : "Staff Member";

  function refresh() {
    startTransition(() => {
      router.refresh();
    });
  }

  async function handleCreate(data: {
    title: string;
    subtitle: string;
    body: string;
    image_url: string;
    display_order: number;
  }) {
    const result = await createSiteContent({
      section: activeTab,
      content_type: "person",
      title: data.title,
      subtitle: data.subtitle,
      body: data.body,
      image_url: data.image_url,
      display_order: data.display_order,
    });

    if (result.success) {
      setShowAddForm(false);
      refresh();
    } else {
      alert(`Error: ${result.error}`);
    }
  }

  async function handleUpdate(
    id: string,
    data: {
      title: string;
      subtitle: string;
      body: string;
      image_url: string;
      display_order: number;
    }
  ) {
    const result = await updateSiteContent(id, {
      title: data.title,
      subtitle: data.subtitle,
      body: data.body,
      image_url: data.image_url,
      display_order: data.display_order,
    });

    if (result.success) {
      setEditingId(null);
      refresh();
    } else {
      alert(`Error: ${result.error}`);
    }
  }

  async function handleSetActive(id: string, nextActive: boolean, name: string) {
    const actionLabel = nextActive ? "publish" : "unpublish";
    if (!confirm(`${actionLabel[0].toUpperCase()}${actionLabel.slice(1)} "${name}"?`)) return;

    const result = await updateSiteContent(id, { is_active: nextActive });
    if (result.success) {
      refresh();
    } else {
      alert(`Error: ${result.error}`);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#1A1A1A] mb-6">
        Site Content
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-8 bg-slate-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => {
            setActiveTab("board_of_directors");
            setEditingId(null);
            setShowAddForm(false);
          }}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === "board_of_directors"
              ? "bg-white text-[#1A1A1A] shadow-sm"
              : "text-[#6B6B6B] hover:text-[#1A1A1A]"
          }`}
        >
          Board of Directors
        </button>
        <button
          onClick={() => {
            setActiveTab("staff");
            setEditingId(null);
            setShowAddForm(false);
          }}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            activeTab === "staff"
              ? "bg-white text-[#1A1A1A] shadow-sm"
              : "text-[#6B6B6B] hover:text-[#1A1A1A]"
          }`}
        >
          Staff
        </button>
      </div>

      {/* Add button */}
      {!showAddForm && (
        <button
          onClick={() => {
            setShowAddForm(true);
            setEditingId(null);
          }}
          className="mb-6 px-4 py-2 bg-[#D60001] text-white text-sm font-medium rounded-lg hover:bg-[#B00001] transition-colors"
        >
          + Add {label}
        </button>
      )}

      {/* Add form */}
      {showAddForm && (
        <div className="mb-6">
          <ContentEntryForm
            section={activeTab}
            onSave={handleCreate}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      {/* Loading indicator */}
      {isPending && (
        <div className="text-sm text-[#6B6B6B] mb-4">Refreshing…</div>
      )}

      {/* Entry list */}
      <div className="space-y-3">
        {entries.length === 0 && !showAddForm && (
          <p className="text-[#6B6B6B] py-8 text-center">
            No {activeTab === "board_of_directors" ? "board members" : "staff"}{" "}
            added yet.
          </p>
        )}

        {entries.map((entry) => (
          <div key={entry.id}>
            {editingId === entry.id ? (
              <ContentEntryForm
                entry={entry}
                section={activeTab}
                onSave={(data) => handleUpdate(entry.id, data)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div className="bg-white border border-[#E5E5E5] rounded-xl p-4 flex items-center gap-4">
                {/* Photo */}
                {entry.image_url ? (
                  <img
                    src={entry.image_url}
                    alt={entry.title || ""}
                    className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-slate-400 font-semibold text-sm">
                      {getInitials(entry.title)}
                    </span>
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[#1A1A1A]">
                    {entry.title}
                  </div>
                  {entry.subtitle && (
                    <div className="text-sm text-[#6B6B6B]">
                      {entry.subtitle}
                    </div>
                  )}
                </div>

                {/* Order badge */}
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xs text-[#9B9B9B] font-mono">
                    #{entry.display_order}
                  </span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full ${
                      entry.is_active
                        ? "bg-green-100 text-green-700"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {entry.is_active ? "Published" : "Hidden"}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => {
                      setEditingId(entry.id);
                      setShowAddForm(false);
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-[#4A4A4A] bg-slate-100 rounded-md hover:bg-slate-200 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() =>
                      handleSetActive(
                        entry.id,
                        !entry.is_active,
                        entry.title || "entry"
                      )
                    }
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      entry.is_active
                        ? "text-red-600 bg-red-50 hover:bg-red-100"
                        : "text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                    }`}
                  >
                    {entry.is_active ? "Unpublish" : "Publish"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
