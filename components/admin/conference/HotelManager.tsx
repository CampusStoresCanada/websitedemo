"use client";

import { useState } from "react";
import { saveConferenceHotel } from "@/lib/actions/manage-conference-hotel";
import {
  cutoffUrgency,
  daysUntilCutoff,
  formatCutoffDate,
  formatRate,
  type HotelRate,
} from "@/lib/conference/hotel";

const INPUT_CLASS =
  "w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-black/10 focus:border-gray-400";
const LABEL_CLASS =
  "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2";

/** Rates are entered in dollars and stored in cents. */
function centsToInput(cents: number): string {
  if (!Number.isFinite(cents)) return "";
  return Number.isInteger(cents / 100) ? String(cents / 100) : (cents / 100).toFixed(2);
}

interface DraftRate extends Omit<HotelRate, "rate_cents"> {
  /** Kept as the raw string while editing so a half-typed "18" doesn't fight the caret. */
  rateInput: string;
}

export default function HotelManager({
  conferenceId,
  venue,
  today,
  initial,
}: {
  conferenceId: string;
  /** Venue line from the conference record, shown for context — edited on the Edit tab. */
  venue: string;
  /** Today's date (YYYY-MM-DD) resolved on the server, so the cutoff preview
   *  matches what the public page will say rather than the admin's own clock. */
  today: string;
  initial: {
    bookingUrl: string | null;
    bookingCutoff: string | null;
    rates: HotelRate[];
  };
}) {
  const [bookingUrl, setBookingUrl] = useState(initial.bookingUrl ?? "");
  const [bookingCutoff, setBookingCutoff] = useState(initial.bookingCutoff ?? "");
  const [rates, setRates] = useState<DraftRate[]>(
    initial.rates.map((r) => ({ ...r, rateInput: centsToInput(r.rate_cents) }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = () => {
    setSaved(false);
    setError(null);
  };

  const addRate = () => {
    dirty();
    setRates((prev) => [
      ...prev,
      { id: crypto.randomUUID(), label: "", rateInput: "", note: "" },
    ]);
  };

  const updateRate = (id: string, patch: Partial<DraftRate>) => {
    dirty();
    setRates((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRate = (id: string) => {
    dirty();
    setRates((prev) => prev.filter((r) => r.id !== id));
  };

  const moveRate = (id: string, direction: -1 | 1) => {
    dirty();
    setRates((prev) => {
      const index = prev.findIndex((r) => r.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    setError(null);
    setSaved(false);

    const parsed: HotelRate[] = [];
    for (const rate of rates) {
      const label = rate.label.trim();
      if (!label) {
        setError("Every rate needs a room type label.");
        return;
      }
      const dollars = Number(rate.rateInput);
      if (!rate.rateInput.trim() || !Number.isFinite(dollars) || dollars < 0) {
        setError(`"${label}" needs a nightly rate.`);
        return;
      }
      parsed.push({
        id: rate.id,
        label,
        rate_cents: Math.round(dollars * 100),
        ...(rate.note?.trim() ? { note: rate.note.trim() } : {}),
      });
    }

    setSaving(true);
    const result = await saveConferenceHotel(conferenceId, {
      bookingUrl: bookingUrl.trim() || null,
      bookingCutoff: bookingCutoff.trim() || null,
      rates: parsed,
    });
    setSaving(false);

    if (!result.success) {
      setError(result.error ?? "Failed to save");
      return;
    }
    setSaved(true);
  };

  const urgency = cutoffUrgency(bookingCutoff || null, today);
  const linkLive = Boolean(bookingUrl.trim());

  return (
    <div className="space-y-6">
      {/* What the public page is doing right now */}
      <div
        className={`rounded-xl border p-4 text-sm ${
          linkLive
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-amber-200 bg-amber-50 text-amber-900"
        }`}
      >
        {linkLive ? (
          <>
            <span className="font-semibold">Booking link is live.</span> Members and
            partners see a Book your room button on the conference page.
          </>
        ) : (
          <>
            <span className="font-semibold">No booking link yet.</span> The conference
            page shows the rates and a &ldquo;link coming soon&rdquo; note instead of a
            button. Paste a link below to make it live.
          </>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-5">
        <div>
          <label className={LABEL_CLASS} htmlFor="hotel-booking-url">
            Booking link
          </label>
          <input
            id="hotel-booking-url"
            type="url"
            value={bookingUrl}
            onChange={(e) => {
              dirty();
              setBookingUrl(e.target.value);
            }}
            placeholder="https://book.hotel.com/csc-2027"
            className={`${INPUT_CLASS} font-mono`}
          />
          <p className="mt-1.5 text-xs text-gray-500">
            The hotel&apos;s room-block URL. Leave empty until it exists — the page
            handles that case on its own.
          </p>
        </div>

        <div>
          <label className={LABEL_CLASS} htmlFor="hotel-booking-cutoff">
            Book-by date
          </label>
          <input
            id="hotel-booking-cutoff"
            type="date"
            value={bookingCutoff}
            onChange={(e) => {
              dirty();
              setBookingCutoff(e.target.value);
            }}
            className={INPUT_CLASS}
          />
          <p className="mt-1.5 text-xs text-gray-500">
            {urgency === "none" && "The date the room block releases. Optional."}
            {urgency === "upcoming" && (
              <>
                Page will show <strong>Book by {formatCutoffDate(bookingCutoff)}</strong> —{" "}
                {daysUntilCutoff(bookingCutoff, today)} days away.
              </>
            )}
            {urgency === "soon" && (
              <span className="text-amber-700">
                Page will show a countdown —{" "}
                <strong>{daysUntilCutoff(bookingCutoff, today)} days left</strong> to book
                at this rate.
              </span>
            )}
            {urgency === "passed" && (
              <span className="text-red-600">
                This date has passed — the page has stopped promoting the rate and tells
                people the block has closed.
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Rates */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Room rates</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              One row per room type, shown in this order at {venue || "the venue"}.
            </p>
          </div>
          <button
            type="button"
            onClick={addRate}
            className="px-3 py-1.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors"
          >
            Add rate
          </button>
        </div>

        {rates.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center border border-dashed border-gray-200 rounded-lg">
            No rates yet. The page will show the venue and map without pricing.
          </p>
        ) : (
          <ul className="space-y-3">
            {rates.map((rate, index) => (
              <li
                key={rate.id}
                className="grid gap-3 md:grid-cols-[1fr_130px_1fr_auto] md:items-start rounded-lg border border-gray-100 bg-gray-50/60 p-3"
              >
                <div>
                  <label className={LABEL_CLASS} htmlFor={`rate-label-${rate.id}`}>
                    Room type
                  </label>
                  <input
                    id={`rate-label-${rate.id}`}
                    type="text"
                    value={rate.label}
                    onChange={(e) => updateRate(rate.id, { label: e.target.value })}
                    placeholder="Single occupancy"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS} htmlFor={`rate-amount-${rate.id}`}>
                    Per night
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                      $
                    </span>
                    <input
                      id={`rate-amount-${rate.id}`}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={rate.rateInput}
                      onChange={(e) => updateRate(rate.id, { rateInput: e.target.value })}
                      placeholder="185"
                      className={`${INPUT_CLASS} pl-7`}
                    />
                  </div>
                </div>
                <div>
                  <label className={LABEL_CLASS} htmlFor={`rate-note-${rate.id}`}>
                    Note <span className="normal-case font-normal">(optional)</span>
                  </label>
                  <input
                    id={`rate-note-${rate.id}`}
                    type="text"
                    value={rate.note ?? ""}
                    onChange={(e) => updateRate(rate.id, { note: e.target.value })}
                    placeholder="plus tax"
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="flex md:flex-col gap-1 md:pt-7">
                  <button
                    type="button"
                    onClick={() => moveRate(rate.id, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${rate.label || "rate"} up`}
                    className="px-2 py-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveRate(rate.id, 1)}
                    disabled={index === rates.length - 1}
                    aria-label={`Move ${rate.label || "rate"} down`}
                    className="px-2 py-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRate(rate.id)}
                    aria-label={`Remove ${rate.label || "rate"}`}
                    className="px-2 py-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Preview of the public line */}
      {rates.some((r) => r.label.trim() && r.rateInput.trim()) && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <p className={LABEL_CLASS}>How it reads on the conference page</p>
          <ul className="space-y-1">
            {rates
              .filter((r) => r.label.trim() && r.rateInput.trim())
              .map((r) => (
                <li key={r.id} className="text-sm text-gray-700">
                  <span className="font-medium text-gray-900">{r.label.trim()}</span>
                  {" — "}
                  <span className="font-semibold text-gray-900">
                    {formatRate(Math.round(Number(r.rateInput) * 100))}
                  </span>
                  /night
                  {r.note?.trim() ? `, ${r.note.trim()}` : ""}
                </li>
              ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {saved && !error && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          Saved. The conference page is updated.
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save hotel details"}
        </button>
      </div>
    </div>
  );
}
