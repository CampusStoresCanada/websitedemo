import type { BadgeSlotText } from "@/lib/conference/badges/template";

export type FittedTextLayout = {
  lines: string[];
  sizePt: number;
  trackingEm: number;
  lineHeightEm: number;
  overflowed: boolean;
};

const ABSOLUTE_MIN_FIT_PT = 1;

export function compactWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function designPxFromPt(pt: number, dpi: number): number {
  return (pt * dpi) / 72;
}

export function slotHeightDesignPx(
  slot: BadgeSlotText,
  dpi: number,
  options?: { maxLines?: number; lineHeightEm?: number; fallbackPt?: number }
): number {
  const lineHeightEm = options?.lineHeightEm ?? slot.lineHeight ?? 1.12;
  const maxLines = Math.max(1, options?.maxLines ?? slot.maxLines ?? 1);
  if (typeof slot.height === "number" && Number.isFinite(slot.height) && slot.height > 0) {
    return slot.height;
  }
  const fallbackPt = options?.fallbackPt ?? slot.defaultPt;
  return designPxFromPt(fallbackPt, dpi) * lineHeightEm * maxLines;
}

function estimateLineWidthDesignPx(
  text: string,
  pt: number,
  dpi: number,
  trackingEm: number
): number {
  const cleaned = compactWhitespace(text);
  if (!cleaned) return 0;
  const fontDesignPx = designPxFromPt(pt, dpi);
  // Conservative width model so fit decisions shrink earlier and avoid
  // real-render overflow with Gotham/Calibri in browser PDF output.
  const upperCount = (cleaned.match(/[A-Z]/g) ?? []).length;
  const digitCount = (cleaned.match(/[0-9]/g) ?? []).length;
  const spaceCount = (cleaned.match(/\s/g) ?? []).length;
  const otherCount = cleaned.length - upperCount - digitCount - spaceCount;

  const upperWidth = upperCount * fontDesignPx * 0.70;
  const digitWidth = digitCount * fontDesignPx * 0.61;
  const spaceWidth = spaceCount * fontDesignPx * 0.34;
  const otherWidth = otherCount * fontDesignPx * 0.58;
  const glyphWidth = upperWidth + digitWidth + spaceWidth + otherWidth;
  const trackingWidth = Math.max(0, cleaned.length - 1) * trackingEm * fontDesignPx;
  const safetyFactor = 1.08;
  return (glyphWidth + trackingWidth) * safetyFactor;
}

function lineCandidates(text: string, maxLines: number): string[][] {
  const clean = compactWhitespace(text);
  if (!clean) return [[""]];
  const words = clean.split(" ");
  const candidates: string[][] = [[clean]];
  if (maxLines <= 1) return candidates;

  if (words.length <= 1) {
    return candidates;
  }

  if (maxLines >= 2) {
    for (let i = 1; i < words.length; i += 1) {
      candidates.push([words.slice(0, i).join(" "), words.slice(i).join(" ")]);
    }
  }

  if (maxLines >= 3 && words.length >= 3) {
    for (let i = 1; i < words.length - 1; i += 1) {
      for (let j = i + 1; j < words.length; j += 1) {
        candidates.push([
          words.slice(0, i).join(" "),
          words.slice(i, j).join(" "),
          words.slice(j).join(" "),
        ]);
      }
    }
  }

  return candidates;
}

function bestEffortUnclippedLines(params: {
  text: string;
  lineCount: number;
  pt: number;
  dpi: number;
  trackingEm: number;
  maxWidthDesignPx: number;
}): { lines: string[]; overflowed: boolean } {
  const clean = compactWhitespace(params.text);
  if (!clean) return { lines: [""], overflowed: false };

  const candidates = lineCandidates(clean, params.lineCount).filter(
    (candidate) => candidate.length <= params.lineCount
  );
  const fallback = candidates[0] ?? [clean];

  let best = fallback;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const maxLineWidth = candidate.reduce(
      (maxWidth, line) =>
        Math.max(
          maxWidth,
          estimateLineWidthDesignPx(line, params.pt, params.dpi, params.trackingEm)
        ),
      0
    );
    if (maxLineWidth < bestScore) {
      bestScore = maxLineWidth;
      best = candidate;
    }
  }

  const overflowed = best.some(
    (line) =>
      estimateLineWidthDesignPx(line, params.pt, params.dpi, params.trackingEm) >
      params.maxWidthDesignPx
  );
  return { lines: best, overflowed };
}

export function fitTextLayout(
  text: string,
  slot: BadgeSlotText,
  dpi: number,
  options?: { maxLines?: number; lineHeightEm?: number }
): FittedTextLayout {
  const clean = compactWhitespace(text);
  const maxLines = Math.max(1, options?.maxLines ?? slot.maxLines ?? 1);
  const lineHeightEm = options?.lineHeightEm ?? slot.lineHeight ?? 1.12;
  const trackingMax = slot.trackingMaxEm ?? 0;
  const trackingMin = slot.trackingMinEm ?? -0.06;
  const trackingStep = slot.trackingStepEm ?? 0.005;
  const availableHeightDesignPx = slotHeightDesignPx(slot, dpi, {
    maxLines,
    lineHeightEm,
    fallbackPt: slot.defaultPt,
  });

  const sizeFloor = Math.min(slot.minPt, ABSOLUTE_MIN_FIT_PT);
  for (let size = slot.defaultPt; size >= sizeFloor; size -= 0.25) {
    const roundedSize = Number(size.toFixed(2));
    const lineHeightPx = designPxFromPt(size, dpi) * lineHeightEm;
    const maxByHeight = Math.max(1, Math.floor(availableHeightDesignPx / lineHeightPx));
    const allowedLines = Math.max(1, Math.min(maxLines, maxByHeight));
    const candidates = lineCandidates(clean, allowedLines);
    for (let tracking = trackingMax; tracking >= trackingMin; tracking -= trackingStep) {
      for (const candidate of candidates) {
        const fits = candidate.every(
          (line) => estimateLineWidthDesignPx(line, roundedSize, dpi, tracking) <= slot.width
        );
        if (fits) {
          return {
            lines: candidate,
            sizePt: roundedSize,
            trackingEm: Number(tracking.toFixed(3)),
            lineHeightEm,
            overflowed: false,
          };
        }
      }
    }
  }

  const minLineHeightPx = designPxFromPt(sizeFloor, dpi) * lineHeightEm;
  const maxByHeightAtMin = Math.max(1, Math.floor(availableHeightDesignPx / minLineHeightPx));
  const fallbackLineCount = Math.max(1, Math.min(maxLines, maxByHeightAtMin));
  const bestEffort = bestEffortUnclippedLines({
    text: clean,
    lineCount: fallbackLineCount,
    pt: sizeFloor,
    dpi,
    trackingEm: trackingMin,
    maxWidthDesignPx: slot.width,
  });
  return {
    lines: bestEffort.lines,
    sizePt: sizeFloor,
    trackingEm: trackingMin,
    lineHeightEm,
    overflowed: true,
  };
}
