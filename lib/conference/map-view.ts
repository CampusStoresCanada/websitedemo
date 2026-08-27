/**
 * The viewBox arithmetic behind panning and zooming the floor plan.
 *
 * Pure, so the parts that are easy to get wrong — clamping at the edges,
 * zooming about a point rather than the origin, framing a booth that sits in a
 * corner — are testable without a browser and a pair of thumbs.
 *
 * Everything is in viewBox units, not pixels. The component converts once, at
 * the boundary, using the rendered size.
 */

export type ViewBox = { x: number; y: number; w: number; h: number };

/** The whole floor, which is also the most zoomed-OUT state we allow. */
export function fitView(worldW: number, worldH: number): ViewBox {
  return { x: 0, y: 0, w: worldW, h: worldH };
}

/**
 * Deepest zoom, as a fraction of the world.
 *
 * 8× is enough to read a booth number on a phone without letting someone get
 * so far in that the surrounding booths — the reason they are looking at a map
 * rather than a list — leave the screen entirely.
 */
export const MAX_ZOOM = 8;

/**
 * Keep the view inside the world and within the zoom limits.
 *
 * Never lets the view be larger than the world: zooming out past the floor
 * plan leaves grey margins that look like a rendering fault, and there is
 * nothing out there to see.
 */
export function clampView(view: ViewBox, worldW: number, worldH: number): ViewBox {
  const minW = worldW / MAX_ZOOM;
  const w = Math.min(worldW, Math.max(minW, view.w));
  // Height follows width so the aspect ratio never distorts the plan.
  const h = w * (worldH / worldW);
  return {
    w,
    h,
    x: Math.min(Math.max(0, view.x), worldW - w),
    y: Math.min(Math.max(0, view.y), worldH - h),
  };
}

/**
 * Zoom by `factor` about a fixed point, in world units.
 *
 * The point under the cursor or between the fingers stays under it. Zooming
 * about the centre instead is the classic wrong version: the thing you were
 * pointing at slides away as you close in on it.
 */
export function zoomAt(
  view: ViewBox,
  factor: number,
  atX: number,
  atY: number,
  worldW: number,
  worldH: number
): ViewBox {
  const target = clampView({ ...view, w: view.w / factor, h: view.h / factor }, worldW, worldH);
  // Where the anchor sat proportionally, before and after.
  const fx = (atX - view.x) / view.w;
  const fy = (atY - view.y) / view.h;
  return clampView(
    { ...target, x: atX - fx * target.w, y: atY - fy * target.h },
    worldW,
    worldH
  );
}

/** Move the view by a world-unit delta. */
export function panBy(view: ViewBox, dx: number, dy: number, worldW: number, worldH: number): ViewBox {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, worldW, worldH);
}

/**
 * Frame a rectangle — a booth, or a company's several booths — with room
 * around it.
 *
 * `padding` is a multiple of the rectangle's size, so a small booth gets
 * plenty of context and a large one is not pushed off screen. Without the
 * surroundings this would just be a zoomed-in red box, which tells the reader
 * nothing about where to walk.
 */
export function frameRect(
  rect: { x: number; y: number; w: number; h: number },
  worldW: number,
  worldH: number,
  padding = 6
): ViewBox {
  const wanted = Math.max(rect.w, rect.h * (worldW / worldH)) * padding;
  const w = Math.min(worldW, Math.max(worldW / MAX_ZOOM, wanted));
  const h = w * (worldH / worldW);
  return clampView(
    { x: rect.x + rect.w / 2 - w / 2, y: rect.y + rect.h / 2 - h / 2, w, h },
    worldW,
    worldH
  );
}

/** The bounding box of several rectangles — a company holding two booths. */
export function boundsOf(
  rects: Array<{ x: number; y: number; w: number; h: number }>
): { x: number; y: number; w: number; h: number } | null {
  if (rects.length === 0) return null;
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** True when the view is showing the whole floor — i.e. Reset would do nothing. */
export function isFitted(view: ViewBox, worldW: number): boolean {
  return view.w >= worldW - 0.5;
}
