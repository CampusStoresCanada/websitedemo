"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useToolkit } from "@/components/ui/Toolkit";
import { useAuth } from "@/components/providers/AuthProvider";
import { fieldProps } from "@/lib/editable-fields";
import { assignSlotContact, searchContactsForSlot } from "@/lib/actions/site-content";
import type { SiteContentWithContact, OrgForCard } from "@/lib/data";

interface BoardCardProps {
  person: SiteContentWithContact;
}

export default function BoardCard({ person }: BoardCardProps) {
  const { editMode } = useToolkit();
  const { user, profile } = useAuth();
  const isSuperAdmin = profile?.global_role === "super_admin";

  const contact = person.contact ?? null;
  const org = contact?.organization ?? null;

  const displayName = contact?.name ?? person.title ?? "TBD";
  const boardPosition = person.subtitle ?? null;       // "President", "VP", etc. — always from slot
  const institutionalRole = contact?.role_title ?? null; // day job — only from linked contact
  const displayPhoto = contact?.profile_picture_url ?? person.image_url ?? null;

  // Primary brand colour for the circle border
  const primaryColor = getPrimaryColor(org);
  const circleHref = contact?.id ? `/api/circle/profile/${contact.id}` : null;

  return (
    <div className="text-center flex flex-col items-center">

      {/* ── Photo + badge ─────────────────────────────────── */}
      <div className="relative mb-5">

        {/* Photo circle — plain, no border */}
        {circleHref && user ? (
          <a
            href={circleHref}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-32 h-32 rounded-full overflow-hidden hover:opacity-90 transition-opacity"
            title={`Open ${displayName}'s community profile`}
          >
            <PhotoInner name={displayName} photoUrl={displayPhoto} />
          </a>
        ) : (
          <div className="w-32 h-32 rounded-full overflow-hidden">
            <PhotoInner name={displayName} photoUrl={displayPhoto} />
          </div>
        )}

        {/* Institution logo badge — bottom-right, coloured border */}
        {org?.logo_url && org?.slug && (
          <Link
            href={`/org/${org.slug}`}
            className="absolute bottom-0 right-0 w-10 h-10 rounded-full bg-white flex items-center justify-center p-1 hover:scale-105 transition-transform shadow-md"
            style={{
              outline: primaryColor ? `3px solid #${primaryColor}` : "3px solid #e5e7eb",
              outlineOffset: "1px",
            }}
            title="View institution profile"
          >
            <img
              src={org.logo_url}
              alt=""
              className="w-full h-full object-contain rounded-full"
            />
          </Link>
        )}
      </div>

      {/* ── Text ──────────────────────────────────────────── */}
      <div className="space-y-0.5">
        {/* Name */}
        <h3
          className="font-semibold text-[#1A1A1A] text-base leading-snug"
          {...(!contact ? fieldProps("site_content", "title", person.id) : {})}
        >
          {displayName}
        </h3>

        {/* Board position — always shown, styled as a small pill */}
        {boardPosition && (
          <p
            className="inline-block text-xs font-medium text-[#EE2A2E] bg-[#EE2A2E]/8 px-2.5 py-0.5 rounded-full mt-1"
            {...fieldProps("site_content", "subtitle", person.id)}
          >
            {boardPosition}
          </p>
        )}

        {/* Institutional role — only when contact is linked */}
        {institutionalRole && (
          <p className="text-[#6B6B6B] text-sm mt-1 leading-snug">
            {institutionalRole}
          </p>
        )}

        {/* Unlinked placeholder — nudge for admins in edit mode */}
        {!contact && editMode && isSuperAdmin && (
          <p className="text-xs text-amber-500 mt-1">No contact linked</p>
        )}
      </div>

      {/* ── Change person (super_admin, edit mode) ────────── */}
      {editMode && isSuperAdmin && (
        <ChangePersonButton person={person} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Photo inner — shared between linked and unlinked states
// ─────────────────────────────────────────────────────────────────

function PhotoInner({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={name}
        className="w-full h-full object-cover"
      />
    );
  }
  return (
    <div className="w-full h-full bg-slate-100 flex items-center justify-center">
      <span className="text-slate-400 text-2xl font-semibold select-none">
        {getInitials(name)}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Change person dialog (same pattern as PersonCard)
// ─────────────────────────────────────────────────────────────────

function ChangePersonButton({ person }: { person: SiteContentWithContact }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mt-2 text-xs text-[#EE2A2E] underline underline-offset-2 hover:text-[#c91f23] transition-colors"
      >
        {person.contact ? "Change person" : "Link to contact"}
      </button>
      {open && <ChangePersonDialog person={person} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChangePersonDialog({ person, onClose }: { person: SiteContentWithContact; onClose: () => void }) {
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
    if (value.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    const res = await searchContactsForSlot(value);
    setSearching(false);
    if (res.success && res.data) setResults(res.data);
  }

  function handleSelect(contactId: string | null) {
    setError(null);
    startTransition(async () => {
      const res = await assignSlotContact(person.id, contactId);
      if (res.success) onClose();
      else setError(res.error ?? "Failed to assign contact");
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
          <button onClick={onClose} className="text-[#9B9B9B] hover:text-[#1A1A1A] text-xl leading-none">×</button>
        </div>
        <p className="text-sm text-[#6B6B6B] mb-4">
          Filling the <strong>{person.subtitle ?? person.title ?? "slot"}</strong> position.
          Name, photo, and job title will pull from the contact record.
        </p>
        <input
          type="text"
          placeholder="Search by name…"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#EE2A2E]/30 mb-3"
          autoFocus
        />
        {searching && <p className="text-xs text-[#9B9B9B] mb-2">Searching…</p>}
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
                    <img src={c.profile_picture_url} alt={c.name ?? ""} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0">
                      <span className="text-slate-500 text-xs font-semibold">{getInitials(c.name)}</span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#1A1A1A] truncate">{c.name}</p>
                    {c.role_title && <p className="text-xs text-[#6B6B6B] truncate">{c.role_title}</p>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
        {person.contact && (
          <button
            onClick={() => handleSelect(null)}
            disabled={isPending}
            className="w-full text-sm text-[#9B9B9B] hover:text-[#EE2A2E] transition-colors py-2 border border-slate-200 rounded-lg mt-1"
          >
            Remove contact link
          </button>
        )}
        {isPending && <p className="text-xs text-[#9B9B9B] text-center mt-2">Saving…</p>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Returns a normalised hex string (no #) for the first brand colour that isn't
 *  white or near-white, walking up the sort_order list until one is found.
 *  Handles DB values that may or may not include a leading #. */
function getPrimaryColor(org: OrgForCard | null): string | null {
  if (!org?.brand_colors?.length) return null;
  const sorted = [...org.brand_colors].sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
  for (const { hex } of sorted) {
    if (!hex) continue;
    const normalised = hex.replace(/^#/, "");
    if (!isNearWhite(normalised)) return normalised;
  }
  return null; // all colours near-white — fall back to default grey outline
}

/** True when a hex colour (no leading #) is white or close enough to disappear
 *  on a white background. Threshold: all RGB channels ≥ 230 out of 255. */
function isNearWhite(hex: string): boolean {
  const clean = hex.padStart(6, "f");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return r >= 230 && g >= 230 && b >= 230;
}

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}
