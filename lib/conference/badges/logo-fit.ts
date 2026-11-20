import sharp from "sharp";
import type { LogoContentBox } from "@/lib/conference/badges/template";

const FETCH_TIMEOUT_MS = 8000;
/** Long edge the logo is scanned at. Plenty to find an edge to within 0.4%. */
const SCAN_PX = 256;
/** How far a pixel's colour must be from the background to count as logo. */
const COLOUR_DISTANCE = 40;
/**
 * How many distinct tones it takes to cover 90% of a picture before it counts
 * as a photograph. Measured on CSC 2027's uploads: every logo needed 2 to 6,
 * the one real photo (a storefront) needed 17.
 */
const PHOTO_MIN_TONES = 10;

/**
 * Tones needed to cover 90% of the visible pixels, at 4 bits a channel.
 *
 * ⛔ What separates a photo from a logo cropped tight. Both run to every edge
 * of the file, so the content box cannot tell them apart, and treating a tight
 * wordmark as a photo fills the circle with it and cuts its lettering off:
 * "KPU", "Lakeland" and "Patrick King" all printed clipped. A logo is a few
 * flat colours; a photo is not.
 */
function toneCount(data: Buffer, pixels: number): number {
  const counts = new Map<number, number>();
  let visible = 0;
  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    if (data[i + 3] < 24) continue;
    visible += 1;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (visible === 0) return 0;
  let covered = 0;
  let tones = 0;
  for (const n of [...counts.values()].sort((x, y) => y - x)) {
    covered += n;
    tones += 1;
    if (covered >= visible * 0.9) break;
  }
  return tones;
}

/**
 * Measure where a logo's pixels actually are.
 *
 * ⛔ Not just its bounding box. A round crest and a square wordmark can have
 * the same box, and only the wordmark has anything in the corners. Sizing by
 * the box shrank every logo as if its corners were full. `reach` is the
 * farthest real pixel from the content's centre, so a logo is pulled in only
 * as far as it has to be to stay inside the circle.
 *
 * Null when it cannot be measured (unreachable, site-relative, undecodable);
 * the renderer then falls back to a box that can never clip. A failed
 * measurement must cost the logo some size, never the print run.
 */
export async function measureLogoContent(url: string): Promise<LogoContentBox | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const { data, info } = await sharp(buf)
      .ensureAlpha()
      .resize({ width: SCAN_PX, height: SCAN_PX, fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;
    if (!w || !h) return null;

    // The background is whatever the top-left corner is: transparent, white,
    // or the colour of a filled square.
    const bg = [data[0], data[1], data[2], data[3]];
    const bgTransparent = bg[3] < 24;
    const isContent = (i: number): boolean => {
      if (data[i + 3] < 24) return false;
      if (bgTransparent) return true;
      const dr = data[i] - bg[0];
      const dg = data[i + 1] - bg[1];
      const db = data[i + 2] - bg[2];
      return Math.sqrt(dr * dr + dg * dg + db * db) > COLOUR_DISTANCE;
    };

    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isContent((y * w + x) * 4)) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;

    const cx = (minX + maxX + 1) / 2;
    const cy = (minY + maxY + 1) / 2;
    let reach = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!isContent((y * w + x) * 4)) continue;
        // The pixel's far corner, so the edge pixel itself stays inside.
        const dx = Math.max(Math.abs(x - cx), Math.abs(x + 1 - cx));
        const dy = Math.max(Math.abs(y - cy), Math.abs(y + 1 - cy));
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > reach) reach = d;
      }
    }

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    // A photograph that runs to every edge is not a logo on a ground.
    // Shrinking a photo until its corners clear the circle leaves a postage
    // stamp; it fills the circle instead.
    // "Every edge" by the box, not the corners: a photo with rounded,
    // transparent corners is still a photo.
    // ⛔ Running to every edge is not enough on its own: see toneCount.
    const fullBleed = boxW >= w * 0.95 && boxH >= h * 0.95;
    const squareish = boxW / boxH > 0.8 && boxW / boxH < 1.25;
    const photographic = toneCount(data, w * h) >= PHOTO_MIN_TONES;

    return {
      left: minX / w,
      top: minY / h,
      width: boxW / w,
      height: boxH / h,
      aspect: boxW / boxH,
      imageAspect: w / h,
      reach: reach / w,
      photo: fullBleed && squareish && photographic,
    };
  } catch {
    return null;
  }
}

/**
 * Measure every distinct logo once. Exhibitor staff share their company's
 * logo, so per-badge measuring would fetch the same file N times.
 */
export async function measureLogos(urls: Iterable<string>): Promise<Map<string, LogoContentBox>> {
  const unique = [...new Set(urls)];
  const results = await Promise.all(unique.map((u) => measureLogoContent(u)));
  const out = new Map<string, LogoContentBox>();
  unique.forEach((u, i) => {
    const box = results[i];
    if (box) out.set(u, box);
  });
  return out;
}
