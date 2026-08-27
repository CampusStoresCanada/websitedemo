import { describe, expect, it } from "vitest";
import {
  boundsOf, clampView, fitView, frameRect, isFitted, MAX_ZOOM, panBy, zoomAt,
} from "../map-view";

const W = 1000, H = 700;

describe("clamping", () => {
  it("never lets the view grow past the floor", () => {
    // Zooming out past the plan leaves grey margins that read as a bug.
    const v = clampView({ x: -50, y: -50, w: 4000, h: 2800 }, W, H);
    expect(v).toEqual({ x: 0, y: 0, w: W, h: H });
  });

  it("stops at the deepest zoom", () => {
    const v = clampView({ x: 0, y: 0, w: 1, h: 1 }, W, H);
    expect(v.w).toBeCloseTo(W / MAX_ZOOM);
  });

  it("keeps the view inside the world when panned to a corner", () => {
    const v = clampView({ x: 999, y: 699, w: 500, h: 350 }, W, H);
    expect(v.x).toBe(W - 500);
    expect(v.y).toBe(H - 350);
  });

  it("holds the aspect ratio so the plan never distorts", () => {
    const v = clampView({ x: 0, y: 0, w: 500, h: 999 }, W, H);
    expect(v.h / v.w).toBeCloseTo(H / W);
  });
});

describe("zooming about a point", () => {
  it("keeps the anchor under the finger", () => {
    // The classic wrong version zooms about the centre, and whatever you were
    // pointing at slides away as you close in on it.
    const start = fitView(W, H);
    const [ax, ay] = [750, 200];
    const zoomed = zoomAt(start, 2, ax, ay, W, H);
    const fxBefore = (ax - start.x) / start.w;
    const fxAfter = (ax - zoomed.x) / zoomed.w;
    expect(fxAfter).toBeCloseTo(fxBefore, 5);
  });

  it("halves the view when zooming in by two", () => {
    expect(zoomAt(fitView(W, H), 2, 500, 350, W, H).w).toBeCloseTo(W / 2);
  });

  it("cannot be zoomed out past the floor", () => {
    expect(zoomAt(fitView(W, H), 0.1, 500, 350, W, H)).toEqual(fitView(W, H));
  });
});

describe("panning", () => {
  it("moves by the delta given", () => {
    const v = panBy({ x: 100, y: 100, w: 500, h: 350 }, 50, -25, W, H);
    expect([v.x, v.y]).toEqual([150, 75]);
  });

  it("refuses to walk off the edge", () => {
    const v = panBy({ x: 0, y: 0, w: 500, h: 350 }, -100, -100, W, H);
    expect([v.x, v.y]).toEqual([0, 0]);
  });
});

describe("framing something the reader picked", () => {
  it("leaves context around a small booth", () => {
    // A zoomed-in red box with nothing around it does not tell anyone where to
    // walk — the neighbours are the orientation.
    const booth = { x: 400, y: 300, w: 20, h: 15 };
    const v = frameRect(booth, W, H);
    expect(v.w).toBeGreaterThan(booth.w * 4);
    expect(v.x).toBeLessThan(booth.x);
    expect(v.x + v.w).toBeGreaterThan(booth.x + booth.w);
  });

  it("frames a booth in the corner without leaving the floor", () => {
    const v = frameRect({ x: 980, y: 685, w: 20, h: 15 }, W, H);
    expect(v.x + v.w).toBeLessThanOrEqual(W + 0.001);
    expect(v.y + v.h).toBeLessThanOrEqual(H + 0.001);
  });

  it("frames both booths a company holds", () => {
    const bounds = boundsOf([
      { x: 100, y: 100, w: 20, h: 20 },
      { x: 300, y: 140, w: 20, h: 20 },
    ]);
    expect(bounds).toEqual({ x: 100, y: 100, w: 220, h: 60 });
    const v = frameRect(bounds!, W, H);
    expect(v.x).toBeLessThanOrEqual(100);
    expect(v.x + v.w).toBeGreaterThanOrEqual(320);
  });

  it("has no bounds for nothing", () => {
    expect(boundsOf([])).toBeNull();
  });
});

describe("knowing when reset is pointless", () => {
  it("is fitted at full extent and not when zoomed", () => {
    expect(isFitted(fitView(W, H), W)).toBe(true);
    expect(isFitted({ x: 0, y: 0, w: 500, h: 350 }, W)).toBe(false);
  });
});
