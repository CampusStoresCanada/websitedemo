/**
 * Shared icon data for sponsor tier badges.
 *
 * Single source of truth for paths, logo zones, and stroke weights.
 * Both SponsorTierBadge (React SVG) and sponsorMarkerSvg (HTML string)
 * import from here so they are always pixel-identical at any size.
 */

import type { TierIcon } from "@/lib/sponsorship/types";

// ── Lucide paths (verbatim from lucide-react v0.577.0) ────────────

export const SHIELD_PATH =
  "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z";

export const AWARD_RIBBON =
  "m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526";

export const TROPHY_CUP  = "M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z";
export const TROPHY_LH   = "M6 9H4.5a1 1 0 0 1 0-5H6";
export const TROPHY_RH   = "M18 9h1.5a1 1 0 0 0 0-5H18";
export const TROPHY_LLEG = "M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978";
export const TROPHY_RLEG = "M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978";
export const TROPHY_BASE = "M4 22h16";

// ── Stroke weights (in 24px viewBox units) ────────────────────────
// Scale with the SVG element size automatically.

export const STROKE_WIDTH      = 1.5;
export const HALO_STROKE_WIDTH = 3;

// ── Logo zones (24px coordinate space) ───────────────────────────
// White backing circle + clipped logo/initials sit here.

export const LOGO_ZONES: Record<TierIcon, { cx: number; cy: number; r: number }> = {
  shield: { cx: 12, cy: 9,   r: 7   },
  award:  { cx: 12, cy: 8,   r: 5.8 },
  trophy: { cx: 12, cy: 5.5, r: 4.2 },
};
