"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createEventByMember } from "@/lib/actions/events";
import { useAuth } from "@/components/providers/AuthProvider";
import { loadGooglePlacesScript } from "@/lib/google/places";

const LENGTHS = [
  { value: 15,  label: "15 min" },
  { value: 30,  label: "30 min" },
  { value: 60,  label: "1 hour" },
  { value: 90,  label: "90 min" },
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

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nextQuarterHourTime(): string {
  const d = new Date();
  const ms = 15 * 60 * 1000;
  const next = new Date(Math.ceil(d.getTime() / ms) * ms);
  return `${String(next.getHours()).padStart(2, "0")}:${String(next.getMinutes()).padStart(2, "0")}`;
}

interface CreateEventModalProps {
  onClose: () => void;
  googleMapsApiKey?: string | null;
}

export default function CreateEventModal({ onClose, googleMapsApiKey = null }: CreateEventModalProps) {
  const { profile } = useAuth();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(todayStr());
  const [startTime, setStartTime] = useState(nextQuarterHourTime());
  const [length, setLength] = useState(60);

  const today = todayStr();
  const minTime = startDate === today ? nextQuarterHourTime() : "00:00";
  const timeOptions = ALL_TIMES.filter((t) => startDate > today || t.value >= minTime);
  const [isVirtual, setIsVirtual] = useState(true);
  const [locationOrLink, setLocationOrLink] = useState("");
  const [description, setDescription] = useState("");
  const [audienceMode, setAudienceMode] = useState<"members_only" | "public">("members_only");

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

  const isAdmin =
    profile?.global_role === "admin" || profile?.global_role === "super_admin";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !startDate || !startTime) return;
    setError(null);

    startTransition(async () => {
      const startsAtDate = new Date(`${startDate}T${startTime}`);
      const endsAtDate = new Date(startsAtDate.getTime() + length * 60 * 1000);

      const result = await createEventByMember({
        title,
        description: description || undefined,
        starts_at: startsAtDate.toISOString(),
        ends_at: endsAtDate.toISOString(),
        is_virtual: isVirtual,
        ...(!isVirtual && { location: locationOrLink || undefined }),
        audience_mode: audienceMode,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      if (isAdmin) {
        router.push(`/admin/events/${result.data.id}/edit`);
      } else {
        router.push("/me");
        router.refresh();
      }

      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Create Event</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E]"
              placeholder="What's the event?"
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
              min={today}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (e.target.value === todayStr()) {
                  const min = nextQuarterHourTime();
                  if (startTime < min) setStartTime(min);
                }
              }}
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
                {timeOptions.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Length <span className="text-red-500">*</span>
              </label>
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
                onClick={() => {
                  setIsVirtual(!isVirtual);
                  setLocationOrLink("");
                }}
                className="text-xs text-[#EE2A2E] hover:underline"
              >
                Switch to {isVirtual ? "in-person" : "virtual"}
              </button>
            </div>
            {isVirtual ? (
              <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2.5">
                A Google Meet link will be generated automatically when your event is published.
              </p>
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

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description{" "}
              <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] focus:border-[#EE2A2E] resize-none"
              placeholder="Brief summary"
            />
          </div>

          {/* Audience */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Audience</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="modal_audience"
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
                  name="modal_audience"
                  value="public"
                  checked={audienceMode === "public"}
                  onChange={() => setAudienceMode("public")}
                  className="text-[#EE2A2E] focus:ring-[#EE2A2E]"
                />
                <span className="text-sm text-gray-700">Public</span>
              </label>
            </div>
          </div>

          {!isAdmin && (
            <p className="text-xs text-gray-400 bg-gray-50 rounded-lg p-2.5">
              Your event will be reviewed by a CSC admin before going live. You'll be able to add more details after submitting.
            </p>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={isPending || !title || !startDate || !startTime}
              className="flex-1 px-4 py-2.5 rounded-lg bg-[#EE2A2E] hover:bg-[#D92327] disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm transition-colors"
            >
              {isPending ? "Creating…" : isAdmin ? "Create & Edit" : "Submit for Review"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
