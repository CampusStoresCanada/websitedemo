"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createEvent, updateEvent, requestEventChanges } from "@/lib/actions/events";
import { upsertBoardMeetingForEvent } from "@/lib/actions/board-meeting-event";
import { loadGooglePlacesScript } from "@/lib/google/places";
import type { Event, EventAudienceMode, CreateEventPayload, UpdateEventPayload } from "@/lib/events/types";
import { AUDIENCE_MODE_LABELS, AUDIENCE_MODE_DESCRIPTIONS } from "@/lib/events/types";
import { TAG_GROUPS } from "@/lib/events/tags";
import RichTextEditor from "@/components/ui/RichTextEditor";
import BoardMeetingDocuments from "@/components/admin/events/BoardMeetingDocuments";

/**
 * Convert a UTC ISO string to the "YYYY-MM-DDTHH:mm" local-time string
 * that a datetime-local input expects.
 *
 * Supabase returns timestamps as "2026-03-20 17:30:00" — no timezone marker,
 * space separator. JS treats those as LOCAL time, not UTC. We must append "Z"
 * to force UTC interpretation before converting to local display time.
 */
function utcToLocalInput(utcIso: string): string {
  // Normalize Supabase "YYYY-MM-DD HH:mm:ss" → "YYYY-MM-DDTHH:mm:ssZ"
  const normalized = utcIso.endsWith("Z") || utcIso.includes("+")
    ? utcIso
    : utcIso.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface EventFormProps {
  event?: Event;
  isEdit?: boolean;
  fromReview?: boolean;
  googleMapsApiKey?: string | null;
}

export default function EventForm({ event, isEdit = false, fromReview = false, googleMapsApiKey = null }: EventFormProps) {
  const router = useRouter();

  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [bodyHtml, setBodyHtml] = useState(event?.body_html ?? "");
  const [startsAt, setStartsAt] = useState(
    event?.starts_at ? utcToLocalInput(event.starts_at) : ""
  );
  const [endsAt, setEndsAt] = useState(
    event?.ends_at ? utcToLocalInput(event.ends_at) : ""
  );
  const [isVirtual, setIsVirtual] = useState(event?.is_virtual ?? false);
  const [location, setLocation] = useState(event?.location ?? "");
  const [virtualLink, setVirtualLink] = useState(event?.virtual_link ?? "");
  // Normalize legacy "members_only" → "members" if it somehow comes from the DB
  const normalizeAudienceMode = (mode: string | undefined): EventAudienceMode => {
    if (!mode || mode === "members_only") return "members";
    return mode as EventAudienceMode;
  };
  const [audienceMode, setAudienceMode] = useState<EventAudienceMode>(
    normalizeAudienceMode(event?.audience_mode)
  );
  const [capacity, setCapacity] = useState<string>(
    event?.capacity != null ? String(event.capacity) : ""
  );
  const [slugOverride, setSlugOverride] = useState(event?.slug ?? "");

  // Tags — stored in metadata.tags
  const initialTags: string[] = (() => {
    const meta = event?.metadata;
    if (!meta || typeof meta !== "object") return [];
    const t = (meta as Record<string, unknown>)["tags"];
    return Array.isArray(t) ? (t as string[]) : [];
  })();
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags);

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  const [isLoading, setIsLoading] = useState(false);
  const [isNotifying, setIsNotifying] = useState(false);
  const [adminNote, setAdminNote] = useState("");
  const [error, setError] = useState<string | null>(null);

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
          setLocation(place.formatted_address ?? place.name ?? "");
        });
      } catch {
        // Places unavailable — input stays as plain text
      }
    };

    void init();

    return () => {
      isCancelled = true;
      if (listener?.remove) listener.remove();
    };
  }, [isVirtual, googleMapsApiKey]);

  function buildPayload(): CreateEventPayload & UpdateEventPayload {
    return {
      title,
      description: description || undefined,
      body_html: bodyHtml || undefined,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: endsAt ? new Date(endsAt).toISOString() : undefined,
      is_virtual: isVirtual,
      location: isVirtual ? undefined : location || undefined,
      virtual_link: isVirtual ? virtualLink || undefined : undefined,
      audience_mode: audienceMode,
      capacity: capacity ? Number(capacity) : undefined,
      ...(isEdit && slugOverride ? { slug: slugOverride } : {}),
      metadata: {
        ...((typeof event?.metadata === "object" && event?.metadata) ? event.metadata as Record<string, unknown> : {}),
        tags: selectedTags,
      },
    };
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const payload = buildPayload();
    let result: { success: boolean; error?: string; data?: Event };

    if (isEdit && event) {
      result = await updateEvent(event.id, payload as UpdateEventPayload);
    } else {
      result = await createEvent(payload as CreateEventPayload);
    }

    setIsLoading(false);

    if (!result.success) {
      setError(result.error ?? "Something went wrong");
      return;
    }

    const createdEvent = (result as { data?: Event }).data;

    // When creating a new board-audience event, auto-create the linked board meeting + Notion page
    if (!isEdit && audienceMode === "board" && createdEvent?.id && createdEvent?.starts_at) {
      const dateStr = createdEvent.starts_at.slice(0, 10); // YYYY-MM-DD
      await upsertBoardMeetingForEvent(createdEvent.id, {
        meetingType: "regular",
        title: createdEvent.title,
        meetingDate: dateStr,
      });
    }

    if (isEdit) {
      router.refresh();
    } else {
      router.push(`/admin/events/${createdEvent?.id}`);
    }
  };

  const handleNotifyCreator = async () => {
    if (!event) return;
    setIsNotifying(true);
    setError(null);

    const result = await requestEventChanges(
      event.id,
      buildPayload() as UpdateEventPayload,
      adminNote || undefined
    );

    setIsNotifying(false);

    if (!result.success) {
      setError(result.error ?? "Something went wrong");
      return;
    }

    router.push("/admin/events?action_success=changes_sent");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Change-request banner */}
      {fromReview && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">📝 Change Request Mode</p>
          <p className="text-amber-700">
            You arrived here from a review email. Make your edits below, then use{" "}
            <strong>Save & Notify Creator</strong> to send the changes back to the submitter.
            Regular save will save without notifying.
          </p>
        </div>
      )}

      {/* Basic info */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-gray-700 border-b border-gray-200 pb-2 w-full">
          Event Details
        </legend>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
            placeholder="Event title"
          />
        </div>

        {isEdit && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
            <input
              type="text"
              value={slugOverride}
              onChange={(e) => setSlugOverride(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
              placeholder="auto-generated-from-title"
            />
            <p className="text-xs text-gray-400 mt-1">Leave unchanged to keep current slug</p>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Short Description</label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
            placeholder="Brief summary shown in event listings"
          />
        </div>

        {audienceMode === "board" ? (
          <div className="rounded-lg border border-[#163D6D]/20 bg-[#163D6D]/5 px-4 py-3 text-sm text-[#163D6D]/80">
            🏛️ <strong>Board meeting content</strong> — agenda, minutes, action items, and documents are managed in the{" "}
            <a href="/admin/board/meetings" className="underline font-medium hover:text-[#163D6D]">
              Board Portal
            </a>
            , not here.
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Description</label>
            <RichTextEditor
              value={bodyHtml}
              onChange={setBodyHtml}
              placeholder="Full event details — type / for formatting"
              minHeight="160px"
            />
          </div>
        )}
      </fieldset>

      {/* Dates */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-gray-700 border-b border-gray-200 pb-2 w-full">
          Date & Time
        </legend>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start <span className="text-red-500">*</span>
            </label>
            <input
              type="datetime-local"
              required
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End</label>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
            />
          </div>
        </div>
      </fieldset>

      {/* Location */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-gray-700 border-b border-gray-200 pb-2 w-full">
          Location
        </legend>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="is_virtual"
            checked={isVirtual}
            onChange={(e) => setIsVirtual(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-accent focus:ring-accent"
          />
          <label htmlFor="is_virtual" className="text-sm text-gray-700">
            This is a virtual event
          </label>
        </div>

        {isVirtual ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Meeting Link</label>
            <input
              type="url"
              value={virtualLink}
              onChange={(e) => setVirtualLink(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
              placeholder="https://zoom.us/j/..."
            />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input
              ref={locationInputRef}
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
              placeholder="Venue name or address"
            />
          </div>
        )}
      </fieldset>

      {/* Access & Capacity */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-gray-700 border-b border-gray-200 pb-2 w-full">
          Access & Capacity
        </legend>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Audience</label>
          <select
            value={audienceMode}
            onChange={(e) => setAudienceMode(e.target.value as EventAudienceMode)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
          >
            {(Object.keys(AUDIENCE_MODE_LABELS) as EventAudienceMode[]).map((mode) => (
              <option key={mode} value={mode}>{AUDIENCE_MODE_LABELS[mode]}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-1">{AUDIENCE_MODE_DESCRIPTIONS[audienceMode]}</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Capacity{" "}
            <span className="font-normal text-gray-400">(leave blank for unlimited)</span>
          </label>
          <input
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent"
            placeholder="e.g. 50"
          />
        </div>
      </fieldset>

      {/* Tags — for "For you" matching */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-gray-700 border-b border-gray-200 pb-2 w-full">
          Tags{" "}
          <span className="font-normal text-gray-400">
            — used to surface this event as "For you" to relevant members
          </span>
        </legend>

        {TAG_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              {group.label}
            </p>
            <div className="flex flex-wrap gap-2">
              {group.tags.map((tag) => {
                const label = "labels" in group ? (group.labels as Record<string, string>)[tag] ?? tag : tag;
                const isSelected = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                      isSelected
                        ? "bg-[#163D6D] text-white border-[#163D6D]"
                        : "bg-white text-gray-600 border-gray-300 hover:border-gray-400 hover:text-gray-800"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {selectedTags.length > 0 && (
          <p className="text-xs text-gray-400">
            {selectedTags.length} tag{selectedTags.length !== 1 ? "s" : ""} selected
          </p>
        )}
      </fieldset>

      {/* Admin note + notify (only when arriving from a review email) */}
      {fromReview && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-gray-700 border-b border-gray-200 pb-2 w-full">
            Note to Creator{" "}
            <span className="font-normal text-gray-400">(optional)</span>
          </legend>
          <textarea
            rows={3}
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 focus:border-amber-400"
            placeholder="Explain what was changed and why, or leave blank…"
          />
        </fieldset>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3 pt-2">
        {fromReview ? (
          <>
            <button
              type="button"
              onClick={handleNotifyCreator}
              disabled={isNotifying || isLoading}
              className="px-6 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 text-white font-semibold text-sm transition-colors"
            >
              {isNotifying ? "Sending…" : "Save & Notify Creator"}
            </button>
            <button
              type="submit"
              disabled={isLoading || isNotifying}
              className="px-6 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 disabled:text-gray-400 transition-colors"
            >
              {isLoading ? "Saving…" : "Save Without Notifying"}
            </button>
          </>
        ) : (
          <button
            type="submit"
            disabled={isLoading}
            className="px-6 py-2.5 rounded-lg bg-accent hover:bg-accent-hover disabled:bg-gray-300 text-white font-semibold text-sm transition-colors"
          >
            {isLoading ? "Saving…" : isEdit ? "Save Changes" : "Create Event"}
          </button>
        )}
        <button
          type="button"
          onClick={() => router.back()}
          className="px-6 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
      </div>

      {/* Board meeting documents — only shown for board-audience events that already exist */}
      {audienceMode === "board" && isEdit && event?.id && event.starts_at && (
        <div className="mt-6">
          <BoardMeetingDocuments
            eventId={event.id}
            eventTitle={event.title ?? ""}
            eventDate={event.starts_at}
          />
        </div>
      )}

      {audienceMode === "board" && !isEdit && (
        <div className="mt-4 rounded-lg border border-[#163D6D]/20 bg-[#163D6D]/5 px-4 py-3 text-sm text-[#163D6D]/70">
          🏛️ Saving will automatically create a linked Board Portal record and Notion scratchpad.
        </div>
      )}
    </form>
  );
}
