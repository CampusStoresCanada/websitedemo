"use client";

import { useRef, useState } from "react";
import { confirmLogos } from "@/lib/actions/benchmarking-profile";
import { uploadOrganizationImage } from "@/lib/actions/upload-organization-image";

/**
 * Confirm — or replace — the two logos the website uses.
 *
 * All 50 active member stores have a logo mark on file. Six have a horizontal
 * logo. So 44 stores are missing the asset banners and listings actually need,
 * and we have been falling back to the mark or to nothing.
 *
 * This is the one moment a year when every store is already confirming its
 * figures, its people and its locations. Asking here costs a glance for the
 * stores that are fine and gets us the other 44.
 *
 * ⛔ Confirming never blanks what we hold — see confirmLogos. A store saying
 * "yes that is still us" must not be able to delete its own logo by accident.
 */

/**
 * A real ceiling, checked before the file goes anywhere.
 *
 * The upload path encodes the file as base64 inside a Server Action request,
 * and the body cap lands the true limit near 4MB — under which a larger file is
 * rejected before our code runs, so nothing is logged and the reader sees a
 * generic failure. Stating 4MB and checking it here turns that into a sentence
 * they can act on. A logo has no business being bigger.
 */
const MAX_BYTES = 4 * 1024 * 1024;

const ALLOWED = ["image/svg+xml", "image/png", "image/jpeg", "image/webp"];

/** Bitmaps below this are too soft to print or to sit on a banner. */
const MIN_BITMAP_PX = 250;

interface Slot {
  key: "logo" | "logo_horizontal";
  label: string;
  where: string;
  guidance: string;
  /** Checked for bitmaps only: vector has no pixel dimensions to fail. */
  square: boolean;
}

const SLOTS: Slot[] = [
  {
    key: "logo",
    label: "Logo mark",
    where: "Used in listings, small spaces and the member directory.",
    guidance:
      "Square, 1:1. A vector file (SVG) is best — it stays sharp at any size. If all you have is a bitmap, it needs to be at least 250 × 250 pixels. No background, please: transparent PNG or SVG, not a logo sitting on a white box.",
    square: true,
  },
  {
    key: "logo_horizontal",
    label: "Horizontal logo",
    where: "Used on banners and anywhere wide. This is the one we are usually missing.",
    guidance:
      "Please upload the logo for your institution. Get it from your branding guide. Use a vector graphic (SVG). If it is a bitmap, please make sure it is the highest quality you have, and no background.",
    square: false,
  },
];

/** Pixel dimensions of a bitmap, or null for a vector we cannot measure. */
function measure(file: File): Promise<{ w: number; h: number } | null> {
  if (file.type === "image/svg+xml") return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

export default function LogoConfirm({
  benchmarkingId,
  organizationId,
  logoUrl,
  logoHorizontalUrl,
  confirmedAt,
  isReadOnly,
}: {
  benchmarkingId: string;
  organizationId: string;
  logoUrl: string | null;
  logoHorizontalUrl: string | null;
  confirmedAt: string | null;
  isReadOnly: boolean;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({
    logo: logoUrl ?? "",
    logo_horizontal: logoHorizontalUrl ?? "",
  });
  const [confirmed, setConfirmed] = useState(Boolean(confirmedAt));
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  async function pick(slot: Slot, file: File) {
    setError(null);
    setNotes((n) => ({ ...n, [slot.key]: "" }));

    if (!ALLOWED.includes(file.type)) {
      setError(`${slot.label}: we can take SVG, PNG, JPEG or WebP. That file is ${file.type || "an unknown type"}.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `${slot.label}: that file is ${(file.size / 1024 / 1024).toFixed(1)}MB and the limit is 4MB. A logo should be well under that — if it is a photograph of a logo, ask your marketing team for the original.`,
      );
      return;
    }

    const size = await measure(file);
    if (size) {
      if (Math.min(size.w, size.h) < MIN_BITMAP_PX) {
        setError(
          `${slot.label}: that image is ${size.w} × ${size.h} pixels, and a bitmap needs to be at least ${MIN_BITMAP_PX} × ${MIN_BITMAP_PX}. It will look soft anywhere we use it. An SVG from your branding guide has no size limit at all.`,
        );
        return;
      }
      if (slot.square) {
        const ratio = size.w / size.h;
        if (ratio < 0.9 || ratio > 1.1) {
          // Not refused: a store's mark is its own. Said plainly instead.
          setNotes((n) => ({
            ...n,
            [slot.key]: `That is ${size.w} × ${size.h}, which is not square. The mark is used in square spaces, so it will be padded. If you have a 1:1 version it will look better.`,
          }));
        }
      }
    }

    setBusy(slot.key);
    try {
      const fileData = await readAsDataUrl(file);
      const res = await uploadOrganizationImage({
        organizationId,
        imageType: slot.key,
        fileData,
        fileName: file.name,
        contentType: file.type,
      });
      if (!res.success || !res.url) {
        setError(res.error ?? `${slot.label}: the upload did not go through.`);
        return;
      }
      setUrls((u) => ({ ...u, [slot.key]: res.url! }));
      setConfirmed(false);
    } catch {
      setError(`${slot.label}: could not read that file.`);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await confirmLogos({
      benchmarkingId,
      logoUrl: urls.logo.trim() || undefined,
      logoHorizontalUrl: urls.logo_horizontal.trim() || undefined,
    });
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? "Could not save that.");
      return;
    }
    setConfirmed(true);
  }

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h3 className="text-sm font-medium text-gray-900">Your logos</h3>
      <p className="mt-1 text-xs text-gray-600">
        These are what we put beside your store on the CSC site. Worth ten seconds while
        you are here — most stores have never given us the horizontal one.
      </p>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        {SLOTS.map((slot) => {
          const value = urls[slot.key];
          return (
            <div key={slot.key}>
              <label className="block text-xs font-medium text-gray-700">{slot.label}</label>
              <p className="text-[11px] leading-snug text-gray-500">{slot.where}</p>

              <button
                type="button"
                disabled={isReadOnly || busy !== null}
                onClick={() => inputs.current[slot.key]?.click()}
                className="mt-2 flex h-24 w-full items-center justify-center rounded border border-dashed border-gray-300 bg-white p-2 transition hover:border-[#163D6D] disabled:cursor-not-allowed"
              >
                {busy === slot.key ? (
                  <span className="text-xs text-gray-500">Uploading…</span>
                ) : value ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={value}
                    alt={`${slot.label} preview`}
                    className="max-h-20 max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-gray-400">
                    Nothing on file — click to upload
                  </span>
                )}
              </button>
              {!isReadOnly && value && (
                <button
                  type="button"
                  onClick={() => inputs.current[slot.key]?.click()}
                  className="mt-1 text-[11px] text-[#163D6D] underline"
                >
                  Click the image to upload a replacement
                </button>
              )}

              <input
                ref={(el) => {
                  inputs.current[slot.key] = el;
                }}
                type="file"
                accept={ALLOWED.join(",")}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void pick(slot, file);
                }}
              />

              <p className="mt-2 text-[11px] leading-snug text-gray-600">{slot.guidance}</p>
              {notes[slot.key] && (
                <p className="mt-1 text-[11px] leading-snug text-amber-800">
                  {notes[slot.key]}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {!isReadOnly && (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => void save()}
            disabled={saving || busy !== null}
            className="rounded bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {saving ? "Saving…" : confirmed ? "Update" : "These are right"}
          </button>
          {confirmed && <span className="text-xs text-green-700">Confirmed.</span>}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
