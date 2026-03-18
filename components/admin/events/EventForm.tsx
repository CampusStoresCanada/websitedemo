"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createEvent, updateEvent, requestEventChanges } from "@/lib/actions/events";
import { loadGooglePlacesScript } from "@/lib/google/places";
import type { Event, CreateEventPayload, UpdateEventPayload } from "@/lib/events/types";

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
  const [audienceMode, setAudienceMode] = useState<"public" | "members_only">(
    event?.audience_mode ?? "members_only"
  );
  const [capacity, setCapacity] = useState<string>(
    event?.capacity != null ? String(event.capacity) : ""
  );
  const [slugOverride, setSlugOverride] = useState(event?.slug ?? "");

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

    if (isEdit) {
      router.refresh();
    } else {
      router.push(`/admin/events/${(result as { data?: Event }).data?.id}`);
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
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
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
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
            placeholder="Brief summary shown in event listings"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Full Description (HTML)</label>
          <textarea
            rows={8}
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
            placeholder="<p>Full event details…</p>"
          />
        </div>
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End</label>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
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
            className="h-4 w-4 rounded border-gray-300 text-[#EE2A2E] focus:ring-[#EE2A2E]"
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
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
          <label className="block text-sm font-medium text-gray-700 mb-2">Audience</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="audience_mode"
                value="members_only"
                checked={audienceMode === "members_only"}
                onChange={() => setAudienceMode("members_only")}
                className="text-[#EE2A2E] focus:ring-[#EE2A2E]"
              />
              <span className="text-sm text-gray-700">Members only</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="audience_mode"
                value="public"
                checked={audienceMode === "public"}
                onChange={() => setAudienceMode("public")}
                className="text-[#EE2A2E] focus:ring-[#EE2A2E]"
              />
              <span className="text-sm text-gray-700">Public</span>
            </label>
          </div>
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
            className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
            placeholder="e.g. 50"
          />
        </div>
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
            className="px-6 py-2.5 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] disabled:bg-gray-300 text-white font-semibold text-sm transition-colors"
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
    </form>
  );
}
