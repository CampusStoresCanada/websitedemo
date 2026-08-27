"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { FloorPlanSurface } from "@/lib/conference/floor-surfaces";
import type { MappedThing } from "@/lib/conference/member-map";
import { explainMatch, type MatchReason } from "@/lib/explore/intent-search";

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
  // One matcher for every surface — the map, the exhibitor list and the
  // partners page all ask the same question of the same rules.
  const matched = useMemo(() => {
    const q = query.trim();
    if (!q) return [] as Array<MappedThing & { reason: MatchReason }>;
    const out: Array<MappedThing & { reason: MatchReason }> = [];
    for (const t of things) {
      const reason = explainMatch(
        {
          name: t.orgName ?? t.label,
          description: t.orgDescription,
          departments: t.departments,
          classes: t.classes,
          booths: [t.label],
          people: t.people,
        },
        q
      );
      if (reason) out.push({ ...t, reason });
    }
    return out;
  }, [things, query]);
  const matches = useMemo(() => new Set(matched.map((t) => t.entityId)), [matched]);

  // A hit on another floor is the most useful thing to say when the map looks
  // empty — otherwise someone concludes the company isn't at the show.
  const elsewhere = useMemo(() => {
    if (!q) return [];
    return surfaces
      .filter((s) => s.id !== surface?.id)
      .map((s) => ({
        surface: s,
        count: matched.filter((t) => t.surfaceId === s.id).length,
      }))
      .filter((r) => r.count > 0);
  }, [surfaces, matched, surface?.id, q]);

  const hereMatches = useMemo(
    () => matched.filter((t) => t.surfaceId === surface?.id),
    [matched, surface?.id]
  );
  const guessOnly = hereMatches.length > 0 && hereMatches.every((t) => t.reason === "guess");

  /**
   * One match is an answer, so show it. Several are a shortlist, so let them
   * choose. Highlighting a box red and leaving it at that assumes the reader
   * can see the whole floor at once — on a phone, held at arm's length in a
   * hall, they cannot.
   */
  useEffect(() => {
    if (hereMatches.length === 1) setSelected(hereMatches[0]);
    else if (hereMatches.length === 0) setSelected(null);
  }, [hereMatches]);

  if (!surface) {
    return <p className="text-sm text-gray-500">No floor plan has been published yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
          placeholder="Find a company, booth number or what they sell"
          // text-base, not text-sm: anything under 16px makes iOS zoom the page
          // on focus, which throws away the map position.
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 pr-10 text-base"
          aria-label="Find a company, booth number or what they sell"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(""); setSelected(null); }}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-lg leading-none text-gray-400 hover:text-gray-700"
          >
            &times;
          </button>
        )}
      </div>

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
        <div className="space-y-2">
          <p className="text-sm text-gray-600">
            {hereMatches.length > 0
              ? guessOnly
                // The whole point of tracking the reason: an inference has to
                // look like one. "We think" is the honest verb for a synonym
                // landing on a category a CSC admin may have guessed at.
                ? `We think ${hereMatches.length === 1 ? "this one does" : `these ${hereMatches.length} do`} that`
                : `${hereMatches.length} match${hereMatches.length === 1 ? "" : "es"} on ${surface.name}`
              : elsewhere.length > 0
                ? `Nothing matching on ${surface.name}`
                : // Nowhere at all is a different answer from "not on this
                  // floor", and the reader needs to stop looking.
                  "No match — they may not be exhibiting this year."}
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

          {/* A shortlist, not a filter of the map: the boxes stay where they
              are so the reader keeps their bearings. */}
          {hereMatches.length > 1 && (
            <ul className="flex flex-wrap gap-2">
              {hereMatches.map((t) => (
                <li key={t.entityId}>
                  <button
                    type="button"
                    onClick={() => setSelected(t)}
                    aria-pressed={selected?.entityId === t.entityId}
                    className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                      selected?.entityId === t.entityId
                        ? "bg-[#EE2A2E] text-white"
                        : "border border-gray-300 text-gray-700 hover:border-gray-400"
                    }`}
                  >
                    {t.orgName ?? t.label}
                    {t.orgName && <span className="ml-1 tabular-nums opacity-70">{t.label}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full rounded-lg border border-gray-200 bg-white"
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
          // Held booths carry the brand navy, matches the accent red, free
          // booths stay white. `onDark` keeps the label legible on whichever
          // of those it lands on.
          const fill = isMatch || isSelected ? "#EE2A2E" : t.orgName ? "#163D6D" : "#FFFFFF";
          const onDark = isMatch || isSelected || !!t.orgName;
          return (
            <g
              key={t.entityId}
              transform={t.rotation ? `rotate(${t.rotation} ${x + w / 2} ${y + h / 2})` : undefined}
              onClick={() => setSelected(t)}
              className="cursor-pointer"
              opacity={dimmed ? 0.25 : 1}
            >
              {/* The background artwork draws each booth as a filled box with
                  its number set in the venue's own serif. Two earlier attempts
                  both failed on that: an opaque box with our label on top read
                  as numbers-on-numbers, and a translucent tint left the printed
                  number showing through while washing out the state colour.

                  So the fill is OPAQUE and covers the artwork's number
                  completely, and we redraw the number ourselves. One number per
                  booth, in the site's own face, and the fill is free to carry
                  state because nothing has to show through it. */}
              <rect
                x={x} y={y} width={w} height={h} rx={2}
                fill={fill}
                stroke={isSelected ? "#1A1A1A" : isMatch ? "#B81E22" : "#163D6D"}
                strokeWidth={isSelected ? 3 : isMatch ? 2 : 1}
              />
              <text
                x={x + w / 2} y={y + h / 2}
                textAnchor="middle" dominantBaseline="central"
                fontSize={Math.max(9, Math.min(w, h) * 0.44)}
                fill={onDark ? "#ffffff" : "#163D6D"}
                fontWeight={700}
                fontFamily="var(--font-primary)"
                pointerEvents="none"
              >
                {t.label}
              </text>
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
