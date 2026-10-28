import sharp from "sharp";
import type { LogoContentBox } from "@/lib/conference/badges/template";

const FETCH_TIMEOUT_MS = 8000;

/**
 * Measure a logo's content box, trimming the uniform border around it.
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
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    const { info } = await sharp(buf).trim({ threshold: 12 }).toBuffer({ resolveWithObject: true });
    const left = -(info.trimOffsetLeft ?? 0);
    const top = -(info.trimOffsetTop ?? 0);
    return {
      left: left / meta.width,
      top: top / meta.height,
      width: info.width / meta.width,
      height: info.height / meta.height,
      aspect: info.width / info.height,
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
