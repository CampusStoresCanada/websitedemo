"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useToolkit } from "@/components/ui/Toolkit";
import { useAuth } from "@/components/providers/AuthProvider";
import { fieldProps } from "@/lib/editable-fields";
import { assignSlotContact, searchContactsForSlot } from "@/lib/actions/site-content";
import type { SiteContentWithContact, OrgForCard } from "@/lib/data";

interface VoiceCardProps {
  slot: SiteContentWithContact;
}

export default function VoiceCard({ slot }: VoiceCardProps) {
  const { editMode } = useToolkit();
  const { profile } = useAuth();
  const isSuperAdmin = profile?.global_role === "super_admin";

  const contact = slot.contact ?? null;
  const org = contact?.organization ?? null;

  const displayName  = contact?.name ?? slot.title ?? "TBD";
  const displayRole  = contact?.role_title ?? slot.subtitle ?? null;
  const displayPhoto = contact?.profile_picture_url ?? slot.image_url ?? null;
  const displayQuote = slot.body ?? null;

  const primaryColor = getPrimaryColor(org);
  const circleHref   = contact?.id ? `/api/circle/profile/${contact.id}` : null;

  // Warn admins when a linked contact's org is no longer an active member/partner
  const isInactive = org && (
    org.membership_status !== "active" || org.archived_at != null
  );

  return (
    <div className="relative bg-white rounded-3xl border border-[#E5E5E5] p-8 flex flex-col gap-6 hover:shadow-lg hover:border-[#EE2A2E]/20 transition-all duration-300">

      {/* Admin warning: linked org is no longer active */}
      {editMode && isSuperAdmin && isInactive && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
          <span className="text-lg leading-none mt-0.5">⚠️</span>
          <span>
            <strong>{org?.type === "Partner" ? "Partner" : "Member institution"} is no longer active.</strong>{" "}
            Please assign a replacement voice for this slot.
          </span>
        </div>
      )}

      {/* Empty slot nudge */}
      {editMode && isSuperAdmin && !contact && (
        <div className="bg-slate-50 border border-dashed border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-500 text-center">
          No person linked — assign a contact to fill this slot.
        </div>
      )}

      {/* Quote */}
      <div className="flex-1">
        <span className="block text-5xl leading-none font-serif text-[#EE2A2E] mb-3 select-none">&ldquo;</span>
        <p
          className="text-[#1A1A1A] text-lg leading-relaxed"
          {...(slot ? fieldProps("site_content", "body", slot.id) : {})}
        >
          {displayQuote ?? (
            editMode && isSuperAdmin
              ? <span className="italic text-slate-400">Add a quote in edit mode.</span>
              : null
          )}
        </p>
      </div>

      {/* Divider */}
      <div className="border-t border-[#E5E5E5]" />

      {/* Person attribution */}
      <div className="flex items-center gap-4">
        {/* Photo */}
        <div className="relative flex-shrink-0">
          {circleHref ? (
            <a
              href={circleHref}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-14 h-14 rounded-full overflow-hidden hover:opacity-90 transition-opacity"
            >
              <PhotoInner name={displayName} photoUrl={displayPhoto} />
            </a>
          ) : (
            <div className="w-14 h-14 rounded-full overflow-hidden">
              <PhotoInner name={displayName} photoUrl={displayPhoto} />
            </div>
          )}

          {/* Institution logo badge */}
          {org?.logo_url && org?.slug && (
            <Link
              href={`/org/${org.slug}`}
              className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white flex items-center justify-center p-0.5 shadow-md hover:scale-105 transition-transform"
              style={{
                outline: primaryColor ? `2px solid #${primaryColor}` : "2px solid #e5e7eb",
                outlineOffset: "1px",
              }}
              title="View organization profile"
            >
              <img src={org.logo_url} alt="" className="w-full h-full object-contain rounded-full" />
            </Link>
          )}
        </div>

        {/* Name + role + org */}
        <div className="min-w-0">
          <p className="font-semibold text-[#1A1A1A] text-sm leading-snug truncate">
            {displayName}
          </p>
          {displayRole && (
            <p className="text-[#6B6B6B] text-xs leading-snug truncate">{displayRole}</p>
          )}
          {org && (
            <p className="text-[#9B9B9B] text-xs leading-snug truncate mt-0.5">
              {org.type === "Partner" ? "Industry Partner" : "Member Institution"}
            </p>
          )}
        </div>
      </div>

      {/* Edit controls */}
      {editMode && isSuperAdmin && (
        <ChangePersonButton slot={slot} />
      )}
    </div>
  );
}

// ─── Photo inner ──────────────────────────────────────────────────────────────

function PhotoInner({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  if (photoUrl) {
    return <img src={photoUrl} alt={name} className="w-full h-full object-cover" />;
  }
  return (
    <div className="w-full h-full bg-slate-100 flex items-center justify-center">
      <span className="text-slate-400 text-lg font-semibold select-none">{getInitials(name)}</span>
    </div>
  );
}

// ─── Change person ────────────────────────────────────────────────────────────

function ChangePersonButton({ slot }: { slot: SiteContentWithContact }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-[#EE2A2E] underline underline-offset-2 hover:text-[#c91f23] transition-colors self-start"
      >
        {slot.contact ? "Change person" : "Link to contact"}
      </button>
      {open && <ChangePersonDialog slot={slot} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChangePersonDialog({ slot, onClose }: { slot: SiteContentWithContact; onClose: () => void }) {
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
      const res = await assignSlotContact(slot.id, contactId);
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
            {slot.contact ? "Change voice" : "Link a voice"}
          </h2>
          <button onClick={onClose} className="text-[#9B9B9B] hover:text-[#1A1A1A] text-xl leading-none">×</button>
        </div>
        <p className="text-sm text-[#6B6B6B] mb-4">
          Search for a member or partner contact. Their name, photo, and title will pull from their contact record.
          The quote lives in the <strong>body</strong> field — edit it inline on the page.
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
        {slot.contact && (
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPrimaryColor(org: OrgForCard | null): string | null {
  if (!org?.brand_colors?.length) return null;
  const sorted = [...org.brand_colors].sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99));
  for (const { hex } of sorted) {
    if (!hex) continue;
    const n = hex.replace(/^#/, "");
    if (!isNearWhite(n)) return n;
  }
  return null;
}

function isNearWhite(hex: string): boolean {
  const c = hex.padStart(6, "f");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return r >= 230 && g >= 230 && b >= 230;
}

function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}
