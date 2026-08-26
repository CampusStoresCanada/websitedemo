"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { FloorPlanSurface } from "@/lib/conference/floor-surfaces";
import type { MappedThing } from "@/lib/conference/member-map";

/**
 * Finding something at the conference, on a phone, standing up.
 *
 * The sales floor plan answers "which booths are left". This answers "where is
 * that company" — so search is the primary control, not a decoration, and a
 * match highlights in place rather than filtering the map down. Someone
 * looking for Bardown wants to see Bardown AND what is around it, because the
 * next question is always "what else is near there".
 *
 * The same fractional coordinates the print book uses, drawn into a viewBox.
 * No pan/zoom yet: one surface fits a phone screen at this scale, and a custom
 * gesture layer that fights native pinch is worse than none.
 */

const VIEW_W = 1000;
const VIEW_H = 700;

export default function MemberMap({
  surfaces,
  things,
  initialQuery = "",
}: {
  surfaces: FloorPlanSurface[];
  things: MappedThing[];
  /** From the directory's "Find on map" — arrive already searching. */
  initialQuery?: string;
}) {
  // The surface holding the incoming match, so a hand-off does not land on
  // floor 1 while the company is on floor 2.
  const initialSurface = (() => {
    const q = initialQuery.trim().toLowerCase();
    if (!q) return surfaces[0]?.id ?? "";
    const hit = things.find(
      (t) => t.label.toLowerCase().includes(q) || (t.orgName ?? "").toLowerCase().includes(q)
    );
    return hit?.surfaceId ?? surfaces[0]?.id ?? "";
  })();
  const [surfaceId, setSurfaceId] = useState(initialSurface);
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<MappedThing | null>(null);

  const surface = surfaces.find((s) => s.id === surfaceId) ?? surfaces[0];
  const onThisSurface = useMemo(
    () => things.filter((t) => t.surfaceId === surface?.id),
    [things, surface?.id]
  );

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return new Set<string>();
    return new Set(
      things
        .filter((t) =>
          t.label.toLowerCase().includes(q) || (t.orgName ?? "").toLowerCase().includes(q)
        )
        .map((t) => t.entityId)
    );
  }, [things, q]);

  // A hit on another floor is the most useful thing to say when the map looks
  // empty — otherwise someone concludes the company isn't at the show.
  const elsewhere = useMemo(() => {
    if (!q) return [];
    return surfaces
      .filter((s) => s.id !== surface?.id)
      .map((s) => ({
        surface: s,
        count: things.filter((t) => t.surfaceId === s.id && matches.has(t.entityId)).length,
      }))
      .filter((r) => r.count > 0);
  }, [surfaces, things, matches, surface?.id, q]);

  if (!surface) {
    return <p className="text-sm text-gray-500">No floor plan has been published yet.</p>;
  }

  const hereCount = onThisSurface.filter((t) => matches.has(t.entityId)).length;

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
        placeholder="Find a company or booth number"
        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base"
        // text-base, not text-sm: anything under 16px makes iOS zoom the page
        // on focus, which throws away the map position.
        aria-label="Find a company or booth number"
      />

      {surfaces.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {surfaces.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { setSurfaceId(s.id); setSelected(null); }}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                s.id === surface.id
                  ? "bg-[#163D6D] text-white"
                  : "border border-gray-300 text-gray-700 hover:border-gray-400"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {q && (
        <p className="text-sm text-gray-600">
          {hereCount > 0
            ? `${hereCount} match${hereCount === 1 ? "" : "es"} on ${surface.name}`
            : `Nothing matching on ${surface.name}`}
          {elsewhere.map((r) => (
            <button
              key={r.surface.id}
              type="button"
              onClick={() => setSurfaceId(r.surface.id)}
              className="ml-2 font-medium text-[#163D6D] underline"
            >
              {r.count} on {r.surface.name}
            </button>
          ))}
        </p>
      )}

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full rounded-lg border border-gray-200 bg-white [font-family:inherit]"
        role="img"
        aria-label={`Map: ${surface.name}`}
      >
        {surface.imageUrl ? (
          <image href={surface.imageUrl} x={0} y={0} width={VIEW_W} height={VIEW_H}
                 preserveAspectRatio="none" />
        ) : (
          <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="#f7f7f6" />
        )}

        {onThisSurface.map((t) => {
          const x = t.x * VIEW_W, y = t.y * VIEW_H, w = t.w * VIEW_W, h = t.h * VIEW_H;
          const isMatch = matches.has(t.entityId);
          const dimmed = q.length > 0 && !isMatch;
          const isSelected = selected?.entityId === t.entityId;
          return (
            <g
              key={t.entityId}
              transform={t.rotation ? `rotate(${t.rotation} ${x + w / 2} ${y + h / 2})` : undefined}
              onClick={() => setSelected(t)}
              className="cursor-pointer"
              opacity={dimmed ? 0.25 : 1}
            >
              {/* The background art already carries the booth numbers, printed
                  where the venue put them. Drawing them again produced numbers
                  on top of numbers, so these boxes say STATE — held, free,
                  matched — and stay out of the way of the artwork underneath.
                  The label reappears only when it is the answer to something:
                  a search hit, or the box you just tapped. */}
              <rect
                x={x} y={y} width={w} height={h} rx={2}
                fill={
                  isMatch || isSelected ? "#EE2A2E"
                    : t.orgName ? "#163D6D"
                      : "transparent"
                }
                fillOpacity={isMatch || isSelected ? 0.85 : t.orgName ? 0.18 : 0}
                stroke={isSelected || isMatch ? "#EE2A2E" : "#163D6D"}
                strokeWidth={isSelected ? 3 : isMatch ? 2 : 1}
                strokeOpacity={isMatch || isSelected ? 1 : 0.45}
              />
              {(isMatch || isSelected) && (
                <text
                  x={x + w / 2} y={y + h / 2}
                  textAnchor="middle" dominantBaseline="central"
                  fontSize={Math.max(10, Math.min(w, h) * 0.42)}
                  fill="#ffffff"
                  fontWeight={700}
                  pointerEvents="none"
                >
                  {t.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {selected ? (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-semibold text-gray-900">
                {selected.orgName ?? selected.label}
              </p>
              <p className="text-sm text-gray-500">
                {selected.orgName ? `${selected.kind} ${selected.label}` : selected.kind}
                {" · "}{surface.name}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-sm text-gray-400 hover:text-gray-600"
              aria-label="Close"
            >
              Close
            </button>
          </div>
          {selected.orgSlug && (
            <Link
              href={`/org/${selected.orgSlug}`}
              className="mt-2 inline-block text-sm font-medium text-[#163D6D] hover:underline"
            >
              See their profile &rarr;
            </Link>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500">Tap anything on the map to see who&rsquo;s there.</p>
      )}
    </div>
  );
}
