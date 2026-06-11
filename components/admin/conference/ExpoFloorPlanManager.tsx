"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  createBooth,
  deleteBooth,
  updateBooth,
  type BoothRow,
  type BoothStatus,
} from "@/lib/actions/conference-booths";
import { createProduct, deleteProduct, updateProduct } from "@/lib/actions/conference-products";
import { uploadFloorPlanImage } from "@/lib/actions/conference-floor-plan";
import {
  FLOOR_PLAN_SVG_W,
  FLOOR_PLAN_SVG_H,
  DEFAULT_FLOOR_PLAN_URL,
  BOOTH_STATUS_BORDER_COLORS,
  BOOTH_STATUS_LABELS,
  BOOTH_DAY_ROLE_LABELS,
  getBoothPackagesFromProducts,
  type BoothPackage,
  type BoothDayRole,
} from "@/lib/constants/floor-plan";

type VendorOrg = { id: string; name: string };

type Props = {
  conferenceId: string;
  conferenceYear: number;
  editionCode: string;
  floorPlanUrl: string | null;
  initialBooths: BoothRow[];
  initialBoothPackages: BoothPackage[];
  conferenceDates: string[];
  vendorOrgs: VendorOrg[];
};

const STATUS_OPTIONS: BoothStatus[] = [
  "available",
  "sponsor_hold",
  "reserved",
  "sold",
  "waitlisted",
];

const NEW_BOOTH_DEFAULTS_BASE = {
  boothNumber: "",
  mapCx: 960,
  mapCy: 540,
  mapW: 69,
  mapH: 55,
};

// Minimum booth size in floor-plan SVG units (~1% of the 1920-wide canvas).
const MIN_BOOTH_SIZE = 20;

// Snap radius in floor-plan SVG units (~0.4% of the 1920-wide canvas, a few px on screen).
const SNAP_THRESHOLD = 8;

// Offset applied to a duplicated booth so it doesn't land exactly on top of the original.
const DUPLICATE_OFFSET = 30;

type DragState =
  | {
      kind: "move";
      boothId: string;
      startX: number;
      startY: number;
      origCx: number;
      origCy: number;
      origW: number;
      origH: number;
    }
  | {
      kind: "move-group";
      boothId: string;
      startX: number;
      startY: number;
      origins: { id: string; cx: number; cy: number; w: number; h: number }[];
    }
  | { kind: "resize"; boothId: string; left: number; top: number }
  | { kind: "draw"; startX: number; startY: number; curX: number; curY: number }
  | {
      kind: "marquee";
      startX: number;
      startY: number;
      curX: number;
      curY: number;
      additive: boolean;
    };

function formatDayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function pct(value: number, total: number): string {
  return `${((value / total) * 100).toFixed(4)}%`;
}

// Edges, centers, and canvas bounds/center of every other booth — candidate
// positions a dragged/resized booth's edges or center can snap to. Targets
// outside the visible (scrolled/zoomed) viewport are skipped, so snapping
// only ever pulls toward something the user can actually see.
function getSnapTargets(
  booths: BoothRow[],
  excludeIds: Set<string>,
  visible: { left: number; right: number; top: number; bottom: number }
): { xs: number[]; ys: number[] } {
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const x of [0, FLOOR_PLAN_SVG_W / 2, FLOOR_PLAN_SVG_W]) {
    if (x >= visible.left - SNAP_THRESHOLD && x <= visible.right + SNAP_THRESHOLD) xs.add(x);
  }
  for (const y of [0, FLOOR_PLAN_SVG_H / 2, FLOOR_PLAN_SVG_H]) {
    if (y >= visible.top - SNAP_THRESHOLD && y <= visible.bottom + SNAP_THRESHOLD) ys.add(y);
  }
  for (const b of booths) {
    if (excludeIds.has(b.id)) continue;
    const bLeft = b.map_cx - b.map_w / 2;
    const bRight = b.map_cx + b.map_w / 2;
    const bTop = b.map_cy - b.map_h / 2;
    const bBottom = b.map_cy + b.map_h / 2;
    if (bRight < visible.left - SNAP_THRESHOLD || bLeft > visible.right + SNAP_THRESHOLD) continue;
    if (bBottom < visible.top - SNAP_THRESHOLD || bTop > visible.bottom + SNAP_THRESHOLD) continue;
    xs.add(bLeft);
    xs.add(b.map_cx);
    xs.add(bRight);
    ys.add(bTop);
    ys.add(b.map_cy);
    ys.add(bBottom);
  }
  return { xs: [...xs], ys: [...ys] };
}

// Finds the closest target (within SNAP_THRESHOLD) to any of the given
// candidate positions, returning the offset needed to align to it.
function snapAxis(candidates: number[], targets: number[]): { delta: number; guide: number | null } {
  let bestDist = SNAP_THRESHOLD;
  let bestDelta = 0;
  let guide: number | null = null;
  for (const c of candidates) {
    for (const t of targets) {
      const d = Math.abs(c - t);
      if (d < bestDist) {
        bestDist = d;
        bestDelta = t - c;
        guide = t;
      }
    }
  }
  return { delta: bestDelta, guide };
}

// Zoom range for the floor plan canvas (100%-400%, in 50% steps).
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.5;

type AlignKind = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

const ALIGN_LABELS: Record<AlignKind, string> = {
  left: "Align left edges",
  hcenter: "Align horizontal centers",
  right: "Align right edges",
  top: "Align top edges",
  vcenter: "Align vertical centers",
  bottom: "Align bottom edges",
};

const ALIGN_ICON_SHAPES: Record<
  AlignKind,
  { line: { x1: number; y1: number; x2: number; y2: number }; rects: { x: number; y: number; w: number; h: number }[] }
> = {
  left: {
    line: { x1: 1.5, y1: 0.5, x2: 1.5, y2: 15.5 },
    rects: [
      { x: 1.5, y: 1.5, w: 11, h: 2.5 },
      { x: 1.5, y: 6.5, w: 7, h: 2.5 },
      { x: 1.5, y: 11.5, w: 9, h: 2.5 },
    ],
  },
  hcenter: {
    line: { x1: 8, y1: 0.5, x2: 8, y2: 15.5 },
    rects: [
      { x: 2.5, y: 1.5, w: 11, h: 2.5 },
      { x: 4.5, y: 6.5, w: 7, h: 2.5 },
      { x: 3.5, y: 11.5, w: 9, h: 2.5 },
    ],
  },
  right: {
    line: { x1: 14.5, y1: 0.5, x2: 14.5, y2: 15.5 },
    rects: [
      { x: 3.5, y: 1.5, w: 11, h: 2.5 },
      { x: 7.5, y: 6.5, w: 7, h: 2.5 },
      { x: 5.5, y: 11.5, w: 9, h: 2.5 },
    ],
  },
  top: {
    line: { x1: 0.5, y1: 1.5, x2: 15.5, y2: 1.5 },
    rects: [
      { x: 1.5, y: 1.5, w: 2.5, h: 11 },
      { x: 6.5, y: 1.5, w: 2.5, h: 7 },
      { x: 11.5, y: 1.5, w: 2.5, h: 9 },
    ],
  },
  vcenter: {
    line: { x1: 0.5, y1: 8, x2: 15.5, y2: 8 },
    rects: [
      { x: 1.5, y: 2.5, w: 2.5, h: 11 },
      { x: 6.5, y: 4.5, w: 2.5, h: 7 },
      { x: 11.5, y: 3.5, w: 2.5, h: 9 },
    ],
  },
  bottom: {
    line: { x1: 0.5, y1: 14.5, x2: 15.5, y2: 14.5 },
    rects: [
      { x: 1.5, y: 3.5, w: 2.5, h: 11 },
      { x: 6.5, y: 7.5, w: 2.5, h: 7 },
      { x: 11.5, y: 5.5, w: 2.5, h: 9 },
    ],
  },
};

function AlignIcon({ kind }: { kind: AlignKind }) {
  const { line, rects } = ALIGN_ICON_SHAPES[kind];
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
      <line {...line} stroke="currentColor" strokeWidth="1" strokeDasharray="2 1.5" />
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="currentColor" rx="0.5" />
      ))}
    </svg>
  );
}

type DistributeKind = "horizontal" | "vertical";

const DISTRIBUTE_LABELS: Record<DistributeKind, string> = {
  horizontal: "Distribute horizontal spacing",
  vertical: "Distribute vertical spacing",
};

const DISTRIBUTE_ICON_SHAPES: Record<
  DistributeKind,
  { rects: { x: number; y: number; w: number; h: number }[]; lines: { x1: number; y1: number; x2: number; y2: number }[] }
> = {
  horizontal: {
    rects: [
      { x: 1, y: 5, w: 3, h: 6 },
      { x: 6.5, y: 5, w: 3, h: 6 },
      { x: 12, y: 5, w: 3, h: 6 },
    ],
    lines: [
      { x1: 4, y1: 8, x2: 6.5, y2: 8 },
      { x1: 9.5, y1: 8, x2: 12, y2: 8 },
    ],
  },
  vertical: {
    rects: [
      { x: 5, y: 1, w: 6, h: 3 },
      { x: 5, y: 6.5, w: 6, h: 3 },
      { x: 5, y: 12, w: 6, h: 3 },
    ],
    lines: [
      { x1: 8, y1: 4, x2: 8, y2: 6.5 },
      { x1: 8, y1: 9.5, x2: 8, y2: 12 },
    ],
  },
};

function DistributeIcon({ kind }: { kind: DistributeKind }) {
  const { rects, lines } = DISTRIBUTE_ICON_SHAPES[kind];
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
      {lines.map((l, i) => (
        <line key={i} {...l} stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1" />
      ))}
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="currentColor" rx="0.5" />
      ))}
    </svg>
  );
}

export default function ExpoFloorPlanManager({
  conferenceId,
  conferenceYear,
  editionCode,
  floorPlanUrl,
  initialBooths,
  initialBoothPackages,
  conferenceDates,
  vendorOrgs,
}: Props) {
  const [currentFloorPlanUrl, setCurrentFloorPlanUrl] = useState(floorPlanUrl);
  const [booths, setBooths] = useState<BoothRow[]>(initialBooths);
  const [packages, setPackages] = useState<BoothPackage[]>(initialBoothPackages);
  const [filter, setFilter] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [pkgStatus, setPkgStatus] = useState<Record<string, "saving" | "saved" | "error">>({});
  const [pkgError, setPkgError] = useState<Record<string, string>>({});
  const [addPkgError, setAddPkgError] = useState<string | null>(null);
  const [newBooth, setNewBooth] = useState(() => ({
    ...NEW_BOOTH_DEFAULTS_BASE,
    boothProductId: (initialBoothPackages[0]?.id ?? null) as string | null,
  }));
  const [addError, setAddError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Floor plan editor (draw / move / resize booths)
  const [drawMode, setDrawMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [drawRect, setDrawRect] = useState<{
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);
  const [canvasSaving, setCanvasSaving] = useState<Set<string>>(new Set());
  const [drawError, setDrawError] = useState<string | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const canvasWrapperRef = useRef<HTMLDivElement | null>(null);
  const boothsRef = useRef<BoothRow[]>(initialBooths);
  const movedRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const nudgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudgedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    boothsRef.current = booths;
  }, [booths]);

  // Arrow keys nudge the selected booth(s) by 1 unit (10 with shift);
  // Delete/Backspace removes them. Skipped while focus is in a form field so
  // typing elsewhere on the page isn't hijacked.
  useEffect(() => {
    if (selectedIds.size === 0) return;

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          nudgeSelected(-step, 0);
          break;
        case "ArrowRight":
          e.preventDefault();
          nudgeSelected(step, 0);
          break;
        case "ArrowUp":
          e.preventDefault();
          nudgeSelected(0, -step);
          break;
        case "ArrowDown":
          e.preventDefault();
          nudgeSelected(0, step);
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          handleDeleteSelected();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds]);

  function selectOnly(id: string) {
    setSelectedIds(new Set([id]));
    setAnchorId(null);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchorId((prev) => (prev === id ? null : prev));
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setAnchorId(null);
  }

  // Click handling shared by the canvas and the inventory table:
  // - shift-click toggles membership in the multi-selection
  // - clicking an already-selected booth (within a multi-selection) sets/clears
  //   it as the alignment anchor ("key object" in Illustrator terms) without
  //   changing the selection
  // - otherwise, selects only this booth
  // Returns true if the caller should proceed with a normal single-select
  // action (e.g. starting a drag).
  function handleSelectIntent(id: string, shiftKey: boolean): boolean {
    if (shiftKey) {
      toggleSelect(id);
      return false;
    }
    if (selectedIds.size > 1 && selectedIds.has(id)) {
      setAnchorId((prev) => (prev === id ? null : id));
      return false;
    }
    selectOnly(id);
    return true;
  }

  const packageMap = new Map(packages.map((p) => [p.id, p.name]));

  function clientToSvg(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / rect.width) * FLOOR_PLAN_SVG_W,
      y: ((clientY - rect.top) / rect.height) * FLOOR_PLAN_SVG_H,
    };
  }

  // The portion of the (possibly zoomed + scrolled) canvas currently visible
  // within its scroll container, in floor-plan SVG coordinates.
  function getVisibleSvgBounds(): { left: number; right: number; top: number; bottom: number } {
    const fallback = { left: 0, right: FLOOR_PLAN_SVG_W, top: 0, bottom: FLOOR_PLAN_SVG_H };
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const wrapperRect = canvasWrapperRef.current?.getBoundingClientRect();
    if (!canvasRect || !wrapperRect) return fallback;
    const left = Math.max(canvasRect.left, wrapperRect.left);
    const top = Math.max(canvasRect.top, wrapperRect.top);
    const right = Math.min(canvasRect.right, wrapperRect.right);
    const bottom = Math.min(canvasRect.bottom, wrapperRect.bottom);
    return {
      left: ((left - canvasRect.left) / canvasRect.width) * FLOOR_PLAN_SVG_W,
      right: ((right - canvasRect.left) / canvasRect.width) * FLOOR_PLAN_SVG_W,
      top: ((top - canvasRect.top) / canvasRect.height) * FLOOR_PLAN_SVG_H,
      bottom: ((bottom - canvasRect.top) / canvasRect.height) * FLOOR_PLAN_SVG_H,
    };
  }

  function persistBoothPosition(booth: BoothRow) {
    setCanvasSaving((prev) => new Set(prev).add(booth.id));
    startTransition(async () => {
      const result = await updateBooth(booth.id, {
        mapCx: booth.map_cx,
        mapCy: booth.map_cy,
        mapW: booth.map_w,
        mapH: booth.map_h,
      });
      setCanvasSaving((prev) => {
        const next = new Set(prev);
        next.delete(booth.id);
        return next;
      });
      if (!result.success) {
        setRowError((prev) => ({ ...prev, [booth.id]: result.error ?? "Save failed." }));
      }
    });
  }

  function finishDraw(draft: { startX: number; startY: number; curX: number; curY: number }) {
    const left = Math.min(draft.startX, draft.curX);
    const top = Math.min(draft.startY, draft.curY);
    const w = Math.abs(draft.curX - draft.startX);
    const h = Math.abs(draft.curY - draft.startY);
    if (w < MIN_BOOTH_SIZE || h < MIN_BOOTH_SIZE) return;

    const boothNumber = prompt("Booth number for this new booth:");
    if (!boothNumber || !boothNumber.trim()) return;

    setDrawError(null);
    startTransition(async () => {
      const result = await createBooth(conferenceId, {
        boothNumber: boothNumber.trim(),
        boothProductId: newBooth.boothProductId,
        mapCx: Math.round(left + w / 2),
        mapCy: Math.round(top + h / 2),
        mapW: Math.round(w),
        mapH: Math.round(h),
      });
      if (result.success && result.data) {
        const added = result.data;
        setBooths((prev) =>
          [...prev, added].sort((a, b) =>
            a.booth_number.localeCompare(b.booth_number, undefined, { numeric: true })
          )
        );
        selectOnly(added.id);
      } else {
        setDrawError(result.error ?? "Failed to add booth.");
      }
    });
  }

  // Pointer-capture based dragging: the element under the pointer on
  // pointerdown captures the pointer, so its onPointerMove/onPointerUp keep
  // firing even once the cursor leaves that element's bounds. Everything
  // stays inside React's normal (synthetic) event system this way, so
  // startTransition on pointerup is safe — unlike window-level listeners,
  // which can fire outside any React event and trigger
  // "Cannot call startTransition while rendering".
  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = clientToSvg(e.clientX, e.clientY);
    if (drag.kind === "move") {
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) movedRef.current = true;
      let newCx = clamp(drag.origCx + dx, drag.origW / 2, FLOOR_PLAN_SVG_W - drag.origW / 2);
      let newCy = clamp(drag.origCy + dy, drag.origH / 2, FLOOR_PLAN_SVG_H - drag.origH / 2);

      const { xs, ys } = getSnapTargets(
        boothsRef.current,
        new Set([drag.boothId]),
        getVisibleSvgBounds()
      );
      const snapX = snapAxis([newCx - drag.origW / 2, newCx, newCx + drag.origW / 2], xs);
      const snapY = snapAxis([newCy - drag.origH / 2, newCy, newCy + drag.origH / 2], ys);
      newCx = clamp(newCx + snapX.delta, drag.origW / 2, FLOOR_PLAN_SVG_W - drag.origW / 2);
      newCy = clamp(newCy + snapY.delta, drag.origH / 2, FLOOR_PLAN_SVG_H - drag.origH / 2);
      setSnapGuides({ x: snapX.guide, y: snapY.guide });

      updateLocalBooth(drag.boothId, { map_cx: newCx, map_cy: newCy });
    } else if (drag.kind === "move-group") {
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) movedRef.current = true;
      if (!movedRef.current) return;

      let groupDx = dx;
      let groupDy = dy;
      for (const o of drag.origins) {
        groupDx = clamp(groupDx, o.w / 2 - o.cx, FLOOR_PLAN_SVG_W - o.w / 2 - o.cx);
        groupDy = clamp(groupDy, o.h / 2 - o.cy, FLOOR_PLAN_SVG_H - o.h / 2 - o.cy);
      }

      // Snap based on the grabbed booth, then apply the same delta to the group.
      const lead = drag.origins.find((o) => o.id === drag.boothId)!;
      const leadCx = lead.cx + groupDx;
      const leadCy = lead.cy + groupDy;
      const excludeIds = new Set(drag.origins.map((o) => o.id));
      const { xs, ys } = getSnapTargets(boothsRef.current, excludeIds, getVisibleSvgBounds());
      const snapX = snapAxis([leadCx - lead.w / 2, leadCx, leadCx + lead.w / 2], xs);
      const snapY = snapAxis([leadCy - lead.h / 2, leadCy, leadCy + lead.h / 2], ys);
      groupDx += snapX.delta;
      groupDy += snapY.delta;
      for (const o of drag.origins) {
        groupDx = clamp(groupDx, o.w / 2 - o.cx, FLOOR_PLAN_SVG_W - o.w / 2 - o.cx);
        groupDy = clamp(groupDy, o.h / 2 - o.cy, FLOOR_PLAN_SVG_H - o.h / 2 - o.cy);
      }
      setSnapGuides({ x: snapX.guide, y: snapY.guide });

      for (const o of drag.origins) {
        updateLocalBooth(o.id, { map_cx: o.cx + groupDx, map_cy: o.cy + groupDy });
      }
    } else if (drag.kind === "resize") {
      let w = clamp(x - drag.left, MIN_BOOTH_SIZE, FLOOR_PLAN_SVG_W - drag.left);
      let h = clamp(y - drag.top, MIN_BOOTH_SIZE, FLOOR_PLAN_SVG_H - drag.top);

      const { xs, ys } = getSnapTargets(
        boothsRef.current,
        new Set([drag.boothId]),
        getVisibleSvgBounds()
      );
      const snapX = snapAxis([drag.left + w], xs);
      const snapY = snapAxis([drag.top + h], ys);
      w = clamp(w + snapX.delta, MIN_BOOTH_SIZE, FLOOR_PLAN_SVG_W - drag.left);
      h = clamp(h + snapY.delta, MIN_BOOTH_SIZE, FLOOR_PLAN_SVG_H - drag.top);
      setSnapGuides({ x: snapX.guide, y: snapY.guide });

      updateLocalBooth(drag.boothId, {
        map_cx: drag.left + w / 2,
        map_cy: drag.top + h / 2,
        map_w: w,
        map_h: h,
      });
    } else if (drag.kind === "draw") {
      const next: DragState = {
        ...drag,
        curX: clamp(x, 0, FLOOR_PLAN_SVG_W),
        curY: clamp(y, 0, FLOOR_PLAN_SVG_H),
      };
      dragRef.current = next;
      setDrawRect(next);
    } else {
      if (Math.abs(x - drag.startX) > 1 || Math.abs(y - drag.startY) > 1) movedRef.current = true;
      const next: DragState = {
        ...drag,
        curX: clamp(x, 0, FLOOR_PLAN_SVG_W),
        curY: clamp(y, 0, FLOOR_PLAN_SVG_H),
      };
      dragRef.current = next;
      setMarqueeRect(next);
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    setSnapGuides({ x: null, y: null });
    if (drag.kind === "move") {
      if (movedRef.current) {
        const booth = boothsRef.current.find((b) => b.id === drag.boothId);
        if (booth) persistBoothPosition(booth);
      }
    } else if (drag.kind === "move-group") {
      if (movedRef.current) {
        for (const o of drag.origins) {
          const booth = boothsRef.current.find((b) => b.id === o.id);
          if (booth) persistBoothPosition(booth);
        }
      } else {
        handleSelectIntent(drag.boothId, false);
      }
    } else if (drag.kind === "resize") {
      const booth = boothsRef.current.find((b) => b.id === drag.boothId);
      if (booth) persistBoothPosition(booth);
    } else if (drag.kind === "draw") {
      finishDraw(drag);
      setDrawRect(null);
    } else {
      setMarqueeRect(null);
      if (movedRef.current) {
        const left = Math.min(drag.startX, drag.curX);
        const right = Math.max(drag.startX, drag.curX);
        const top = Math.min(drag.startY, drag.curY);
        const bottom = Math.max(drag.startY, drag.curY);
        const hits = boothsRef.current.filter((b) => {
          const bLeft = b.map_cx - b.map_w / 2;
          const bRight = b.map_cx + b.map_w / 2;
          const bTop = b.map_cy - b.map_h / 2;
          const bBottom = b.map_cy + b.map_h / 2;
          return bLeft < right && bRight > left && bTop < bottom && bBottom > top;
        });
        if (drag.additive) {
          setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const b of hits) next.add(b.id);
            return next;
          });
        } else {
          setSelectedIds(new Set(hits.map((b) => b.id)));
          setAnchorId(null);
        }
      } else if (!drag.additive) {
        clearSelection();
      }
    }
  }

  function handleCanvasPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = clientToSvg(e.clientX, e.clientY);
    movedRef.current = false;
    if (drawMode) {
      const next: DragState = { kind: "draw", startX: x, startY: y, curX: x, curY: y };
      dragRef.current = next;
      setDrawRect(next);
    } else {
      const next: DragState = {
        kind: "marquee",
        startX: x,
        startY: y,
        curX: x,
        curY: y,
        additive: e.shiftKey,
      };
      dragRef.current = next;
      setMarqueeRect(next);
    }
  }

  function handleBoothPointerDown(e: React.PointerEvent<HTMLDivElement>, booth: BoothRow) {
    if (drawMode || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    movedRef.current = false;
    const { x, y } = clientToSvg(e.clientX, e.clientY);

    if (!e.shiftKey && selectedIds.size > 1 && selectedIds.has(booth.id)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const origins = boothsRef.current
        .filter((b) => selectedIds.has(b.id))
        .map((b) => ({ id: b.id, cx: b.map_cx, cy: b.map_cy, w: b.map_w, h: b.map_h }));
      dragRef.current = { kind: "move-group", boothId: booth.id, startX: x, startY: y, origins };
      return;
    }

    if (!handleSelectIntent(booth.id, e.shiftKey)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: "move",
      boothId: booth.id,
      startX: x,
      startY: y,
      origCx: booth.map_cx,
      origCy: booth.map_cy,
      origW: booth.map_w,
      origH: booth.map_h,
    };
  }

  function handleResizePointerDown(e: React.PointerEvent<HTMLDivElement>, booth: BoothRow) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    selectOnly(booth.id);
    dragRef.current = {
      kind: "resize",
      boothId: booth.id,
      left: booth.map_cx - booth.map_w / 2,
      top: booth.map_cy - booth.map_h / 2,
    };
  }

  function handleUpload() {
    if (!selectedFile) return;
    const reader = new FileReader();
    reader.onload = () => {
      const fileData = reader.result as string;
      startTransition(async () => {
        const result = await uploadFloorPlanImage({
          conferenceId,
          fileData,
          fileName: selectedFile.name,
          contentType: selectedFile.type,
        });
        if (result.success && result.url) {
          setCurrentFloorPlanUrl(result.url);
          setUploadError(null);
          setSelectedFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
        } else {
          setUploadError(result.error ?? "Upload failed.");
        }
      });
    };
    reader.readAsDataURL(selectedFile);
  }

  function updateLocalBooth(id: string, patch: Partial<BoothRow>) {
    setBooths((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function handleSaveBooth(booth: BoothRow) {
    setRowStatus((prev) => ({ ...prev, [booth.id]: "saving" }));
    setRowError((prev) => {
      const next = { ...prev };
      delete next[booth.id];
      return next;
    });
    startTransition(async () => {
      const result = await updateBooth(booth.id, {
        boothNumber: booth.booth_number,
        boothProductId: booth.booth_product_id,
        status: booth.status,
        mapCx: booth.map_cx,
        mapCy: booth.map_cy,
        mapW: booth.map_w,
        mapH: booth.map_h,
        organizationId: booth.organization_id,
      });
      if (result.success) {
        setRowStatus((prev) => ({ ...prev, [booth.id]: "saved" }));
      } else {
        setRowStatus((prev) => ({ ...prev, [booth.id]: "error" }));
        setRowError((prev) => ({ ...prev, [booth.id]: result.error ?? "Save failed." }));
      }
    });
  }

  function handleDeleteBooth(booth: BoothRow) {
    if (!confirm(`Delete booth ${booth.booth_number}? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await deleteBooth(booth.id);
      if (result.success) {
        setBooths((prev) => prev.filter((b) => b.id !== booth.id));
      } else {
        setRowError((prev) => ({ ...prev, [booth.id]: result.error ?? "Delete failed." }));
      }
    });
  }

  function handleDeleteSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const label =
      ids.length === 1
        ? `booth ${booths.find((b) => b.id === ids[0])?.booth_number ?? ""}`
        : `${ids.length} booths`;
    if (!confirm(`Delete ${label}? This cannot be undone.`)) return;

    startTransition(async () => {
      const results = await Promise.all(
        ids.map(async (id) => ({ id, result: await deleteBooth(id) }))
      );
      const deletedIds = new Set<string>();
      for (const { id, result } of results) {
        if (result.success) {
          deletedIds.add(id);
        } else {
          setRowError((prev) => ({ ...prev, [id]: result.error ?? "Delete failed." }));
        }
      }
      if (deletedIds.size > 0) {
        setBooths((prev) => prev.filter((b) => !deletedIds.has(b.id)));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of deletedIds) next.delete(id);
          return next;
        });
        setAnchorId((prev) => (prev && deletedIds.has(prev) ? null : prev));
      }
    });
  }

  function handleDuplicateBooth(booth: BoothRow) {
    const boothNumber = prompt("Booth number for the duplicate:", `${booth.booth_number} copy`);
    if (!boothNumber || !boothNumber.trim()) return;

    const mapCx = clamp(
      booth.map_cx + DUPLICATE_OFFSET,
      booth.map_w / 2,
      FLOOR_PLAN_SVG_W - booth.map_w / 2
    );
    const mapCy = clamp(
      booth.map_cy + DUPLICATE_OFFSET,
      booth.map_h / 2,
      FLOOR_PLAN_SVG_H - booth.map_h / 2
    );

    startTransition(async () => {
      const result = await createBooth(conferenceId, {
        boothNumber: boothNumber.trim(),
        boothProductId: booth.booth_product_id,
        mapCx: Math.round(mapCx),
        mapCy: Math.round(mapCy),
        mapW: Math.round(booth.map_w),
        mapH: Math.round(booth.map_h),
      });
      if (result.success && result.data) {
        const added = result.data;
        setBooths((prev) =>
          [...prev, added].sort((a, b) =>
            a.booth_number.localeCompare(b.booth_number, undefined, { numeric: true })
          )
        );
        selectOnly(added.id);
      } else {
        setRowError((prev) => ({ ...prev, [booth.id]: result.error ?? "Duplicate failed." }));
      }
    });
  }

  // Aligns the selected booths to edges/center. If an anchor ("key object")
  // is set, every other selected booth aligns to the anchor's edges/center
  // and the anchor itself doesn't move — Illustrator's "Align to Key Object".
  // Otherwise, booths align to the combined bounding box of the selection.
  function alignSelected(kind: AlignKind) {
    const selected = booths.filter((b) => selectedIds.has(b.id));
    if (selected.length < 2) return;

    const anchor = anchorId ? selected.find((b) => b.id === anchorId) : undefined;

    let boundLeft: number;
    let boundRight: number;
    let boundTop: number;
    let boundBottom: number;
    if (anchor) {
      boundLeft = anchor.map_cx - anchor.map_w / 2;
      boundRight = anchor.map_cx + anchor.map_w / 2;
      boundTop = anchor.map_cy - anchor.map_h / 2;
      boundBottom = anchor.map_cy + anchor.map_h / 2;
    } else {
      boundLeft = Math.min(...selected.map((b) => b.map_cx - b.map_w / 2));
      boundRight = Math.max(...selected.map((b) => b.map_cx + b.map_w / 2));
      boundTop = Math.min(...selected.map((b) => b.map_cy - b.map_h / 2));
      boundBottom = Math.max(...selected.map((b) => b.map_cy + b.map_h / 2));
    }

    for (const booth of selected) {
      if (anchor && booth.id === anchor.id) continue;
      let mapCx = booth.map_cx;
      let mapCy = booth.map_cy;
      switch (kind) {
        case "left":
          mapCx = boundLeft + booth.map_w / 2;
          break;
        case "hcenter":
          mapCx = (boundLeft + boundRight) / 2;
          break;
        case "right":
          mapCx = boundRight - booth.map_w / 2;
          break;
        case "top":
          mapCy = boundTop + booth.map_h / 2;
          break;
        case "vcenter":
          mapCy = (boundTop + boundBottom) / 2;
          break;
        case "bottom":
          mapCy = boundBottom - booth.map_h / 2;
          break;
      }
      mapCx = clamp(mapCx, booth.map_w / 2, FLOOR_PLAN_SVG_W - booth.map_w / 2);
      mapCy = clamp(mapCy, booth.map_h / 2, FLOOR_PLAN_SVG_H - booth.map_h / 2);
      if (mapCx === booth.map_cx && mapCy === booth.map_cy) continue;
      updateLocalBooth(booth.id, { map_cx: mapCx, map_cy: mapCy });
      persistBoothPosition({ ...booth, map_cx: mapCx, map_cy: mapCy });
    }
  }

  // Evens out the gaps between 3+ selected booths along an axis, keeping the
  // outermost two booths fixed (Illustrator's "distribute spacing").
  function distributeSelected(axis: DistributeKind) {
    const selected = booths.filter((b) => selectedIds.has(b.id));
    if (selected.length < 3) return;

    if (axis === "horizontal") {
      const sorted = [...selected].sort(
        (a, b) => a.map_cx - a.map_w / 2 - (b.map_cx - b.map_w / 2)
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span = last.map_cx + last.map_w / 2 - (first.map_cx - first.map_w / 2);
      const totalSize = sorted.reduce((sum, b) => sum + b.map_w, 0);
      const gap = (span - totalSize) / (sorted.length - 1);

      let cursor = first.map_cx - first.map_w / 2;
      for (let i = 0; i < sorted.length; i++) {
        const booth = sorted[i];
        if (i > 0 && i < sorted.length - 1) {
          const mapCx = cursor + booth.map_w / 2;
          updateLocalBooth(booth.id, { map_cx: mapCx });
          persistBoothPosition({ ...booth, map_cx: mapCx });
        }
        cursor += booth.map_w + gap;
      }
    } else {
      const sorted = [...selected].sort(
        (a, b) => a.map_cy - a.map_h / 2 - (b.map_cy - b.map_h / 2)
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span = last.map_cy + last.map_h / 2 - (first.map_cy - first.map_h / 2);
      const totalSize = sorted.reduce((sum, b) => sum + b.map_h, 0);
      const gap = (span - totalSize) / (sorted.length - 1);

      let cursor = first.map_cy - first.map_h / 2;
      for (let i = 0; i < sorted.length; i++) {
        const booth = sorted[i];
        if (i > 0 && i < sorted.length - 1) {
          const mapCy = cursor + booth.map_h / 2;
          updateLocalBooth(booth.id, { map_cy: mapCy });
          persistBoothPosition({ ...booth, map_cy: mapCy });
        }
        cursor += booth.map_h + gap;
      }
    }
  }

  // Nudges the selected booth(s) by (dx, dy) units, updating local state
  // immediately and persisting after a short pause so key-repeat doesn't
  // spam the server.
  function nudgeSelected(dx: number, dy: number) {
    if (selectedIds.size === 0) return;
    setBooths((prev) =>
      prev.map((b) => {
        if (!selectedIds.has(b.id)) return b;
        const mapCx = clamp(b.map_cx + dx, b.map_w / 2, FLOOR_PLAN_SVG_W - b.map_w / 2);
        const mapCy = clamp(b.map_cy + dy, b.map_h / 2, FLOOR_PLAN_SVG_H - b.map_h / 2);
        return { ...b, map_cx: mapCx, map_cy: mapCy };
      })
    );
    for (const id of selectedIds) nudgedIdsRef.current.add(id);

    if (nudgeTimeoutRef.current) clearTimeout(nudgeTimeoutRef.current);
    nudgeTimeoutRef.current = setTimeout(() => {
      const ids = nudgedIdsRef.current;
      nudgedIdsRef.current = new Set();
      for (const id of ids) {
        const booth = boothsRef.current.find((b) => b.id === id);
        if (booth) persistBoothPosition(booth);
      }
    }, 400);
  }

  // Commits an X/Y/W/H edit from the selection info bar: clamps to canvas
  // bounds (width/height first, then position) and persists.
  function commitBoothEdit(id: string) {
    const current = boothsRef.current.find((b) => b.id === id);
    if (!current) return;
    const mapW = clamp(current.map_w, MIN_BOOTH_SIZE, FLOOR_PLAN_SVG_W);
    const mapH = clamp(current.map_h, MIN_BOOTH_SIZE, FLOOR_PLAN_SVG_H);
    const mapCx = clamp(current.map_cx, mapW / 2, FLOOR_PLAN_SVG_W - mapW / 2);
    const mapCy = clamp(current.map_cy, mapH / 2, FLOOR_PLAN_SVG_H - mapH / 2);
    const updated = { ...current, map_cx: mapCx, map_cy: mapCy, map_w: mapW, map_h: mapH };
    updateLocalBooth(id, { map_cx: mapCx, map_cy: mapCy, map_w: mapW, map_h: mapH });
    persistBoothPosition(updated);
  }

  function handleAddBooth() {
    if (!newBooth.boothNumber.trim()) {
      setAddError("Booth number is required.");
      return;
    }
    setAddError(null);
    startTransition(async () => {
      const result = await createBooth(conferenceId, newBooth);
      if (result.success && result.data) {
        const added = result.data;
        setBooths((prev) =>
          [...prev, added].sort((a, b) =>
            a.booth_number.localeCompare(b.booth_number, undefined, { numeric: true })
          )
        );
        setNewBooth({
          ...NEW_BOOTH_DEFAULTS_BASE,
          boothProductId: newBooth.boothProductId,
        });
      } else {
        setAddError(result.error ?? "Failed to add booth.");
      }
    });
  }

  function updateLocalPackage(id: string, patch: Partial<BoothPackage>) {
    setPackages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function updatePackageDayPattern(id: string, date: string, role: BoothDayRole, checked: boolean) {
    setPackages((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const current = p.dayPattern[date] ?? [];
        const nextRoles = checked ? [...current, role] : current.filter((r) => r !== role);
        const nextPattern = { ...p.dayPattern };
        if (nextRoles.length === 0) delete nextPattern[date];
        else nextPattern[date] = nextRoles;
        return { ...p, dayPattern: nextPattern };
      })
    );
  }

  function handleSavePackage(pkg: BoothPackage) {
    setPkgStatus((prev) => ({ ...prev, [pkg.id]: "saving" }));
    setPkgError((prev) => {
      const next = { ...prev };
      delete next[pkg.id];
      return next;
    });
    startTransition(async () => {
      const result = await updateProduct(pkg.id, {
        name: pkg.name,
        price_cents: pkg.price_cents,
        is_active: pkg.is_active,
        metadata: { booth_system: true, day_pattern: pkg.dayPattern },
      });
      if (result.success) {
        setPkgStatus((prev) => ({ ...prev, [pkg.id]: "saved" }));
      } else {
        setPkgStatus((prev) => ({ ...prev, [pkg.id]: "error" }));
        setPkgError((prev) => ({ ...prev, [pkg.id]: result.error ?? "Save failed." }));
      }
    });
  }

  function handleDeletePackage(pkg: BoothPackage) {
    if (
      !confirm(
        `Delete package "${pkg.name}"? Booths assigned to this package will become unassigned.`
      )
    )
      return;
    startTransition(async () => {
      const result = await deleteProduct(pkg.id);
      if (result.success) {
        setPackages((prev) => prev.filter((p) => p.id !== pkg.id));
        setBooths((prev) =>
          prev.map((b) => (b.booth_product_id === pkg.id ? { ...b, booth_product_id: null } : b))
        );
      } else {
        setPkgError((prev) => ({ ...prev, [pkg.id]: result.error ?? "Delete failed." }));
      }
    });
  }

  function handleAddPackage() {
    const name = prompt("New booth package name:");
    if (!name || !name.trim()) return;
    setAddPkgError(null);
    const nextDisplayOrder =
      packages.length > 0 ? Math.max(...packages.map((p) => p.display_order)) + 1 : 0;
    startTransition(async () => {
      const result = await createProduct({
        conference_id: conferenceId,
        slug: `booth_package_${Date.now()}`,
        name: name.trim(),
        price_cents: 0,
        is_taxable: true,
        is_tax_exempt: false,
        capacity: null,
        max_per_account: 1,
        display_order: nextDisplayOrder,
        is_active: true,
        metadata: { booth_system: true, day_pattern: {} },
      });
      if (result.success && result.data) {
        const [added] = getBoothPackagesFromProducts([result.data]);
        if (added) {
          setPackages((prev) => [...prev, added].sort((a, b) => a.display_order - b.display_order));
        }
      } else {
        setAddPkgError(result.error ?? "Failed to add package.");
      }
    });
  }

  const filteredBooths = booths.filter((b) => {
    if (!filter.trim()) return true;
    const q = filter.trim().toLowerCase();
    return (
      b.booth_number.toLowerCase().includes(q) ||
      (packageMap.get(b.booth_product_id ?? "") ?? "unassigned").toLowerCase().includes(q) ||
      b.status.toLowerCase().includes(q) ||
      (b.organization_name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {/* Booth packages */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm font-semibold text-gray-900">Booth Packages</p>
        <p className="mt-1 text-xs text-gray-600">
          Define the booth tiers exhibitors can purchase. Each package is also a product —
          manage its description, pricing rules, and audience requirements in the{" "}
          <a
            href={`/admin/conference/${conferenceId}/products`}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-gray-800"
          >
            Products tab
          </a>
          .
        </p>

        {conferenceDates.length === 0 && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Set the conference start and end dates (in Details) to configure which days each
            package is available.
          </p>
        )}

        <div className="mt-3 space-y-3">
          {packages.map((pkg) => (
            <div key={pkg.id} className="rounded-md border border-gray-100 p-3">
              <div className="flex flex-wrap items-end gap-2 text-xs">
                <label className="flex flex-col gap-1">
                  Name
                  <input
                    type="text"
                    value={pkg.name}
                    onChange={(e) => updateLocalPackage(pkg.id, { name: e.target.value })}
                    className="w-48 rounded border border-gray-300 px-1 py-0.5"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Price ($)
                  <input
                    type="number"
                    step="0.01"
                    value={(pkg.price_cents / 100).toFixed(2)}
                    onChange={(e) =>
                      updateLocalPackage(pkg.id, {
                        price_cents: Math.round(Number(e.target.value) * 100),
                      })
                    }
                    className="w-24 rounded border border-gray-300 px-1 py-0.5"
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={pkg.is_active}
                    onChange={(e) => updateLocalPackage(pkg.id, { is_active: e.target.checked })}
                  />
                  Active
                </label>
                <button
                  type="button"
                  onClick={() => handleSavePackage(pkg)}
                  disabled={isPending}
                  className="rounded bg-gray-900 px-2 py-1 text-white hover:bg-gray-700 disabled:opacity-50"
                >
                  {pkgStatus[pkg.id] === "saving" ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeletePackage(pkg)}
                  disabled={isPending}
                  className="rounded border border-red-300 px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Delete
                </button>
                {pkgStatus[pkg.id] === "saved" && <span className="text-green-600">✓</span>}
              </div>
              {pkgError[pkg.id] && <p className="mt-1 text-xs text-red-600">{pkgError[pkg.id]}</p>}

              {conferenceDates.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {conferenceDates.map((date) => {
                    const dayRoles = pkg.dayPattern[date] ?? [];
                    return (
                      <div key={date} className="rounded border border-gray-200 p-1.5 text-xs">
                        <p className="font-medium text-gray-700">{formatDayLabel(date)}</p>
                        <div className="mt-1 space-y-0.5">
                          {(Object.entries(BOOTH_DAY_ROLE_LABELS) as [BoothDayRole, string][]).map(
                            ([role, label]) => (
                              <label key={role} className="flex items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={dayRoles.includes(role)}
                                  onChange={(e) =>
                                    updatePackageDayPattern(pkg.id, date, role, e.target.checked)
                                  }
                                />
                                {label}
                              </label>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={handleAddPackage}
            disabled={isPending}
            className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
          >
            Add Package
          </button>
          {addPkgError && <p className="mt-2 text-xs text-red-600">{addPkgError}</p>}
        </div>
      </div>

      {/* Floor plan image */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm font-semibold text-gray-900">Floor Plan Image</p>
        <p className="mt-1 text-xs text-gray-600">
          Upload an SVG, PNG, JPG, or WebP image of the trade show floor. For booth markers
          to align correctly, the image should match the {FLOOR_PLAN_SVG_W}×{FLOOR_PLAN_SVG_H}{" "}
          (16:9) coordinate space used by the booth positions below.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/svg+xml,image/png,image/jpeg,image/webp"
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <button
            type="button"
            onClick={handleUpload}
            disabled={!selectedFile || isPending}
            className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
          >
            {isPending ? "Uploading…" : "Upload"}
          </button>
          {currentFloorPlanUrl && (
            <a
              href={currentFloorPlanUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-gray-500 underline hover:text-gray-700"
            >
              View current file
            </a>
          )}
        </div>
        {uploadError && <p className="mt-2 text-xs text-red-600">{uploadError}</p>}
      </div>

      {/* Floor plan editor */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">Floor Plan Editor</p>
            <p className="mt-1 text-xs text-gray-600">
              {drawMode
                ? "Click and drag on the floor plan to draw a new booth."
                : "Drag a booth to move it, or drag its corner handle to resize. Click to select; shift-click to select multiple and align them."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-md border border-gray-300 bg-white p-1">
              {(["left", "hcenter", "right"] as AlignKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  title={ALIGN_LABELS[kind]}
                  onClick={() => alignSelected(kind)}
                  disabled={selectedIds.size < 2}
                  className="rounded p-1 text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <AlignIcon kind={kind} />
                </button>
              ))}
              <div className="mx-1 h-4 w-px bg-gray-300" />
              {(["top", "vcenter", "bottom"] as AlignKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  title={ALIGN_LABELS[kind]}
                  onClick={() => alignSelected(kind)}
                  disabled={selectedIds.size < 2}
                  className="rounded p-1 text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <AlignIcon kind={kind} />
                </button>
              ))}
              <div className="mx-1 h-4 w-px bg-gray-300" />
              {(["horizontal", "vertical"] as DistributeKind[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  title={DISTRIBUTE_LABELS[kind]}
                  onClick={() => distributeSelected(kind)}
                  disabled={selectedIds.size < 3}
                  className="rounded p-1 text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <DistributeIcon kind={kind} />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 rounded-md border border-gray-300 px-1 py-1 text-xs text-gray-700">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100))}
                disabled={zoom <= ZOOM_MIN}
                title="Zoom out"
                className="rounded px-1.5 py-0.5 hover:bg-gray-100 disabled:opacity-30"
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                title="Reset zoom"
                className="w-12 rounded px-1 py-0.5 text-center hover:bg-gray-100"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100))}
                disabled={zoom >= ZOOM_MAX}
                title="Zoom in"
                className="rounded px-1.5 py-0.5 hover:bg-gray-100 disabled:opacity-30"
              >
                +
              </button>
            </div>
            <select
              value={newBooth.boothProductId ?? ""}
              onChange={(e) =>
                setNewBooth((prev) => ({ ...prev, boothProductId: e.target.value || null }))
              }
              title="Package assigned to newly drawn booths"
              className="rounded-md border border-gray-300 px-2 py-1 text-xs"
            >
              <option value="">— Unassigned —</option>
              {packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setDrawMode((prev) => !prev);
                clearSelection();
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                drawMode
                  ? "bg-[#EE2A2E] text-white hover:bg-[#b50001]"
                  : "border border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {drawMode ? "Drawing… (click to stop)" : "Draw new booth"}
            </button>
          </div>
        </div>
        {drawError && <p className="mt-2 text-xs text-red-600">{drawError}</p>}

        <div
          ref={canvasWrapperRef}
          className="relative mt-3 max-h-[70vh] w-full overflow-auto rounded-lg border border-gray-200 bg-gray-50"
        >
        <div
          ref={canvasRef}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="relative select-none overflow-hidden"
          style={{
            width: `${zoom * 100}%`,
            paddingBottom: `${(FLOOR_PLAN_SVG_H / FLOOR_PLAN_SVG_W) * zoom * 100}%`,
            cursor: drawMode ? "crosshair" : "default",
            touchAction: "none",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentFloorPlanUrl ?? DEFAULT_FLOOR_PLAN_URL}
            alt="Floor plan"
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />

          {booths.map((booth) => {
            const left = booth.map_cx - booth.map_w / 2;
            const top = booth.map_cy - booth.map_h / 2;
            const isSelected = selectedIds.has(booth.id);
            const isAnchor = isSelected && selectedIds.size > 1 && booth.id === anchorId;
            return (
              <div
                key={booth.id}
                onPointerDown={(e) => handleBoothPointerDown(e, booth)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                title={`Booth ${booth.booth_number} (${
                  packageMap.get(booth.booth_product_id ?? "") ?? "Unassigned"
                }) — ${BOOTH_STATUS_LABELS[booth.status]}`}
                className="absolute flex items-center justify-center overflow-hidden text-[10px] font-semibold text-gray-900"
                style={{
                  left: pct(left, FLOOR_PLAN_SVG_W),
                  top: pct(top, FLOOR_PLAN_SVG_H),
                  width: pct(booth.map_w, FLOOR_PLAN_SVG_W),
                  height: pct(booth.map_h, FLOOR_PLAN_SVG_H),
                  // Fill matches the canvas background (white) so booths read
                  // as cutouts; status is conveyed by the border color.
                  background: "#ffffff",
                  border: `${isAnchor ? 3 : 2}px solid ${
                    isAnchor ? "#f59e0b" : isSelected ? "#2563eb" : BOOTH_STATUS_BORDER_COLORS[booth.status]
                  }`,
                  cursor: drawMode ? "crosshair" : "move",
                  touchAction: "none",
                  zIndex: isAnchor ? 11 : isSelected ? 10 : 1,
                }}
              >
                <span className="pointer-events-none truncate px-0.5">{booth.booth_number}</span>
                {canvasSaving.has(booth.id) && (
                  <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
                )}
                {isSelected && selectedIds.size === 1 && (
                  <div
                    onPointerDown={(e) => handleResizePointerDown(e, booth)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    style={{ touchAction: "none" }}
                    className="absolute -bottom-1 -right-1 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-blue-600"
                  />
                )}
              </div>
            );
          })}

          {drawRect && (
            <div
              className="absolute border-2 border-dashed border-blue-500 bg-blue-500/10"
              style={{
                left: pct(Math.min(drawRect.startX, drawRect.curX), FLOOR_PLAN_SVG_W),
                top: pct(Math.min(drawRect.startY, drawRect.curY), FLOOR_PLAN_SVG_H),
                width: pct(Math.abs(drawRect.curX - drawRect.startX), FLOOR_PLAN_SVG_W),
                height: pct(Math.abs(drawRect.curY - drawRect.startY), FLOOR_PLAN_SVG_H),
              }}
            />
          )}

          {marqueeRect && (
            <div
              className="pointer-events-none absolute border border-dashed border-indigo-500 bg-indigo-500/10"
              style={{
                left: pct(Math.min(marqueeRect.startX, marqueeRect.curX), FLOOR_PLAN_SVG_W),
                top: pct(Math.min(marqueeRect.startY, marqueeRect.curY), FLOOR_PLAN_SVG_H),
                width: pct(Math.abs(marqueeRect.curX - marqueeRect.startX), FLOOR_PLAN_SVG_W),
                height: pct(Math.abs(marqueeRect.curY - marqueeRect.startY), FLOOR_PLAN_SVG_H),
                zIndex: 20,
              }}
            />
          )}

          {snapGuides.x !== null && (
            <div
              className="pointer-events-none absolute inset-y-0 w-0 border-l border-dashed border-pink-500"
              style={{ left: pct(snapGuides.x, FLOOR_PLAN_SVG_W), zIndex: 20 }}
            />
          )}
          {snapGuides.y !== null && (
            <div
              className="pointer-events-none absolute inset-x-0 h-0 border-t border-dashed border-pink-500"
              style={{ top: pct(snapGuides.y, FLOOR_PLAN_SVG_H), zIndex: 20 }}
            />
          )}
        </div>
        </div>

        {selectedIds.size === 1 &&
          (() => {
            const booth = booths.find((b) => b.id === Array.from(selectedIds)[0]);
            if (!booth) return null;
            return (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-gray-50 px-3 py-2 text-xs">
                <span className="font-semibold text-gray-900">Booth {booth.booth_number}</span>
                <span className="text-gray-600">
                  {packageMap.get(booth.booth_product_id ?? "") ?? "Unassigned"} ·{" "}
                  {BOOTH_STATUS_LABELS[booth.status]}
                </span>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-500">
                  <label className="flex items-center gap-1">
                    X
                    <input
                      type="number"
                      value={Math.round(booth.map_cx)}
                      onChange={(e) => updateLocalBooth(booth.id, { map_cx: Number(e.target.value) })}
                      onBlur={() => commitBoothEdit(booth.id)}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      className="w-16 rounded border border-gray-300 px-1 py-0.5 text-gray-900"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    Y
                    <input
                      type="number"
                      value={Math.round(booth.map_cy)}
                      onChange={(e) => updateLocalBooth(booth.id, { map_cy: Number(e.target.value) })}
                      onBlur={() => commitBoothEdit(booth.id)}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      className="w-16 rounded border border-gray-300 px-1 py-0.5 text-gray-900"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    W
                    <input
                      type="number"
                      value={Math.round(booth.map_w)}
                      onChange={(e) => updateLocalBooth(booth.id, { map_w: Number(e.target.value) })}
                      onBlur={() => commitBoothEdit(booth.id)}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      className="w-16 rounded border border-gray-300 px-1 py-0.5 text-gray-900"
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    H
                    <input
                      type="number"
                      value={Math.round(booth.map_h)}
                      onChange={(e) => updateLocalBooth(booth.id, { map_h: Number(e.target.value) })}
                      onBlur={() => commitBoothEdit(booth.id)}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      className="w-16 rounded border border-gray-300 px-1 py-0.5 text-gray-900"
                    />
                  </label>
                </div>
                {canvasSaving.has(booth.id) && <span className="text-blue-600">Saving…</span>}
                <button
                  type="button"
                  onClick={() => handleDuplicateBooth(booth)}
                  disabled={isPending}
                  className="ml-auto rounded border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  disabled={isPending}
                  className="rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="rounded border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-100"
                >
                  Deselect
                </button>
              </div>
            );
          })()}

        {selectedIds.size > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-gray-50 px-3 py-2 text-xs">
            <span className="font-semibold text-gray-900">{selectedIds.size} booths selected</span>
            {anchorId ? (
              <span className="text-amber-700">
                Aligning to Booth {booths.find((b) => b.id === anchorId)?.booth_number} (key
                object) — click it again to clear
              </span>
            ) : (
              <span className="text-gray-500">
                Click a selected booth again to set it as the alignment anchor
              </span>
            )}
            <button
              type="button"
              onClick={handleDeleteSelected}
              disabled={isPending}
              className="ml-auto rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Delete selected
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-100"
            >
              Clear selection
            </button>
          </div>
        )}
      </div>

      {/* Booth inventory */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">Booth Inventory ({booths.length})</p>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by number, package, status, org…"
            className="rounded-md border border-gray-300 px-2 py-1 text-xs"
          />
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="px-2 py-1">Booth #</th>
                <th className="px-2 py-1">Package</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Organization</th>
                <th className="px-2 py-1">X</th>
                <th className="px-2 py-1">Y</th>
                <th className="px-2 py-1">W</th>
                <th className="px-2 py-1">H</th>
                <th className="px-2 py-1" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredBooths.map((booth) => (
                <tr
                  key={booth.id}
                  id={`booth-row-${booth.id}`}
                  onClick={(e) => handleSelectIntent(booth.id, e.shiftKey)}
                  className={
                    booth.id === anchorId && selectedIds.size > 1
                      ? "bg-amber-50"
                      : selectedIds.has(booth.id)
                        ? "bg-blue-50"
                        : undefined
                  }
                >
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={booth.booth_number}
                      onChange={(e) => updateLocalBooth(booth.id, { booth_number: e.target.value })}
                      className="w-16 rounded border border-gray-300 px-1 py-0.5 font-mono"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <select
                      value={booth.booth_product_id ?? ""}
                      onChange={(e) =>
                        updateLocalBooth(booth.id, { booth_product_id: e.target.value || null })
                      }
                      className="rounded border border-gray-300 px-1 py-0.5"
                    >
                      <option value="">— Unassigned —</option>
                      {packages.map((pkg) => (
                        <option key={pkg.id} value={pkg.id}>
                          {pkg.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <select
                      value={booth.status}
                      onChange={(e) => updateLocalBooth(booth.id, { status: e.target.value as BoothStatus })}
                      className="rounded border border-gray-300 px-1 py-0.5"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {BOOTH_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <select
                      value={booth.organization_id ?? ""}
                      onChange={(e) =>
                        updateLocalBooth(booth.id, { organization_id: e.target.value || null })
                      }
                      className="rounded border border-gray-300 px-1 py-0.5"
                    >
                      <option value="">— none —</option>
                      {vendorOrgs.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      value={booth.map_cx}
                      onChange={(e) => updateLocalBooth(booth.id, { map_cx: Number(e.target.value) })}
                      className="w-16 rounded border border-gray-300 px-1 py-0.5"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      value={booth.map_cy}
                      onChange={(e) => updateLocalBooth(booth.id, { map_cy: Number(e.target.value) })}
                      className="w-16 rounded border border-gray-300 px-1 py-0.5"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      value={booth.map_w}
                      onChange={(e) => updateLocalBooth(booth.id, { map_w: Number(e.target.value) })}
                      className="w-14 rounded border border-gray-300 px-1 py-0.5"
                    />
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="number"
                      value={booth.map_h}
                      onChange={(e) => updateLocalBooth(booth.id, { map_h: Number(e.target.value) })}
                      className="w-14 rounded border border-gray-300 px-1 py-0.5"
                    />
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleSaveBooth(booth)}
                      disabled={isPending}
                      className="rounded bg-gray-900 px-2 py-0.5 text-white hover:bg-gray-700 disabled:opacity-50"
                    >
                      {rowStatus[booth.id] === "saving" ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDuplicateBooth(booth)}
                      disabled={isPending}
                      className="ml-1 rounded border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteBooth(booth)}
                      disabled={isPending}
                      className="ml-1 rounded border border-red-300 px-2 py-0.5 text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                    {rowStatus[booth.id] === "saved" && <span className="ml-1 text-green-600">✓</span>}
                    {rowError[booth.id] && (
                      <p className="mt-1 text-red-600">{rowError[booth.id]}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add booth */}
        <div className="mt-4 rounded-md border border-gray-100 p-3">
          <p className="text-sm font-medium text-gray-900">Add Booth</p>
          <div className="mt-2 flex flex-wrap items-end gap-2 text-xs">
            <label className="flex flex-col gap-1">
              Booth #
              <input
                type="text"
                value={newBooth.boothNumber}
                onChange={(e) => setNewBooth((prev) => ({ ...prev, boothNumber: e.target.value }))}
                className="w-20 rounded border border-gray-300 px-1 py-1"
              />
            </label>
            <label className="flex flex-col gap-1">
              Package
              <select
                value={newBooth.boothProductId ?? ""}
                onChange={(e) =>
                  setNewBooth((prev) => ({ ...prev, boothProductId: e.target.value || null }))
                }
                className="rounded border border-gray-300 px-1 py-1"
              >
                <option value="">— Unassigned —</option>
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              X
              <input
                type="number"
                value={newBooth.mapCx}
                onChange={(e) => setNewBooth((prev) => ({ ...prev, mapCx: Number(e.target.value) }))}
                className="w-20 rounded border border-gray-300 px-1 py-1"
              />
            </label>
            <label className="flex flex-col gap-1">
              Y
              <input
                type="number"
                value={newBooth.mapCy}
                onChange={(e) => setNewBooth((prev) => ({ ...prev, mapCy: Number(e.target.value) }))}
                className="w-20 rounded border border-gray-300 px-1 py-1"
              />
            </label>
            <label className="flex flex-col gap-1">
              W
              <input
                type="number"
                value={newBooth.mapW}
                onChange={(e) => setNewBooth((prev) => ({ ...prev, mapW: Number(e.target.value) }))}
                className="w-16 rounded border border-gray-300 px-1 py-1"
              />
            </label>
            <label className="flex flex-col gap-1">
              H
              <input
                type="number"
                value={newBooth.mapH}
                onChange={(e) => setNewBooth((prev) => ({ ...prev, mapH: Number(e.target.value) }))}
                className="w-16 rounded border border-gray-300 px-1 py-1"
              />
            </label>
            <button
              type="button"
              onClick={handleAddBooth}
              disabled={isPending}
              className="rounded-md bg-[#EE2A2E] px-3 py-1.5 font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
            >
              Add Booth
            </button>
          </div>
          {addError && <p className="mt-2 text-red-600">{addError}</p>}
        </div>
      </div>

      {/* Footer links */}
      <div className="flex flex-wrap gap-3 text-xs">
        <a
          href={`/conference/${conferenceYear}/${editionCode}/booths`}
          target="_blank"
          rel="noreferrer"
          className="text-gray-500 underline hover:text-gray-700"
        >
          View public floor plan →
        </a>
        <a
          href={`/admin/conference/${conferenceId}/booths/approvals`}
          target="_blank"
          rel="noreferrer"
          className="text-gray-500 underline hover:text-gray-700"
        >
          Booth purchase approvals →
        </a>
      </div>
    </div>
  );
}
