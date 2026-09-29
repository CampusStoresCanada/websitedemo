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
import { LOCATION_KINDS, type LocationKind } from "@/lib/benchmarking/location-kinds";

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
}: {
  benchmarkingId: string;
  initialLocations: SurveyLocation[];
  isReadOnly: boolean;
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
      {
        id: res.id!,
        name: newName.trim(),
        kind: null,
        kindOther: null,
        salesFloor: null,
        storage: null,
        office: null,
        otherSpaces: [],
      },
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

      <p className="mt-1 text-xs text-gray-600">
        One entry per physical location you operate, including satellite and seasonal
        shops. Do not count your web store. Names are for your own results only and appear
        on no public page, so call them whatever you call them internally.
      </p>

      {/*
        Counted, not declared. This was briefly a "how many do you operate?" box
        with a cross-check against the rows, which only earned its keep while
        this block was buried and easy to miss. Describing them IS the question
        now, so asking for the number as well asks twice for one fact — and the
        answer worth having is the one backed by a described location.
      */}
      <p className="mt-2 text-sm text-gray-800">
        {locations.length === 0
          ? "No locations described yet."
          : `${locations.length} location${locations.length === 1 ? "" : "s"} described.`}
      </p>

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

            {/*
              Radios, not a dropdown: each option needs its explanation beside
              it, and a <select> can only show labels. Three options is well
              within the range where showing them all beats hiding them.
            */}
            <fieldset className="mt-3">
              <legend className="text-xs font-medium text-gray-700">
                What kind of location is this?
              </legend>
              <div className="mt-1 space-y-1.5">
                {LOCATION_KINDS.map((k) => (
                  <label key={k.value} className="flex cursor-pointer gap-2">
                    <input
                      type="radio"
                      name={`kind-${loc.id}`}
                      className="mt-0.5"
                      checked={loc.kind === k.value}
                      disabled={isReadOnly}
                      onChange={() => {
                        patch(loc.id, (l) => ({ ...l, kind: k.value }));
                        void updateLocation({
                          benchmarkingId,
                          locationId: loc.id,
                          kind: k.value,
                        });
                      }}
                    />
                    <span>
                      <span className="block text-xs font-medium text-gray-800">
                        {k.label}
                      </span>
                      <span className="block text-[11px] leading-snug text-gray-500">
                        {k.help}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {loc.kind === "Other" && (
                <input
                  type="text"
                  value={loc.kindOther ?? ""}
                  disabled={isReadOnly}
                  placeholder="Describe it"
                  onChange={(e) => patch(loc.id, (l) => ({ ...l, kindOther: e.target.value }))}
                  onBlur={(e) =>
                    void updateLocation({
                      benchmarkingId,
                      locationId: loc.id,
                      kindOther: e.target.value,
                    })
                  }
                  className="mt-2 w-full max-w-sm rounded border border-gray-300 px-2 py-1.5 text-sm"
                />
              )}
            </fieldset>

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
