"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { updateEvent } from "@/lib/actions/events";
import { loadGooglePlacesScript } from "@/lib/google/places";
import { TAG_GROUPS } from "@/lib/events/tags";
import type { EventAudienceMode } from "@/lib/events/types";
import { AUDIENCE_MODE_LABELS, AUDIENCE_MODE_DESCRIPTIONS } from "@/lib/events/types";

const LENGTHS = [
  { value: 15,  label: "15 min" },
  { value: 30,  label: "30 min" },
  { value: 60,  label: "1 hour" },
  { value: 90,  label: "90 min" },
  { value: 120, label: "2 hours" },
  { value: 180, label: "3 hours" },
];

const ALL_TIMES: { value: string; label: string }[] = (() => {
  const opts = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const label = new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", hour12: true,
      });
      opts.push({ value: `${hh}:${mm}`, label });
    }
  }
  return opts;
})();

/**
 * Convert a UTC ISO string (possibly Supabase format "YYYY-MM-DD HH:mm:ss")
 * into local YYYY-MM-DD and HH:MM parts for the form fields.
 */
function parseUtcToLocal(utcIso: string): { date: string; time: string; lengthMin: number } {
  const normalized = utcIso.endsWith("Z") || utcIso.includes("+")
    ? utcIso
    : utcIso.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    lengthMin: 60,
  };
}

interface EditEventFormProps {
  event: {
    id: string;
    title: string;
    description: string | null;
    starts_at: string;
    ends_at: string | null;
    is_virtual: boolean;
    location: string | null;
    virtual_link: string | null;
    audience_mode: string;
    metadata: Record<string, unknown>;
  };
  googleMapsApiKey?: string | null;
}

// Member-visible audience options (board/org_admin are admin-only)
const MEMBER_AUDIENCE_MODES: EventAudienceMode[] = [
  "public",
  "members_and_partners",
  "members",
  "partners",
];

export default function EditEventForm({ event, googleMapsApiKey = null }: EditEventFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const parsed = parseUtcToLocal(event.starts_at);

  const [title, setTitle]           = useState(event.title);
  const [description, setDescription] = useState(event.description ?? "");
  const [startDate, setStartDate]   = useState(parsed.date);
  const [startTime, setStartTime]   = useState(parsed.time);
  const [isVirtual, setIsVirtual]   = useState(event.is_virtual);
  const [locationOrLink, setLocationOrLink] = useState(
    event.is_virtual ? (event.virtual_link ?? "") : (event.location ?? "")
  );

  const normalizeAudience = (mode: string): EventAudienceMode => {
    if (!mode || mode === "members_only") return "members";
    return mode as EventAudienceMode;
  };
  const [audienceMode, setAudienceMode] = useState<EventAudienceMode>(
    normalizeAudience(event.audience_mode)
  );

  // Compute length from starts_at / ends_at
  const initialLength = (() => {
    if (!event.ends_at) return 60;
    const s = new Date(
      event.starts_at.endsWith("Z") || event.starts_at.includes("+")
        ? event.starts_at
        : event.starts_at.replace(" ", "T") + "Z"
    );
    const e = new Date(
      event.ends_at.endsWith("Z") || event.ends_at.includes("+")
        ? event.ends_at
        : event.ends_at.replace(" ", "T") + "Z"
    );
    const diff = Math.round((e.getTime() - s.getTime()) / 60000);
    return LENGTHS.find((l) => l.value === diff)?.value ?? 60;
  })();
  const [length, setLength] = useState(initialLength);

  // Tags
  const initialTags = (() => {
    const t = event.metadata?.tags;
    return Array.isArray(t) ? (t as string[]) : [];
  })();
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags);
  const [tagsOpen, setTagsOpen] = useState(false);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  const locationInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isVirtual || !googleMapsApiKey) return;
    let isCancelled = false;
    let listener: { remove?: () => void } | null = null;
    const init = async () => {
      try {
        await loadGooglePlacesScript(googleMapsApiKey);
        if (isCancelled || !locationInputRef.current || !window.google?.maps?.places?.Autocomplete) return;
        const ac = new window.google.maps.places.Autocomplete(locationInputRef.current, {
          types: ["establishment", "geocode"],
          fields: ["formatted_address", "name"],
        });
        listener = ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          setLocationOrLink(place.formatted_address ?? place.name ?? "");
        });
      } catch { /* plain text fallback */ }
    };
    void init();
    return () => { isCancelled = true; if (listener?.remove) listener.remove(); };
  }, [isVirtual, googleMapsApiKey]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !startDate || !startTime) return;
    setError(null);

    startTransition(async () => {
      const startsAtDate = new Date(`${startDate}T${startTime}`);
      const endsAtDate   = new Date(startsAtDate.getTime() + length * 60 * 1000);

      const result = await updateEvent(event.id, {
        title,
        description: description || undefined,
        starts_at: startsAtDate.toISOString(),
        ends_at: endsAtDate.toISOString(),
        is_virtual: isVirtual,
        location: isVirtual ? undefined : locationOrLink || undefined,
        virtual_link: isVirtual ? locationOrLink || undefined : undefined,
        audience_mode: audienceMode,
        metadata: { ...event.metadata, tags: selectedTags },
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      router.push("/me/events");
      router.refresh();
    });
  };

  return (
    <form id="edit-event-form" onSubmit={handleSubmit} className="space-y-5">
      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Title <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Description <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E] resize-none"
          placeholder="Brief summary"
        />
      </div>

      {/* Date */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Date <span className="text-red-500">*</span>
        </label>
        <input
          type="date"
          required
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
        />
      </div>

      {/* Time + Length */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Time <span className="text-red-500">*</span>
          </label>
          <select
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
          >
            {ALL_TIMES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Length</label>
          <select
            value={length}
            onChange={(e) => setLength(Number(e.target.value))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
          >
            {LENGTHS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Location / Virtual */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-gray-700">
            {isVirtual ? "Meeting Link" : "Location"}
          </label>
          <button
            type="button"
            onClick={() => { setIsVirtual(!isVirtual); setLocationOrLink(""); }}
            className="text-xs text-[#EE2A2E] hover:underline"
          >
            Switch to {isVirtual ? "in-person" : "virtual"}
          </button>
        </div>
        {isVirtual ? (
          <input
            type="url"
            value={locationOrLink}
            onChange={(e) => setLocationOrLink(e.target.value)}
            placeholder="https://meet.google.com/..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
          />
        ) : (
          <input
            ref={locationInputRef}
            type="text"
            value={locationOrLink}
            onChange={(e) => setLocationOrLink(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
            placeholder="Venue or address"
            autoComplete="off"
          />
        )}
      </div>

      {/* Audience */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Audience</label>
        <select
          value={audienceMode}
          onChange={(e) => setAudienceMode(e.target.value as EventAudienceMode)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
        >
          {MEMBER_AUDIENCE_MODES.map((mode) => (
            <option key={mode} value={mode}>{AUDIENCE_MODE_LABELS[mode]}</option>
          ))}
        </select>
        <p className="text-xs text-gray-400 mt-1">{AUDIENCE_MODE_DESCRIPTIONS[audienceMode]}</p>
      </div>

      {/* Tags — collapsible */}
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setTagsOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <span className="font-medium">
            Relevance Tags
            {selectedTags.length > 0 && (
              <span className="ml-2 text-xs font-bold text-[#163D6D]">
                {selectedTags.length} selected
              </span>
            )}
          </span>
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${tagsOpen ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {tagsOpen && (
          <div className="border-t border-gray-200 px-3 py-3 space-y-3 bg-gray-50">
            <p className="text-xs text-gray-500">
              Tag this event so the right members see it in their "For you" feed.
            </p>
            {TAG_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                  {group.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {group.tags.map((tag) => {
                    const label = "labels" in group
                      ? (group.labels as Record<string, string>)[tag] ?? tag
                      : tag;
                    const isSelected = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border transition-all ${
                          isSelected
                            ? "bg-[#163D6D] text-white border-[#163D6D]"
                            : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending || !title || !startDate || !startTime}
          className="flex-1 px-4 py-2.5 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm transition-colors"
        >
          {isPending ? "Saving…" : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
