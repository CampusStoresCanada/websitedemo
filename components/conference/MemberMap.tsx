"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { FloorPlanSurface } from "@/lib/conference/floor-surfaces";
import type { MappedThing } from "@/lib/conference/member-map";
import { explainMatch, type MatchReason } from "@/lib/explore/intent-search";
import {
  boundsOf, fitView, frameRect, isFitted, panBy, zoomAt, type ViewBox,
} from "@/lib/conference/map-view";

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

  /**
   * Keep ?find= in step with the box, so a search can be shared, bookmarked,
   * and survives switching apps on a phone and coming back.
   *
   * replaceState, not push: one history entry per keystroke would turn the
   * back button into an undo-typing button and bury whatever page they came
   * from. And history.replaceState rather than router.replace, because the
   * latter re-runs the server component — a round trip per character to
   * re-render a map whose data has not changed.
   *
   * Debounced so the address bar is not rewritten mid-word.
   */
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const url = new URL(window.location.href);
      const q = query.trim();
      // Other params are preserved — this owns `find` and nothing else.
      if (q) url.searchParams.set("find", q);
      else url.searchParams.delete("find");
      if (url.toString() !== window.location.href) {
        window.history.replaceState(window.history.state, "", url.toString());
      }
    }, 300);
    return () => { if (urlTimer.current) clearTimeout(urlTimer.current); };
  }, [query]);
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
   * One entry per company, not per booth.
   *
   * A company holding two adjacent booths is one answer to "who sells
   * hoodies", not two. Ungrouped, a 21-booth result listed MV Sport, Hotline
   * Apparel and four others twice each and pushed the map off a phone screen —
   * so the thing you searched for was the thing you could not see.
   */
  const groups = useMemo(() => {
    const byCompany = new Map<string, { key: string; name: string; things: typeof hereMatches }>();
    for (const t of hereMatches) {
      // Unsold booths have no company, so each stands alone under its number.
      const key = t.orgName ?? `booth:${t.entityId}`;
      const existing = byCompany.get(key);
      if (existing) existing.things.push(t);
      else byCompany.set(key, { key, name: t.orgName ?? t.label, things: [t] });
    }
    return [...byCompany.values()];
  }, [hereMatches]);

  /** The booths the selection covers, in floor order, for the card to name. */
  const selectedIds = useMemo(() => {
    if (!selected) return new Set<string>();
    if (!selected.orgName) return new Set([selected.entityId]);
    return new Set(
      onThisSurface.filter((t) => t.orgName === selected.orgName).map((t) => t.entityId)
    );
  }, [selected, onThisSurface]);

  const selectedBooths = useMemo(
    () =>
      onThisSurface
        .filter((t) => selectedIds.has(t.entityId))
        .map((t) => t.label)
        .sort((a, b) => {
          // "10" after "9" on a floor; compare numerically when both are.
          const na = Number(a), nb = Number(b);
          return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.localeCompare(b);
        }),
    [onThisSurface, selectedIds]
  );

  /**
   * One match is an answer, so show it. Several are a shortlist, so let them
   * choose. Highlighting a box red and leaving it at that assumes the reader
   * can see the whole floor at once — on a phone, held at arm's length in a
   * hall, they cannot.
   */
  useEffect(() => {
    // One COMPANY is an answer, even when it holds three booths.
    if (groups.length === 1) setSelected(groups[0].things[0]);
    else if (groups.length === 0) setSelected(null);
  }, [groups]);

  /**
   * Pan and zoom.
   *
   * Pointer events rather than separate mouse/touch paths, so one set of
   * handlers covers a finger, a trackpad and a mouse. `touch-action: none` on
   * the svg only — the browser must stop scrolling the PAGE when a drag starts
   * on the map, but everywhere else on the page still scrolls normally.
   */
  const [view, setView] = useState<ViewBox>(() => fitView(VIEW_W, VIEW_H));
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef<number | null>(null);
  // Distinguishes a tap from the end of a drag, so panning never selects a
  // booth the reader was only sliding past.
  const dragged = useRef(false);

  /** Client pixels → world units, via the rendered size. */
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: view.x + ((clientX - r.left) / r.width) * view.w,
      y: view.y + ((clientY - r.top) / r.height) * view.h,
    };
  }, [view]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Capture on the svg, not the box under the finger, so a drag that leaves
    // the map still tracks. And guarded: setPointerCapture throws
    // NotFoundError if the pointer has already been released — which is a
    // race, not a failure, and must not take the page down with it.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Nothing to capture; the gesture simply ends early.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragged.current = false;
    pinchDist.current = null;
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();

    if (pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist.current != null && dist > 0) {
        const mid = toWorld((a.x + b.x) / 2, (a.y + b.y) / 2);
        setView((v) => zoomAt(v, dist / pinchDist.current!, mid.x, mid.y, VIEW_W, VIEW_H));
        dragged.current = true;
      }
      pinchDist.current = dist;
      return;
    }

    const dx = ((e.clientX - prev.x) / r.width) * view.w;
    const dy = ((e.clientY - prev.y) / r.height) * view.h;
    if (Math.abs(dx) + Math.abs(dy) > 0) dragged.current = true;
    setView((v) => panBy(v, -dx, -dy, VIEW_W, VIEW_H));
  };

  const endPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchDist.current = null;
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const at = toWorld(e.clientX, e.clientY);
    setView((v) => zoomAt(v, e.deltaY < 0 ? 1.15 : 1 / 1.15, at.x, at.y, VIEW_W, VIEW_H));
  };

  /**
   * Selecting something takes you TO it.
   *
   * Auto-select used to tell the reader the answer existed without moving the
   * map, which on a phone means the highlighted booth can be off screen —
   * knowing it is somewhere is not knowing where.
   */
  useEffect(() => {
    if (!selected) return;
    const rects = onThisSurface
      .filter((t) => selectedIds.has(t.entityId))
      .map((t) => ({ x: t.x * VIEW_W, y: t.y * VIEW_H, w: t.w * VIEW_W, h: t.h * VIEW_H }));
    const bounds = boundsOf(rects);
    if (bounds) setView(frameRect(bounds, VIEW_W, VIEW_H));
  }, [selected, selectedIds, onThisSurface]);

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
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Take the top result. With one match it is already selected, so
              // this is for the shortlist case — Enter should not require
              // choosing between fifteen chips before anything happens.
              e.preventDefault();
              if (groups.length > 0) setSelected(groups[0].things[0]);
            } else if (e.key === "Escape") {
              // Clear rather than blur. On a phone the keyboard is covering
              // the map, and getting rid of the search is what someone wants
              // when they hit Escape — an empty box with focus is fine.
              e.preventDefault();
              setQuery("");
              setSelected(null);
            }
          }}
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
          {groups.length > 1 && (
            // Scrolls rather than growing: the map must stay on screen, which
            // is the whole reason someone is looking at this page.
            <ul className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
              {groups.map((g) => {
                const on = g.things.some((t) => selectedIds.has(t.entityId));
                return (
                  <li key={g.key}>
                    <button
                      type="button"
                      onClick={() => setSelected(g.things[0])}
                      aria-pressed={on}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                        on
                          ? "bg-[#EE2A2E] text-white"
                          : "border border-gray-300 text-gray-700 hover:border-gray-400"
                      }`}
                    >
                      {g.name}
                      <span className="ml-1 tabular-nums opacity-70">
                        {g.things.map((t) => t.label).join(", ")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="relative">
        {!isFitted(view, VIEW_W) && (
          <button
            type="button"
            onClick={() => setView(fitView(VIEW_W, VIEW_H))}
            className="absolute right-2 top-2 z-10 rounded-md border border-gray-300 bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:border-gray-400"
          >
            Whole floor
          </button>
        )}
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onWheel={onWheel}
          // touch-action:none stops the browser scrolling the page out from
          // under a drag that started on the map. Scoped to the svg, so the
          // rest of the page still scrolls with a finger as normal.
          className="w-full touch-none rounded-lg border border-gray-200 bg-white"
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
            // De-emphasise by COLOUR, never by opacity. Fading a box to 25%
            // makes it translucent, and the background artwork's own serif booth
            // numbers show through underneath ours — which is why the map went
            // back to numbers-on-numbers the moment anyone searched. Every fill
            // here stays opaque; quiet booths just go grey.
            const muted = q.length > 0 && !isMatch;
            const isSelected = selectedIds.has(t.entityId);
            // Held booths carry the brand navy, matches the accent red, free
            // booths stay white. `onDark` keeps the label legible on whichever
            // of those it lands on.
            // Three states that have to be told apart at arm's length on a
            // phone: quiet, found, and the one you are looking at. Matched and
            // selected were both #EE2A2E, distinguished only by a stroke width
            // that vanishes at this scale — so selection now changes HUE, and
            // keeps a red ring to stay visibly part of the result set.
            const fill = isSelected
              ? "#1A1A1A"
              : muted
                ? "#EDEEF0"
                : isMatch
                  ? "#EE2A2E"
                  : t.orgName
                    ? "#163D6D"
                    : "#FFFFFF";
            const onDark = isSelected || (!muted && (isMatch || !!t.orgName));
            return (
              <g
                key={t.entityId}
                transform={t.rotation ? `rotate(${t.rotation} ${x + w / 2} ${y + h / 2})` : undefined}
                onClick={() => { if (!dragged.current) setSelected(t); }}
                className="cursor-pointer"
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
                  stroke={
                    isSelected ? "#EE2A2E" : muted ? "#D5D7DB" : isMatch ? "#B81E22" : "#163D6D"
                  }
                  strokeWidth={isSelected ? 4 : isMatch ? 2 : 1}
                />
                <text
                  x={x + w / 2} y={y + h / 2}
                  textAnchor="middle" dominantBaseline="central"
                  fontSize={Math.max(9, Math.min(w, h) * 0.44)}
                  fill={onDark ? "#ffffff" : muted ? "#9AA0A8" : "#163D6D"}
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
      </div>

      {selected ? (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-semibold text-gray-900">
                {selected.orgName ?? selected.label}
              </p>
              <p className="text-sm text-gray-500">
                {selected.orgName
                  ? `${selected.kind}${selectedBooths.length === 1 ? "" : "s"} ${selectedBooths.join(", ")}`
                  : selected.kind}
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
