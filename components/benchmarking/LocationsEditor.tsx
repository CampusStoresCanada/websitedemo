"use client";

import { useState } from "react";
import {
  addLocation,
  updateLocation,
  removeLocation,
  upsertOtherSpace,
  removeOtherSpace,
  type SurveyLocation,
} from "@/lib/actions/benchmarking-locations";

/**
 * Square footage, per location.
 *
 * Four boxes for the whole store made a multi-site operation add its own sites
 * together before it could answer, and then asked for the total separately so
 * the two could disagree. Each location now carries its own measurements, the
 * store-level figures are the roll-up, and the total is arithmetic nobody types.
 *
 * "Other" is a list rather than a box: a loading bay, a classroom and a photo
 * studio are three different spaces, and one number loses why each exists.
 */

const SPACE_FIELDS = [
  {
    key: "salesFloor" as const,
    label: "Sales Floor",
    help: "Space customers can walk in. Exclude stockrooms, offices and receiving.",
  },
  {
    key: "storage" as const,
    label: "Storage",
    help: "Stockrooms, receiving, and space used primarily for the storage of product.",
  },
  {
    key: "office" as const,
    label: "Office",
    help: "Staff offices and back-office workspace.",
  },
];

export default function LocationsEditor({
  benchmarkingId,
  initialLocations,
  isReadOnly,
  statedCount,
  onStatedCountChange,
}: {
  benchmarkingId: string;
  initialLocations: SurveyLocation[];
  isReadOnly: boolean;
  /** The store's own answer to "how many do you operate". */
  statedCount: number | null;
  onStatedCountChange: (n: number | null) => void;
}) {
  const [locations, setLocations] = useState<SurveyLocation[]>(initialLocations);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (id: string, fn: (l: SurveyLocation) => SurveyLocation) =>
    setLocations((prev) => prev.map((l) => (l.id === id ? fn(l) : l)));

  async function onAdd() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    const res = await addLocation(benchmarkingId, newName);
    setBusy(false);
    if (!res.success || !res.id) {
      setError(res.error ?? "Could not add that location.");
      return;
    }
    setLocations((prev) => [
      ...prev,
      { id: res.id!, name: newName.trim(), salesFloor: null, storage: null, office: null, otherSpaces: [] },
    ]);
    setNewName("");
  }

  const total = locations.reduce(
    (sum, l) =>
      sum +
      (l.salesFloor ?? 0) +
      (l.storage ?? 0) +
      (l.office ?? 0) +
      l.otherSpaces.reduce((s, o) => s + (o.sqft ?? 0), 0),
    0,
  );

  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-gray-900">Your locations and their space</h3>

      {/*
        The count is asked FIRST and kept as its own answer.

        I had derived it from the number of rows, which deleted the question
        entirely — the section then had nothing that said "how many locations do
        you operate" and the editor sat at the bottom where nobody looked. It
        also made the cross-check below compare a number to itself.
      */}
      <div className="mt-3 max-w-xs">
        <label className="block text-xs font-medium text-gray-700">
          How many locations do you operate?
        </label>
        <p className="text-[11px] leading-snug text-gray-500">
          Every physical location, including satellite and seasonal shops. Do not count
          your web store.
        </p>
        <input
          type="number"
          min={0}
          value={statedCount ?? ""}
          disabled={isReadOnly}
          onFocus={(e) => {
            const el = e.currentTarget;
            requestAnimationFrame(() => el.select());
          }}
          onChange={(e) =>
            onStatedCountChange(e.target.value === "" ? null : Number(e.target.value))
          }
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
      </div>

      <p className="mt-4 text-xs text-gray-600">
        Now describe each one. Names are for your own results only and appear on no public
        page, so call them whatever you call them internally.
      </p>

      {/*
        Says what is missing rather than silently accepting a mismatch — a store
        that says 3 and describes 1 has under-reported its floor space, and
        every per-square-foot comparison it gets back would be wrong.
      */}
      {statedCount !== null && statedCount !== locations.length && (
        <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
          You said {statedCount} location{statedCount === 1 ? "" : "s"} and have described{" "}
          {locations.length}.{" "}
          {statedCount > locations.length
            ? "Add the rest below, or change the number above."
            : "Remove the extra ones, or change the number above."}
        </p>
      )}

      <div className="mt-4 space-y-4">
        {locations.map((loc) => (
          <div key={loc.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <input
                type="text"
                value={loc.name}
                disabled={isReadOnly}
                onChange={(e) => patch(loc.id, (l) => ({ ...l, name: e.target.value }))}
                onBlur={(e) =>
                  void updateLocation({
                    benchmarkingId,
                    locationId: loc.id,
                    name: e.target.value,
                  })
                }
                className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm font-medium"
                placeholder="e.g. Interurban campus"
              />
              {!isReadOnly && (
                <button
                  onClick={async () => {
                    const res = await removeLocation(benchmarkingId, loc.id);
                    if (res.success) {
                      setLocations((prev) => prev.filter((l) => l.id !== loc.id));
                    } else setError(res.error ?? "Could not remove that.");
                  }}
                  className="text-xs text-gray-500 underline hover:text-red-700"
                >
                  Remove
                </button>
              )}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {SPACE_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-gray-700">{f.label}</label>
                  <p className="text-[11px] leading-snug text-gray-500">{f.help}</p>
                  <input
                    type="number"
                    value={loc[f.key] ?? ""}
                    disabled={isReadOnly}
                    onFocus={(e) => {
                      const el = e.currentTarget;
                      requestAnimationFrame(() => el.select());
                    }}
                    onChange={(e) =>
                      patch(loc.id, (l) => ({
                        ...l,
                        [f.key]: e.target.value === "" ? null : Number(e.target.value),
                      }))
                    }
                    onBlur={(e) =>
                      void updateLocation({
                        benchmarkingId,
                        locationId: loc.id,
                        [f.key]: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    placeholder="sq ft"
                  />
                </div>
              ))}
            </div>

            {/* Other spaces — a list, each with its own explanation. */}
            <div className="mt-4 border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-700">Other space</p>
              <p className="text-[11px] text-gray-500">
                Anything not covered above. Add one entry per kind of space and say what it
                is used for.
              </p>

              {loc.otherSpaces.map((o) => (
                <div key={o.id} className="mt-2 flex items-start gap-2">
                  <input
                    type="text"
                    value={o.description}
                    disabled={isReadOnly}
                    onChange={(e) =>
                      patch(loc.id, (l) => ({
                        ...l,
                        otherSpaces: l.otherSpaces.map((x) =>
                          x.id === o.id ? { ...x, description: e.target.value } : x,
                        ),
                      }))
                    }
                    onBlur={(e) =>
                      void upsertOtherSpace({
                        benchmarkingId,
                        locationId: loc.id,
                        otherSpaceId: o.id,
                        description: e.target.value,
                        sqft: o.sqft,
                      })
                    }
                    placeholder="What is this space used for?"
                    className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    value={o.sqft ?? ""}
                    disabled={isReadOnly}
                    onChange={(e) =>
                      patch(loc.id, (l) => ({
                        ...l,
                        otherSpaces: l.otherSpaces.map((x) =>
                          x.id === o.id
                            ? { ...x, sqft: e.target.value === "" ? null : Number(e.target.value) }
                            : x,
                        ),
                      }))
                    }
                    onBlur={(e) =>
                      void upsertOtherSpace({
                        benchmarkingId,
                        locationId: loc.id,
                        otherSpaceId: o.id,
                        description: o.description,
                        sqft: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    placeholder="sq ft"
                    className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
                  />
                  {!isReadOnly && (
                    <button
                      onClick={async () => {
                        const res = await removeOtherSpace({ benchmarkingId, otherSpaceId: o.id });
                        if (res.success) {
                          patch(loc.id, (l) => ({
                            ...l,
                            otherSpaces: l.otherSpaces.filter((x) => x.id !== o.id),
                          }));
                        }
                      }}
                      className="pt-1.5 text-xs text-gray-400 hover:text-red-700"
                      aria-label="Remove this space"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}

              {!isReadOnly && (
                <button
                  onClick={async () => {
                    const res = await upsertOtherSpace({
                      benchmarkingId,
                      locationId: loc.id,
                      description: "Other space",
                      sqft: null,
                    });
                    if (res.success && res.id) {
                      patch(loc.id, (l) => ({
                        ...l,
                        otherSpaces: [
                          ...l.otherSpaces,
                          { id: res.id!, description: "Other space", sqft: null },
                        ],
                      }));
                    } else setError(res.error ?? "Could not add that.");
                  }}
                  className="mt-2 text-xs text-[#163D6D] underline"
                >
                  + Add another space
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {!isReadOnly && (
        <div className="mt-4 flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name of another location"
            className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <button
            onClick={() => void onAdd()}
            disabled={busy || !newName.trim()}
            className="rounded bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? "Adding…" : "Add location"}
          </button>
        </div>
      )}

      {locations.length > 0 && (
        <p className="mt-3 text-sm text-gray-700">
          Total store space:{" "}
          <span className="font-medium">{total.toLocaleString("en-CA")} sq ft</span>
          <span className="block text-xs text-gray-500">
            Added up from the locations above. We do not ask for it separately.
          </span>
        </p>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
