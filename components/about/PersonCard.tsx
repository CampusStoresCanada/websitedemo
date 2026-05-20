"use client";

import { useState, useTransition } from "react";
import { useToolkit } from "@/components/ui/Toolkit";
import { useAuth } from "@/components/providers/AuthProvider";
import { fieldProps } from "@/lib/editable-fields";
import { assignSlotContact, searchContactsForSlot } from "@/lib/actions/site-content";
import type { SiteContentWithContact } from "@/lib/data";

interface PersonCardProps {
  person: SiteContentWithContact;
}

export default function PersonCard({ person }: PersonCardProps) {
  const { editMode } = useToolkit();
  const { profile } = useAuth();
  const isSuperAdmin = profile?.global_role === "super_admin";

  // Resolved display values:
  //  - name/photo: contact record wins (single source of truth for who the person is)
  //  - role: slot subtitle wins — it holds the page-specific position (e.g. "President"),
  //    which is separate from the contact's day-job title. Fall back to contact's
  //    role_title only when the slot has no subtitle set.
  const contact = person.contact ?? null;
  const displayName = contact?.name ?? person.title;
  const displayRole = person.subtitle ?? contact?.role_title ?? null;
  const displayPhoto = contact?.profile_picture_url ?? person.image_url;

  return (
    <div className="text-center relative">
      {/* Photo */}
      <div {...(!contact ? fieldProps("site_content", "image_url", person.id) : {})}>
        {displayPhoto ? (
          <img
            src={displayPhoto}
            alt={displayName || ""}
            className="w-32 h-32 rounded-full object-cover mx-auto mb-4"
          />
        ) : (
          <div className="w-32 h-32 rounded-full bg-slate-200 flex items-center justify-center mx-auto mb-4">
            <span className="text-slate-400 text-3xl font-semibold">
              {getInitials(displayName)}
            </span>
          </div>
        )}
      </div>

      {/* Name */}
      <h3
        className="font-semibold text-[#1A1A1A] text-lg"
        {...(!contact ? fieldProps("site_content", "title", person.id) : {})}
      >
        {displayName}
      </h3>

      {/* Role */}
      <p
        className="text-[#6B6B6B] text-sm mt-1"
        {...(!contact ? fieldProps("site_content", "subtitle", person.id) : {})}
      >
        {displayRole || "—"}
      </p>

      {/* Bio — only shown when not contact-linked (contact has its own profile page) */}
      {!contact && (
        <p
          className="text-[#6B6B6B] text-sm mt-3 max-w-xs mx-auto leading-relaxed"
          {...fieldProps("site_content", "body", person.id)}
        >
          {person.body || "—"}
        </p>
      )}

      {/* "Change person" button — super_admin only, in edit mode */}
      {editMode && isSuperAdmin && (
        <ChangePersonButton person={person} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Change Person Dialog
// ─────────────────────────────────────────────────────────────────

function ChangePersonButton({ person }: { person: SiteContentWithContact }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-3 text-xs text-[#EE2A2E] underline underline-offset-2 hover:text-[#c91f23] transition-colors"
      >
        {person.contact ? "Change person" : "Link to contact"}
      </button>

      {open && (
        <ChangePersonDialog
          person={person}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface ChangePersonDialogProps {
  person: SiteContentWithContact;
  onClose: () => void;
}

function ChangePersonDialog({ person, onClose }: ChangePersonDialogProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{
    id: string;
    name: string | null;
    profile_picture_url: string | null;
    role_title: string | null;
    organization_id: string | null;
  }[]>([]);
  const [searching, setSearching] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const res = await searchContactsForSlot(value);
    setSearching(false);
    if (res.success && res.data) {
      setResults(res.data);
    }
  }

  function handleSelect(contactId: string | null) {
    setError(null);
    startTransition(async () => {
      const res = await assignSlotContact(person.id, contactId);
      if (res.success) {
        onClose();
      } else {
        setError(res.error ?? "Failed to assign contact");
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-[#1A1A1A] text-lg">
            {person.contact ? "Change person" : "Link to contact"}
          </h2>
          <button
            onClick={onClose}
            className="text-[#9B9B9B] hover:text-[#1A1A1A] transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        <p className="text-sm text-[#6B6B6B] mb-4">
          Search for a contact to fill the <strong>{person.title ?? "slot"}</strong> position.
          The slot will render the contact&apos;s name, photo, and title from their contact record.
        </p>

        <input
          type="text"
          placeholder="Search by name…"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30 mb-3"
          autoFocus
        />

        {searching && (
          <p className="text-xs text-[#9B9B9B] mb-2">Searching…</p>
        )}

        {results.length > 0 && (
          <ul className="border border-slate-100 rounded-lg divide-y divide-slate-100 mb-3 max-h-64 overflow-y-auto">
            {results.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => handleSelect(c.id)}
                  disabled={isPending}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 transition-colors text-left"
                >
                  {c.profile_picture_url ? (
                    <img
                      src={c.profile_picture_url}
                      alt={c.name ?? ""}
                      className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-slate-500 text-xs font-semibold">
                        {getInitials(c.name)}
                      </span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#1A1A1A] truncate">{c.name}</p>
                    {c.role_title && (
                      <p className="text-xs text-[#6B6B6B] truncate">{c.role_title}</p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="text-xs text-red-600 mb-3">{error}</p>
        )}

        {/* Unlink option — shown when a contact is currently linked */}
        {person.contact && (
          <button
            onClick={() => handleSelect(null)}
            disabled={isPending}
            className="w-full text-sm text-[#9B9B9B] hover:text-[#EE2A2E] transition-colors py-2 border border-slate-200 rounded-lg mt-1"
          >
            Remove contact link (revert to manual fields)
          </button>
        )}

        {isPending && (
          <p className="text-xs text-[#9B9B9B] text-center mt-2">Saving…</p>
        )}
      </div>
    </div>
  );
}

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
