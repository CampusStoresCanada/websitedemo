"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setBoothLayout, type FloorPlanBooth } from "@/lib/actions/conference-entities";
import { uploadFloorPlanImage, removeFloorPlanImage } from "@/lib/actions/conference-floor-plan";

const VIEW_W = 1000;
const DEFAULT_VB_H = 600;
const DEFAULT_W = 0.08;
const MIN_FRAC = 0.005;

const STATUS_FILL: Record<FloorPlanBooth["status"], string> = {
  available: "#d1fae5",
  reserved:  "#fef3c7",
  sold:      "#e5e7eb",
  draft:     "#fffbeb",
};
const STATUS_STROKE: Record<FloorPlanBooth["status"], string> = {
  available: "#10b981",
  reserved:  "#f59e0b",
  sold:      "#9ca3af",
  draft:     "#d1d5db",
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fmt2  = (n: number) => Math.round(n * 10000) / 100; // fraction → % 2 dp

// ── drag state ──────────────────────────────────────────────────────────────
type Drag =
  | { mode: "move";
      ids: string[];
      offsets: Record<string, { x: number; y: number }>;
      moved: boolean;
      // last computed positions — written during move, read on pointer-up to avoid stale closure
      latest: Record<string, { x: number; y: number }> }
  | { mode: "resize"; id: string; ax: number; ay: number; rot: number;
      latest: { x: number; y: number; w: number; h: number } | null }
  | { mode: "rotate"; id: string; cuX: number; cuY: number;
      latest: number | null }
  | { mode: "pan";
      startClientX: number; startClientY: number;
      startPanX: number; startPanY: number;
      unitsPerPx: number };


export default function FloorPlanManager({
  conferenceId,
  floorPlanUrl,
  booths: initialBooths,
}: {
  conferenceId: string;
  floorPlanUrl: string | null;
  booths: FloorPlanBooth[];
}) {
  const router  = useRouter();
  const svgRef  = useRef<SVGSVGElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // True when a booth's pointerDown was handled — tells canvasPointerUp not to clear selection.
  const boothHandledRef = useRef(false);

  const [booths, setBooths]       = useState<FloorPlanBooth[]>(initialBooths);
  const [selectedIds, setIds]     = useState<Set<string>>(new Set());
  const [keyId, setKeyId]         = useState<string | null>(null); // anchor for alignment
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [vbH, setVbH]             = useState<number>(DEFAULT_VB_H);
  const [zoom, setZoom]           = useState(1);
  const [pan, setPan]             = useState({ x: 0, y: 0 });
  const [snap, setSnap]             = useState(true);
  const [gridSnap, setGridSnap]     = useState(false);
  const [gridSize, setGridSize]     = useState(2.5);   // % of canvas
  const [edgeSnap, setEdgeSnap]     = useState(true);
  const [gridCols, setGridCols]     = useState(4);
  const [gridGap, setGridGap]       = useState(1);     // % between booths
  const [showGrid, setShowGrid]     = useState(false);
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState<string | null>(null);

  // ── snap helpers ─────────────────────────────────────────────────────────────
  const snapFrac = gridSize / 100;
  const snapToGrid = (v: number) =>
    gridSnap ? Math.round(v / snapFrac) * snapFrac : v;

  // Snap x/y of a booth to nearby edges of other placed booths.
  const snapToEdges = (
    x: number, y: number, w: number, h: number, excludeIds: string[]
  ): { x: number; y: number } => {
    if (!edgeSnap) return { x, y };
    const thresh = 0.012; // ~1.2% of canvas
    let nx = x; let ny = y;
    let minDx = thresh; let minDy = thresh;
    for (const ob of placed) {
      if (excludeIds.includes(ob.id) || ob.x == null || ob.w == null) continue;
      const ox = ob.x; const ow = ob.w; const oy = ob.y ?? 0; const oh = ob.h ?? 0;
      // horizontal edges: left, right, centers
      for (const refX of [ox, ox + ow, ox + ow / 2]) {
        for (const myX of [x, x + w, x + w / 2]) {
          const d = Math.abs(myX - refX);
          if (d < minDx) { minDx = d; nx = x + (refX - myX); }
        }
      }
      // vertical edges
      for (const refY of [oy, oy + oh, oy + oh / 2]) {
        for (const myY of [y, y + h, y + h / 2]) {
          const d = Math.abs(myY - refY);
          if (d < minDy) { minDy = d; ny = y + (refY - myY); }
        }
      }
    }
    return { x: nx, y: ny };
  };

  // ── grid-place all unplaced booths ────────────────────────────────────────────
  const placeInGrid = () => {
    if (unplaced.length === 0) return;
    const cols    = Math.max(1, gridCols);
    const gapF    = gridGap / 100;
    const margin  = gapF;
    const rows    = Math.ceil(unplaced.length / cols);
    const cellW   = (1 - margin * (cols + 1)) / cols;
    const cellH   = (1 - margin * (rows + 1)) / rows;
    const boothW  = Math.max(MIN_FRAC, cellW * 0.85);
    // keep booths roughly square on-screen
    const boothH  = Math.max(MIN_FRAC, Math.min(cellH * 0.85, (boothW * VIEW_W) / vbH));
    const updates: Record<string, Partial<FloorPlanBooth>> = {};
    unplaced.forEach((b, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      updates[b.id] = {
        x: margin + col * (cellW + margin) + (cellW - boothW) / 2,
        y: margin + row * (cellH + margin) + (cellH - boothH) / 2,
        w: boothW,
        h: boothH,
        rotation: 0,
      };
    });
    patchMany(updates);
    unplaced.forEach(b => { if (updates[b.id]) persist({ ...b, ...updates[b.id] }); });
  };

  // ── AABB (axis-aligned bounding box) accounting for rotation ────────────────
  // Used by alignment so rotated booths align by their VISUAL edges, not stored x/y.
  const getAABB = (b: FloorPlanBooth) => {
    const cx = ((b.x ?? 0) + (b.w ?? 0) / 2);
    const cy = ((b.y ?? 0) + (b.h ?? 0) / 2);
    const rot = ((b.rotation ?? 0) * Math.PI) / 180;
    // Work in user units (VIEW_W × vbH) to account for aspect ratio, then convert back.
    const hwU = ((b.w ?? 0) / 2) * VIEW_W;
    const hhU = ((b.h ?? 0) / 2) * vbH;
    const cos = Math.abs(Math.cos(rot));
    const sin = Math.abs(Math.sin(rot));
    const aabbHw = (hwU * cos + hhU * sin) / VIEW_W;
    const aabbHh = (hwU * sin + hhU * cos) / vbH;
    return { left: cx - aabbHw, right: cx + aabbHw, top: cy - aabbHh, bottom: cy + aabbHh, cx, cy, aabbHw, aabbHh };
  };

  const [sortBy, setSortBy] = useState<"number" | "type" | "status" | "position">("number");

  const naturalSort = (a: FloorPlanBooth, b: FloorPlanBooth) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

  const applySort = (list: FloorPlanBooth[]): FloorPlanBooth[] => {
    if (sortBy === "type") {
      return [...list].sort((a, b) => {
        const ta = a.typeName ?? "￿"; // types with no parent sort last
        const tb = b.typeName ?? "￿";
        if (ta !== tb) return ta.localeCompare(tb, undefined, { numeric: true, sensitivity: "base" });
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      });
    }
    if (sortBy === "status") {
      const order = { available: 0, reserved: 1, sold: 2, draft: 3 };
      return [...list].sort((a, b) => {
        const so = (order[a.status] ?? 4) - (order[b.status] ?? 4);
        if (so !== 0) return so;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      });
    }
    if (sortBy === "position") {
      // Sort left-to-right by AABB centre X, then top-to-bottom.
      return [...list].sort((a, b) => {
        const aa = getAABB(a); const ab = getAABB(b);
        const dx = aa.cx - ab.cx;
        return Math.abs(dx) > 0.005 ? dx : aa.cy - ab.cy;
      });
    }
    return [...list].sort(naturalSort); // "number" default
  };

  const placed   = applySort(booths.filter(b => b.x != null && b.y != null && b.w != null && b.h != null));
  const unplaced = booths.filter(b => b.x == null || b.y == null || b.w == null || b.h == null).sort(naturalSort);
  const selArray = placed.filter(b => selectedIds.has(b.id));
  const keyed    = booths.find(b => b.id === keyId) ?? null;
  const solo     = selArray.length === 1 ? selArray[0] : null;

  // ── pointer → canvas coordinates ────────────────────────────────────────────
  const toUser = (cx: number, cy: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const toFrac = (u: { x: number; y: number }) => ({ x: u.x / VIEW_W, y: u.y / vbH });

  // ── persistence ──────────────────────────────────────────────────────────────
  const persist = (b: FloorPlanBooth) => {
    if (b.x == null || b.y == null || b.w == null || b.h == null) return;
    setBoothLayout(b.id, { x: b.x, y: b.y, w: b.w, h: b.h, rotation: b.rotation ?? 0, color: b.color ?? null, pitch: b.pitch ?? null })
      .then(r => { if (!r.success) setError(r.error); });
  };
  const patch = (id: string, next: Partial<FloorPlanBooth>) =>
    setBooths(prev => prev.map(b => b.id === id ? { ...b, ...next } : b));
  const patchMany = (updates: Record<string, Partial<FloorPlanBooth>>) =>
    setBooths(prev => prev.map(b => updates[b.id] ? { ...b, ...updates[b.id] } : b));

  // ── selection helpers ────────────────────────────────────────────────────────
  const selectOne = (id: string) => { setIds(new Set([id])); setKeyId(id); };
  const toggleSel = (id: string) => {
    setIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); if (keyId === id) setKeyId(null); }
      else { next.add(id); setKeyId(id); }
      return next;
    });
  };
  const clearSel  = () => { setIds(new Set()); setKeyId(null); };

  // ── placement ────────────────────────────────────────────────────────────────
  const onCanvasPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (d?.mode === "pan") { dragRef.current = null; return; }
    if (d) {
      dragRef.current = null;
      // Persist using `latest` from the drag ref — avoids the stale-closure bug
      // where `booths` state in this closure reflects the pre-drag position.
      if (d.mode === "move" && d.moved) {
        for (const id of d.ids) {
          const pos = d.latest[id];
          const b = booths.find(b => b.id === id);
          if (b && pos) persist({ ...b, x: pos.x, y: pos.y });
        }
      } else if (d.mode === "resize" && d.latest) {
        const b = booths.find(b => b.id === d.id);
        if (b) persist({ ...b, ...d.latest });
      } else if (d.mode === "rotate" && d.latest != null) {
        const b = booths.find(b => b.id === d.id);
        if (b) persist({ ...b, rotation: d.latest });
      }
      return;
    }
    // If a booth handled this pointer interaction, don't deselect.
    if (boothHandledRef.current) { boothHandledRef.current = false; return; }

    // Plain canvas click
    if (placingId) {
      const u = toUser(e.clientX, e.clientY);
      if (!u) return;
      const f  = toFrac(u);
      const wf = DEFAULT_W;
      const hf = clamp((DEFAULT_W * VIEW_W) / vbH, MIN_FRAC, 1);
      const x  = clamp(f.x - wf / 2, 0, 1 - wf);
      const y  = clamp(f.y - hf / 2, 0, 1 - hf);
      const next = { x, y, w: wf, h: hf, rotation: 0 };
      patch(placingId, next);
      const b = booths.find(b => b.id === placingId);
      if (b) persist({ ...b, ...next });
      selectOne(placingId);
      setPlacingId(null);
    } else {
      clearSel();
    }
  };

  // ── booth pointer-down: move or select ───────────────────────────────────────
  const onBoothPointerDown = (e: React.PointerEvent, b: FloorPlanBooth) => {
    e.stopPropagation();
    boothHandledRef.current = true; // prevent canvasPointerUp from clearing selection
    if (e.shiftKey) { toggleSel(b.id); return; }
    if (!selectedIds.has(b.id)) selectOne(b.id);
    // Start a multi-move drag covering all currently selected booths
    const u = toUser(e.clientX, e.clientY);
    if (!u || b.x == null || b.y == null) return;
    const gf = toFrac(u);
    const ids = [...selectedIds.has(b.id) ? selectedIds : new Set([b.id])];
    const offsets: Record<string, { x: number; y: number }> = {};
    for (const id of ids) {
      const bb = booths.find(bb => bb.id === id);
      if (bb && bb.x != null && bb.y != null) offsets[id] = { x: bb.x - gf.x, y: bb.y - gf.y };
    }
    dragRef.current = { mode: "move", ids, offsets, moved: false, latest: {} };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const startResize = (e: React.PointerEvent, b: FloorPlanBooth) => {
    e.stopPropagation();
    boothHandledRef.current = true;
    if (b.x == null || b.y == null || b.w == null || b.h == null) return;
    const rot = ((b.rotation ?? 0) * Math.PI) / 180;
    const cuX = (b.x + b.w / 2) * VIEW_W;
    const cuY = (b.y + b.h / 2) * vbH;
    const cos = Math.cos(rot); const sin = Math.sin(rot);
    const hw = (b.w * VIEW_W) / 2; const hh = (b.h * vbH) / 2;
    dragRef.current = {
      mode: "resize", id: b.id, rot,
      ax: cuX + (cos * -hw - sin * -hh),
      ay: cuY + (sin * -hw + cos * -hh),
      latest: null,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const startRotate = (e: React.PointerEvent, b: FloorPlanBooth) => {
    e.stopPropagation();
    boothHandledRef.current = true;
    if (b.x == null || b.y == null || b.w == null || b.h == null) return;
    dragRef.current = {
      mode: "rotate", id: b.id,
      cuX: (b.x + b.w / 2) * VIEW_W,
      cuY: (b.y + b.h / 2) * vbH,
      latest: null,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (placingId || dragRef.current) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      mode: "pan",
      startClientX: e.clientX, startClientY: e.clientY,
      startPanX: pan.x, startPanY: pan.y,
      unitsPerPx: VIEW_W / zoom / rect.width,
    };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === "pan") {
      setPan({
        x: d.startPanX - (e.clientX - d.startClientX) * d.unitsPerPx,
        y: d.startPanY - (e.clientY - d.startClientY) * d.unitsPerPx,
      });
      return;
    }
    const u = toUser(e.clientX, e.clientY);
    if (!u) return;

    if (d.mode === "move") {
      const f = toFrac(u);
      const updates: Record<string, Partial<FloorPlanBooth>> = {};
      // For snapping, use the key/first booth as the snap reference
      let snapDx = 0; let snapDy = 0; let snapApplied = false;
      for (const id of d.ids) {
        const b = booths.find(b => b.id === id);
        const off = d.offsets[id];
        if (!b || !off || b.w == null || b.h == null) continue;
        let rx = clamp(f.x + off.x, 0, 1 - b.w);
        let ry = clamp(f.y + off.y, 0, 1 - b.h);
        if (!snapApplied) {
          rx = snapToGrid(rx); ry = snapToGrid(ry);
          const snapped = snapToEdges(rx, ry, b.w, b.h, d.ids);
          snapDx = snapped.x - rx; snapDy = snapped.y - ry;
          rx = snapped.x; ry = snapped.y;
          snapApplied = true;
        } else {
          // apply same delta to all other selected so they move as a group
          rx = clamp(rx + snapDx, 0, 1 - b.w);
          ry = clamp(ry + snapDy, 0, 1 - b.h);
        }
        updates[id] = { x: rx, y: ry };
      }
      patchMany(updates);
      // store latest positions so pointer-up can persist without a stale closure
      const latestPos: Record<string, { x: number; y: number }> = {};
      for (const [id, u] of Object.entries(updates)) {
        latestPos[id] = { x: u.x as number, y: u.y as number };
      }
      dragRef.current = { ...d, moved: true, latest: latestPos };

    } else if (d.mode === "resize") {
      const dx = u.x - d.ax; const dy = u.y - d.ay;
      const cosN = Math.cos(-d.rot); const sinN = Math.sin(-d.rot);
      const localW = cosN * dx - sinN * dy;
      const localH = sinN * dx + cosN * dy;
      const wUser = Math.max(MIN_FRAC * VIEW_W, Math.abs(localW));
      const hUser = Math.max(MIN_FRAC * vbH,   Math.abs(localH));
      const cos = Math.cos(d.rot); const sin = Math.sin(d.rot);
      const halfX = (localW < 0 ? -1 : 1) * (wUser / 2);
      const halfY = (localH < 0 ? -1 : 1) * (hUser / 2);
      const ccx = d.ax + (cos * halfX - sin * halfY);
      const ccy = d.ay + (sin * halfX + cos * halfY);
      const wf = clamp(wUser / VIEW_W, MIN_FRAC, 1);
      const hf = clamp(hUser / vbH,   MIN_FRAC, 1);
      const rx2 = clamp(ccx / VIEW_W - wf / 2, 0, 1 - wf);
      const ry2 = clamp(ccy / vbH   - hf / 2, 0, 1 - hf);
      patch(d.id, { w: wf, h: hf, x: rx2, y: ry2 });
      dragRef.current = { ...d, latest: { x: rx2, y: ry2, w: wf, h: hf } };

    } else if (d.mode === "rotate") {
      let deg = (Math.atan2(u.y - d.cuY, u.x - d.cuX) * 180) / Math.PI + 90;
      deg = ((deg % 360) + 360) % 360;
      if (snap) deg = (Math.round(deg / 90) * 90) % 360;
      patch(d.id, { rotation: deg });
      dragRef.current = { ...d, latest: deg };
    }
  };

  // ── alignment operations ─────────────────────────────────────────────────────
  type AlignOp =
    | "left" | "right" | "top" | "bottom"
    | "centerH" | "centerV"
    | "distH" | "distV";

  // All alignment uses AABB edges so rotated booths align by their VISUAL boundaries.
  // Setting x/y back from AABB: new cx = target AABB edge ± booth.aabbHw, then x = cx - w/2.
  const align = (op: AlignOp) => {
    if (selArray.length < 2) return;
    const aabbs = new Map(selArray.map(b => [b.id, getAABB(b)]));
    const keyAABB = keyed ? aabbs.get(keyed.id) ?? getAABB(keyed) : null;
    const updates: Record<string, Partial<FloorPlanBooth>> = {};

    if (op === "left") {
      const ref = keyAABB?.left ?? Math.min(...selArray.map(b => aabbs.get(b.id)!.left));
      selArray.forEach(b => {
        const a = aabbs.get(b.id)!;
        updates[b.id] = { x: clamp(ref + a.aabbHw - (b.w ?? 0) / 2, 0, 1 - (b.w ?? 0)) };
      });
    } else if (op === "right") {
      const ref = keyAABB?.right ?? Math.max(...selArray.map(b => aabbs.get(b.id)!.right));
      selArray.forEach(b => {
        const a = aabbs.get(b.id)!;
        updates[b.id] = { x: clamp(ref - a.aabbHw - (b.w ?? 0) / 2, 0, 1 - (b.w ?? 0)) };
      });
    } else if (op === "top") {
      const ref = keyAABB?.top ?? Math.min(...selArray.map(b => aabbs.get(b.id)!.top));
      selArray.forEach(b => {
        const a = aabbs.get(b.id)!;
        updates[b.id] = { y: clamp(ref + a.aabbHh - (b.h ?? 0) / 2, 0, 1 - (b.h ?? 0)) };
      });
    } else if (op === "bottom") {
      const ref = keyAABB?.bottom ?? Math.max(...selArray.map(b => aabbs.get(b.id)!.bottom));
      selArray.forEach(b => {
        const a = aabbs.get(b.id)!;
        updates[b.id] = { y: clamp(ref - a.aabbHh - (b.h ?? 0) / 2, 0, 1 - (b.h ?? 0)) };
      });
    } else if (op === "centerH") {
      const ref = keyAABB ? keyAABB.cx
        : (Math.min(...selArray.map(b => aabbs.get(b.id)!.left)) + Math.max(...selArray.map(b => aabbs.get(b.id)!.right))) / 2;
      selArray.forEach(b => { updates[b.id] = { x: clamp(ref - (b.w ?? 0) / 2, 0, 1 - (b.w ?? 0)) }; });
    } else if (op === "centerV") {
      const ref = keyAABB ? keyAABB.cy
        : (Math.min(...selArray.map(b => aabbs.get(b.id)!.top)) + Math.max(...selArray.map(b => aabbs.get(b.id)!.bottom))) / 2;
      selArray.forEach(b => { updates[b.id] = { y: clamp(ref - (b.h ?? 0) / 2, 0, 1 - (b.h ?? 0)) }; });
    } else if (op === "distH") {
      const sorted = [...selArray].sort((a, b) => aabbs.get(a.id)!.cx - aabbs.get(b.id)!.cx);
      const lo = aabbs.get(sorted[0].id)!.left;
      const hi = aabbs.get(sorted[sorted.length - 1].id)!.right;
      const totalW = sorted.reduce((s, b) => s + aabbs.get(b.id)!.aabbHw * 2, 0);
      const gap = (hi - lo - totalW) / (sorted.length - 1);
      let cur = lo;
      for (const b of sorted) {
        const a = aabbs.get(b.id)!;
        updates[b.id] = { x: clamp(cur + a.aabbHw - (b.w ?? 0) / 2, 0, 1 - (b.w ?? 0)) };
        cur += a.aabbHw * 2 + gap;
      }
    } else if (op === "distV") {
      const sorted = [...selArray].sort((a, b) => aabbs.get(a.id)!.cy - aabbs.get(b.id)!.cy);
      const lo = aabbs.get(sorted[0].id)!.top;
      const hi = aabbs.get(sorted[sorted.length - 1].id)!.bottom;
      const totalH = sorted.reduce((s, b) => s + aabbs.get(b.id)!.aabbHh * 2, 0);
      const gap = (hi - lo - totalH) / (sorted.length - 1);
      let cur = lo;
      for (const b of sorted) {
        const a = aabbs.get(b.id)!;
        updates[b.id] = { y: clamp(cur + a.aabbHh - (b.h ?? 0) / 2, 0, 1 - (b.h ?? 0)) };
        cur += a.aabbHh * 2 + gap;
      }
    }

    patchMany(updates);
    booths.filter(b => updates[b.id]).forEach(b => persist({ ...b, ...updates[b.id] }));
  };

  // ── background upload / remove ───────────────────────────────────────────────
  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null); setBusy(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const res = await uploadFloorPlanImage({
        conferenceId, fileData: String(reader.result),
        fileName: file.name, contentType: file.type,
      });
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
      if (!res.success) { setError(res.error ?? "Upload failed."); return; }
      router.refresh();
    };
    reader.onerror = () => { setBusy(false); setError("Could not read that file."); };
    reader.readAsDataURL(file);
  };

  const onRemoveBackground = async () => {
    setError(null); setBusy(true);
    const res = await removeFloorPlanImage(conferenceId);
    setBusy(false);
    if (!res.success) { setError(res.error ?? "Could not remove the background."); return; }
    router.refresh();
  };

  // ── keyboard shortcuts ────────────────────────────────────────────────────────
  const nudge = (dx: number, dy: number) => {
    if (selectedIds.size === 0) return;
    const updates: Record<string, Partial<FloorPlanBooth>> = {};
    for (const b of selArray) {
      if (b.x == null || b.y == null || b.w == null || b.h == null) continue;
      updates[b.id] = {
        x: clamp(b.x + dx, 0, 1 - b.w),
        y: clamp(b.y + dy, 0, 1 - b.h),
      };
    }
    patchMany(updates);
    selArray.forEach(b => { if (updates[b.id]) persist({ ...b, ...updates[b.id] }); });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Don't steal keys from text inputs
    if ((e.target as HTMLElement).tagName === "INPUT") return;

    const step = e.shiftKey ? 0.02 : 0.005;
    if (e.key === "ArrowLeft")  { e.preventDefault(); nudge(-step, 0); }
    if (e.key === "ArrowRight") { e.preventDefault(); nudge( step, 0); }
    if (e.key === "ArrowUp")    { e.preventDefault(); nudge(0, -step); }
    if (e.key === "ArrowDown")  { e.preventDefault(); nudge(0,  step); }

    if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0) {
      e.preventDefault();
      const updates: Record<string, Partial<FloorPlanBooth>> = {};
      for (const b of selArray) {
        updates[b.id] = { x: null, y: null, w: null, h: null, rotation: null };
        persist({ ...b, x: null, y: null, w: null, h: null, rotation: null });
      }
      patchMany(updates);
      clearSel();
    }

    if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setIds(new Set(placed.map(b => b.id)));
      if (placed.length > 0) setKeyId(placed[placed.length - 1].id);
    }

    if (e.key === "Escape") { setPlacingId(null); clearSel(); }
  };

  const fit    = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const zoomBy = (factor: number) => {
    setZoom(z => {
      const nz = clamp(z * factor, 0.25, 8);
      setPan(p => ({ x: p.x + (VIEW_W / z - VIEW_W / nz) / 2, y: p.y + (vbH / z - vbH / nz) / 2 }));
      return nz;
    });
  };

  const viewBox = `${pan.x} ${pan.y} ${VIEW_W / zoom} ${vbH / zoom}`;

  // ── alignment button definitions ─────────────────────────────────────────────
  const alignBtns: Array<{ op: AlignOp; label: string; title: string }> = [
    { op: "left",    label: "⬛←", title: "Align left edges"     },
    { op: "centerH", label: "⬛│⬛", title: "Center horizontally" },
    { op: "right",   label: "→⬛", title: "Align right edges"    },
    { op: "top",     label: "⬛↑", title: "Align top edges"      },
    { op: "centerV", label: "⬛─⬛", title: "Center vertically"  },
    { op: "bottom",  label: "↓⬛", title: "Align bottom edges"   },
    { op: "distH",   label: "⟷", title: "Distribute horizontally" },
    { op: "distV",   label: "↕",  title: "Distribute vertically"   },
  ];

  return (
    <div className="space-y-4">
      {floorPlanUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={floorPlanUrl} alt="" className="hidden"
          onLoad={e => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0) setVbH((VIEW_W * img.naturalHeight) / img.naturalWidth);
          }}
        />
      ) : null}

      {/* toolbar */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Floor plan</h1>
          <p className="mt-1 text-sm text-gray-500">
            Click to select · Shift+click to multi-select · Drag to move · Corner = resize · Top handle = rotate
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden" onChange={onPickFile} />
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {busy ? "Working…" : floorPlanUrl ? "Replace background" : "Upload background"}
          </button>
          {floorPlanUrl ? (
            <button type="button" disabled={busy} onClick={onRemoveBackground}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {booths.length === 0 ? (
        <div className="rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-600">
          No booths yet. Add things of kind <span className="font-mono">booth</span> in the Catalog.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          {/* sidebar */}
          <aside className="space-y-3">

            {/* unplaced tray */}
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Unplaced ({unplaced.length})
              </h2>
              {unplaced.length === 0
                ? <p className="mt-2 text-xs text-gray-400">All booths placed.</p>
                : <ul className="mt-2 space-y-1">
                    {unplaced.map(b => (
                      <li key={b.id}>
                        <button type="button" onClick={() => setPlacingId(b.id)}
                          className={`w-full rounded border px-2 py-1 text-left text-sm ${
                            placingId === b.id
                              ? "border-[#EE2A2E] bg-[#fff1f1] text-[#EE2A2E]"
                              : "border-gray-200 text-gray-700 hover:border-gray-300"
                          }`}>
                          {b.number ? `${b.number} · ` : ""}{b.name}
                        </button>
                      </li>
                    ))}
                  </ul>
              }
              {placingId ? <p className="mt-2 text-[11px] text-[#EE2A2E]">Click the map to drop it. Esc to cancel.</p> : null}
              {/* grid-place panel */}
              {unplaced.length > 0 && !placingId ? (
                <div className="mt-3 border-t border-gray-100 pt-2 space-y-1.5">
                  <p className="text-[11px] font-medium text-gray-600">Place all in grid</p>
                  <div className="flex items-center gap-1.5">
                    <label className="text-[11px] text-gray-500 shrink-0">Cols</label>
                    <input type="number" min={1} max={20} value={gridCols}
                      onChange={e => setGridCols(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-14 rounded border border-gray-300 px-1 py-0.5 text-xs" />
                    <label className="text-[11px] text-gray-500 shrink-0">Gap %</label>
                    <input type="number" min={0} max={20} step={0.5} value={gridGap}
                      onChange={e => setGridGap(Math.max(0, parseFloat(e.target.value) || 0))}
                      className="w-14 rounded border border-gray-300 px-1 py-0.5 text-xs" />
                  </div>
                  <button type="button" onClick={placeInGrid}
                    className="w-full rounded border border-gray-300 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50">
                    Place {unplaced.length} booth{unplaced.length !== 1 ? "s" : ""} in grid
                  </button>
                </div>
              ) : null}
            </div>

            {/* placed list */}
            {placed.length > 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-center justify-between gap-1">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Placed ({placed.length})
                  </h2>
                  <div className="flex items-center gap-1.5">
                    <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
                      className="rounded border border-gray-200 px-1 py-0.5 text-[10px] text-gray-600">
                      <option value="number">By number</option>
                      <option value="type">By type</option>
                      <option value="status">By status</option>
                      <option value="position">By position</option>
                    </select>
                    {selectedIds.size > 0 ? (
                      <button type="button" onClick={clearSel}
                        className="text-[10px] text-gray-400 hover:text-gray-600">Clear</button>
                    ) : null}
                  </div>
                </div>
                <ul className="mt-2 space-y-1">
                  {placed.map(b => (
                    <li key={b.id}>
                      <button type="button"
                        onClick={e => e.shiftKey ? toggleSel(b.id) : selectOne(b.id)}
                        className={`w-full rounded border px-2 py-1 text-left text-sm ${
                          b.id === keyId
                            ? "border-[#EE2A2E] bg-[#fff1f1] text-[#EE2A2E]"
                            : selectedIds.has(b.id)
                              ? "border-[#EE2A2E]/40 bg-[#fff8f8] text-gray-700"
                              : "border-gray-200 text-gray-700 hover:border-gray-300"
                        }`}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          {b.color ? (
                            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-gray-300"
                              style={{ background: b.color }} />
                          ) : null}
                          <span className="truncate">{b.name}{b.id === keyId ? " ★" : ""}</span>
                          {b.typeName ? (
                            <span className="shrink-0 rounded bg-gray-100 px-1 py-0.5 text-[9px] text-gray-500">
                              {b.typeName}
                            </span>
                          ) : null}
                        </div>
                        {b.heldByOrg ? (
                          <span className={`block text-[10px] truncate ${
                            b.status === "sold" ? "text-gray-400" : "text-amber-600"
                          }`}>
                            {b.status === "sold" ? "sold → " : "in cart → "}{b.heldByOrg}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[10px] text-gray-400">Shift+click to multi-select. ★ = key item.</p>
              </div>
            ) : null}

            {/* alignment panel — only when 2+ selected */}
            {selArray.length >= 2 ? (
              <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs space-y-2">
                <h2 className="font-semibold text-gray-700">Align / Distribute</h2>
                {keyed ? (
                  <p className="text-[10px] text-gray-400">Reference: <strong>★ {keyed.number ?? keyed.name}</strong></p>
                ) : (
                  <p className="text-[10px] text-gray-400">Click ★ in the list to set a reference item.</p>
                )}
                <div className="grid grid-cols-4 gap-1">
                  {alignBtns.map(({ op, label, title }) => (
                    <button key={op} type="button" title={title}
                      onClick={() => align(op)}
                      className="rounded border border-gray-200 py-1 text-center text-xs hover:bg-gray-50 hover:border-gray-300">
                      {label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-400">
                  <span>← → = left/right edges</span>
                  <span>↑ ↓ = top/bottom edges</span>
                  <span>│ = center H</span>
                  <span>─ = center V</span>
                  <span>⟷ = distribute H</span>
                  <span>↕ = distribute V</span>
                </div>
              </div>
            ) : null}

            {/* colour picker — shows for any selection size, solo or multi */}
            {selArray.length >= 2 ? (
              <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs space-y-2">
                <h2 className="font-semibold text-gray-700">Colour</h2>
                <div className="flex flex-wrap gap-1">
                  {BOOTH_COLORS.map(({ label, value }) => (
                    <button key={label} type="button" title={label}
                      onClick={() => {
                        const updates: Record<string, Partial<FloorPlanBooth>> = {};
                        for (const b of selArray) updates[b.id] = { color: value };
                        patchMany(updates);
                        selArray.forEach(b => persist({ ...b, color: value }));
                      }}
                      className="h-6 w-6 rounded border-2 border-transparent hover:border-gray-400"
                      style={{ background: value ?? "#ffffff" }}>
                      {value === null ? (
                        <span className="flex h-full w-full items-center justify-center text-[8px] text-gray-400">✕</span>
                      ) : null}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400">Applies to all {selArray.length} selected booths.</p>
              </div>
            ) : null}

            {/* single-booth numerical controls */}
            {solo && solo.x != null ? (
              <NumericalPanel
                key={solo.id}
                booth={solo}
                selectionCount={selArray.length}
                onApply={next => { patch(solo.id, next); persist({ ...solo, ...next }); }}
                onApplyToAll={next => {
                  const updates: Record<string, Partial<FloorPlanBooth>> = {};
                  for (const b of selArray) {
                    if (b.id === solo.id) continue;
                    updates[b.id] = next;
                  }
                  patchMany(updates);
                  selArray
                    .filter(b => b.id !== solo.id)
                    .forEach(b => persist({ ...b, ...next }));
                }}
                onUnplace={() => {
                  patch(solo.id, { x: null, y: null, w: null, h: null, rotation: null });
                  persist({ ...solo, x: null, y: null, w: null, h: null, rotation: null });
                  clearSel();
                }}
              />
            ) : null}

            {/* zoom / snap */}
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600 space-y-2">
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => zoomBy(1.25)}
                  className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50">+</button>
                <button type="button" onClick={() => zoomBy(0.8)}
                  className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50">−</button>
                <button type="button" onClick={fit}
                  className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50">Fit</button>
                <span className="ml-1 text-gray-400">{Math.round(zoom * 100)}%</span>
              </div>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} />
                Snap rotation to 90°
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={edgeSnap} onChange={e => setEdgeSnap(e.target.checked)} />
                Snap to booth edges
              </label>
              <div className="flex items-center gap-1.5">
                <label className="flex items-center gap-1.5 shrink-0">
                  <input type="checkbox" checked={gridSnap} onChange={e => setGridSnap(e.target.checked)} />
                  Grid snap
                </label>
                {gridSnap ? (
                  <>
                    <input type="number" min={0.5} max={10} step={0.5} value={gridSize}
                      onChange={e => setGridSize(Math.max(0.5, parseFloat(e.target.value) || 2.5))}
                      className="w-14 rounded border border-gray-300 px-1 py-0.5 text-[11px]" />
                    <span className="text-[11px] text-gray-400">%</span>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />
                      <span className="text-[11px] text-gray-500">show</span>
                    </label>
                  </>
                ) : null}
              </div>
              <p className="text-[10px] text-gray-400">
                Drag to pan · + / − to zoom · Arrows to nudge (Shift = 4×) · Del to unplace · Ctrl+A = select all
              </p>
            </div>
          </aside>

          {/* canvas */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <svg
              ref={svgRef}
              viewBox={viewBox}
              className={`h-auto w-full touch-none select-none ${placingId ? "cursor-crosshair" : "cursor-default"}`}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onCanvasPointerUp}
              onKeyDown={onKeyDown}
              tabIndex={0}
              role="img"
              aria-label="Conference floor plan"
            >
              <rect x={0} y={0} width={VIEW_W} height={vbH} fill="white" />
              {floorPlanUrl
                ? <image href={floorPlanUrl} x={0} y={0} width={VIEW_W} height={vbH} preserveAspectRatio="none" />
                : Array.from({ length: Math.ceil(VIEW_W / 50) + 1 }).map((_, i) => (
                    <line key={`v${i}`} x1={i*50} y1={0} x2={i*50} y2={vbH} stroke="#eef2f7" strokeWidth={1} />
                  ))
              }
              {/* snap grid overlay */}
              {showGrid && gridSnap ? (() => {
                const gw = snapFrac * VIEW_W;
                const gh = snapFrac * vbH;
                const cols = Math.ceil(VIEW_W / gw);
                const rows = Math.ceil(vbH / gh);
                return (
                  <g opacity={0.25} pointerEvents="none">
                    {Array.from({ length: cols + 1 }).map((_, i) => (
                      <line key={`gv${i}`} x1={i*gw} y1={0} x2={i*gw} y2={vbH} stroke="#6366f1" strokeWidth={0.5/zoom} />
                    ))}
                    {Array.from({ length: rows + 1 }).map((_, i) => (
                      <line key={`gh${i}`} x1={0} y1={i*gh} x2={VIEW_W} y2={i*gh} stroke="#6366f1" strokeWidth={0.5/zoom} />
                    ))}
                  </g>
                );
              })() : null}

              {placed.map(b => {
                const x   = (b.x as number) * VIEW_W;
                const y   = (b.y as number) * vbH;
                const w   = (b.w as number) * VIEW_W;
                const h   = (b.h as number) * vbH;
                const cx  = x + w / 2;
                const cy  = y + h / 2;
                const rot = b.rotation ?? 0;
                const isSel = selectedIds.has(b.id);
                const isKey = b.id === keyId;
                // handle sizes constant on screen
                const hs   = 14 / zoom;
                const grab = 32 / zoom;
                const off  = 28 / zoom;
                const rr   = 7  / zoom;
                const sw   = Math.max(0.5, 2 / zoom);

                return (
                  <g key={b.id} transform={`rotate(${rot} ${cx} ${cy})`}>
                    {/* invisible hit-area for easy grab */}
                    <rect x={x - 4/zoom} y={y - 4/zoom}
                      width={w + 8/zoom} height={h + 8/zoom}
                      fill="transparent" style={{ cursor: "move" }}
                      onPointerDown={e => onBoothPointerDown(e, b)} />
                    <rect
                      x={x} y={y} width={w} height={h} rx={3}
                      fill={b.color ?? STATUS_FILL[b.status]}
                      stroke={isKey ? "#EE2A2E" : isSel ? "#EE2A2E" : STATUS_STROKE[b.status]}
                      strokeWidth={isSel ? sw * 2 : sw}
                      strokeDasharray={isSel && !isKey ? `${6/zoom} ${3/zoom}` : b.status === "draft" ? `${6/zoom} ${4/zoom}` : undefined}
                      pointerEvents="none" />
                    <text x={cx} y={b.heldByOrg ? cy - 5/zoom : cy} textAnchor="middle" dominantBaseline="central"
                      fontSize={Math.max(9, 12/zoom)} fill="#374151" pointerEvents="none"
                      fontFamily="gotham, Gotham, 'Arial Black', 'Helvetica Neue', Arial, sans-serif">
                      {b.number ? `${b.number}` : b.name.slice(0, 8)}{isKey ? " ★" : ""}
                    </text>
                    {b.heldByOrg ? (
                      <text x={cx} y={cy + 8/zoom} textAnchor="middle" dominantBaseline="central"
                        fontSize={Math.max(7, 9/zoom)}
                        fill={b.status === "sold" ? "#9ca3af" : "#f59e0b"}
                        pointerEvents="none"
                        fontFamily="gotham, Gotham, 'Arial Black', 'Helvetica Neue', Arial, sans-serif">
                        {b.heldByOrg.slice(0, 14)}
                      </text>
                    ) : null}

                    {/* handles — only on key or sole selection */}
                    {(isKey || (isSel && selectedIds.size === 1)) ? (
                      <>
                        <line x1={cx} y1={y} x2={cx} y2={y - off}
                          stroke="#EE2A2E" strokeWidth={sw} pointerEvents="none" />
                        <circle cx={cx} cy={y - off} r={grab / 2}
                          fill="transparent" style={{ cursor: "grab" }}
                          onPointerDown={e => startRotate(e, b)} />
                        <circle cx={cx} cy={y - off} r={rr}
                          fill="#fff" stroke="#EE2A2E" strokeWidth={sw} pointerEvents="none" />
                        <rect x={x + w - grab/2} y={y + h - grab/2}
                          width={grab} height={grab}
                          fill="transparent" style={{ cursor: "nwse-resize" }}
                          onPointerDown={e => startResize(e, b)} />
                        <rect x={x + w - hs/2} y={y + h - hs/2}
                          width={hs} height={hs} rx={2}
                          fill="#fff" stroke="#EE2A2E" strokeWidth={sw} pointerEvents="none" />
                      </>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

// ── NumericalPanel ────────────────────────────────────────────────────────────
// Keyed by booth id — remounts on selection change so inputs get fresh state
// without needing a setState-in-effect pattern.

// Preset colour swatches for booth categorisation.
const BOOTH_COLORS: Array<{ label: string; value: string | null }> = [
  { label: "Default",      value: null       },
  { label: "Sky",          value: "#bae6fd"  },
  { label: "Indigo",       value: "#c7d2fe"  },
  { label: "Purple",       value: "#e9d5ff"  },
  { label: "Pink",         value: "#fbcfe8"  },
  { label: "Red",          value: "#fecaca"  },
  { label: "Orange",       value: "#fed7aa"  },
  { label: "Yellow",       value: "#fef08a"  },
  { label: "Lime",         value: "#d9f99d"  },
  { label: "Green",        value: "#bbf7d0"  },
  { label: "Teal",         value: "#99f6e4"  },
  { label: "Slate",        value: "#cbd5e1"  },
];

function NumericalPanel({
  booth, selectionCount, onApply, onApplyToAll, onUnplace,
}: {
  booth: FloorPlanBooth;
  selectionCount: number;
  onApply: (next: Partial<FloorPlanBooth>) => void;
  onApplyToAll: (next: Partial<FloorPlanBooth>) => void;
  onUnplace: () => void;
}) {
  const [numW,   setNumW]   = useState(booth.w   != null ? String(fmt2(booth.w))   : "");
  const [numH,   setNumH]   = useState(booth.h   != null ? String(fmt2(booth.h))   : "");
  const [numRot, setNumRot] = useState(String(Math.round(booth.rotation ?? 0)));

  const apply = () => {
    const wPct = parseFloat(numW);
    const hPct = parseFloat(numH);
    const rot  = parseFloat(numRot);
    const next: Partial<FloorPlanBooth> = {};
    if (Number.isFinite(wPct) && wPct > 0) next.w = clamp(wPct / 100, MIN_FRAC, 1);
    if (Number.isFinite(hPct) && hPct > 0) next.h = clamp(hPct / 100, MIN_FRAC, 1);
    if (Number.isFinite(rot)) next.rotation = ((Math.round(rot) % 360) + 360) % 360;
    if (Object.keys(next).length) onApply(next);
  };

  const setColor = (color: string | null) => {
    onApply({ color });
  };

  const [pitch, setPitchText] = useState(booth.pitch ?? "");
  const applyPitch = () => onApply({ pitch: pitch.trim() || null });

  const inp = "rounded border border-gray-300 px-1.5 py-1 text-gray-900 focus:outline-none focus:ring-1 focus:ring-[#EE2A2E] w-full";

  return (
    <div className="rounded-lg border border-[#EE2A2E]/30 bg-white p-3 text-xs space-y-2">
      <h2 className="font-semibold text-gray-900 flex items-center gap-1">
        ★ {booth.number ? `${booth.number} · ` : ""}{booth.name}
      </h2>

      {/* size + rotation */}
      <div className="grid grid-cols-3 gap-1.5">
        <label className="flex flex-col gap-0.5 text-gray-500">
          W %
          <input type="number" step="0.1" min="0.1" value={numW}
            onChange={e => setNumW(e.target.value)}
            onBlur={apply} onKeyDown={e => e.key === "Enter" && apply()}
            className={inp} />
        </label>
        <label className="flex flex-col gap-0.5 text-gray-500">
          H %
          <input type="number" step="0.1" min="0.1" value={numH}
            onChange={e => setNumH(e.target.value)}
            onBlur={apply} onKeyDown={e => e.key === "Enter" && apply()}
            className={inp} />
        </label>
        <label className="flex flex-col gap-0.5 text-gray-500">
          Rot °
          <input type="number" step="1" min="0" max="359" value={numRot}
            onChange={e => setNumRot(e.target.value)}
            onBlur={apply} onKeyDown={e => e.key === "Enter" && apply()}
            className={inp} />
        </label>
      </div>
      <p className="text-gray-400 text-[10px]">% of map. Tab or Enter to apply.</p>

      {/* colour swatches */}
      <div>
        <p className="text-gray-500 mb-1">Colour</p>
        <div className="flex flex-wrap gap-1">
          {BOOTH_COLORS.map(({ label, value }) => {
            const active = (booth.color ?? null) === value;
            return (
              <button key={label} type="button" title={label}
                onClick={() => setColor(value)}
                className={`h-6 w-6 rounded border-2 ${active ? "border-gray-800" : "border-transparent hover:border-gray-400"}`}
                style={{ background: value ?? "#ffffff" }}>
                {value === null ? (
                  <span className="flex h-full w-full items-center justify-center text-[8px] text-gray-400 leading-none">✕</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* why this price? — short public-facing blurb, not an itemized list */}
      <div>
        <p className="text-gray-500 mb-1">Why this price? (shown on the public card)</p>
        <textarea
          value={pitch}
          onChange={e => setPitchText(e.target.value)}
          onBlur={applyPitch}
          rows={2}
          placeholder="e.g. Move in Monday early + exhibit all 3 show days"
          className={`${inp} resize-none`}
        />
      </div>

      {selectionCount > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <button type="button"
            onClick={() => {
              const wPct = parseFloat(numW);
              const hPct = parseFloat(numH);
              const next: Partial<FloorPlanBooth> = {};
              if (Number.isFinite(wPct) && wPct > 0) next.w = clamp(wPct / 100, MIN_FRAC, 1);
              if (Number.isFinite(hPct) && hPct > 0) next.h = clamp(hPct / 100, MIN_FRAC, 1);
              if (Object.keys(next).length) onApplyToAll(next);
            }}
            className="flex-1 rounded border border-gray-300 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50">
            Apply size to all
          </button>
          <button type="button"
            onClick={() => onApplyToAll({ color: booth.color ?? null })}
            className="flex-1 rounded border border-gray-300 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50">
            Apply colour to all
          </button>
          <button type="button"
            onClick={() => onApplyToAll({ pitch: pitch.trim() || null })}
            className="flex-1 rounded border border-gray-300 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50">
            Apply pitch to all
          </button>
        </div>
      ) : null}

      <button type="button" onClick={onUnplace}
        className="text-[11px] text-red-500 hover:underline">
        Remove from map (back to tray)
      </button>
    </div>
  );
}
