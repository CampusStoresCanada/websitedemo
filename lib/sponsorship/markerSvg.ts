/**
 * sponsorMarkerSvg
 *
 * Generates an SVG string for Mapbox GL DOM markers (el.innerHTML = ...).
 * Renders the exact Lucide icon paths as strokes — same visual as the
 * Lucide React components — with a white backing circle for the org logo.
 */

import type { TierIcon } from "@/lib/sponsorship/types";
import {
  SHIELD_PATH,
  AWARD_RIBBON,
  TROPHY_CUP, TROPHY_LH, TROPHY_RH, TROPHY_LLEG, TROPHY_RLEG, TROPHY_BASE,
  LOGO_ZONES,
  STROKE_WIDTH,
  HALO_STROKE_WIDTH,
} from "@/lib/sponsorship/iconData";

const STROKE = `fill="none" stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"`;
const HALO   = `fill="none" stroke="white" stroke-width="${HALO_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"`;

// ── Shape body strings ────────────────────────────────────────────
// Each shape is rendered twice: white halo first, tier colour on top.

function shieldBody(color: string): string {
  return `
    <path d="${SHIELD_PATH}" ${HALO}/>
    <path d="${SHIELD_PATH}" stroke="${color}" ${STROKE}/>
  `;
}

function awardBody(color: string): string {
  return `
    <circle cx="12" cy="8" r="6" ${HALO}/>
    <path d="${AWARD_RIBBON}" ${HALO}/>
    <circle cx="12" cy="8" r="6" stroke="${color}" ${STROKE}/>
    <path d="${AWARD_RIBBON}" stroke="${color}" ${STROKE}/>
  `;
}

function trophyBody(color: string): string {
  return `
    <path d="${TROPHY_CUP}"  ${HALO}/>
    <path d="${TROPHY_LH}"   ${HALO}/>
    <path d="${TROPHY_RH}"   ${HALO}/>
    <path d="${TROPHY_LLEG}" ${HALO}/>
    <path d="${TROPHY_RLEG}" ${HALO}/>
    <path d="${TROPHY_BASE}" ${HALO}/>
    <path d="${TROPHY_CUP}"  stroke="${color}" ${STROKE}/>
    <path d="${TROPHY_LH}"   stroke="${color}" ${STROKE}/>
    <path d="${TROPHY_RH}"   stroke="${color}" ${STROKE}/>
    <path d="${TROPHY_LLEG}" stroke="${color}" ${STROKE}/>
    <path d="${TROPHY_RLEG}" stroke="${color}" ${STROKE}/>
    <path d="${TROPHY_BASE}" stroke="${color}" ${STROKE}/>
  `;
}

const BODIES: Record<TierIcon, (c: string) => string> = {
  shield: shieldBody,
  award:  awardBody,
  trophy: trophyBody,
};

// ── Public API ────────────────────────────────────────────────────

interface SponsorMarkerOptions {
  icon: TierIcon | null;
  color: string;
  logoUrl?: string | null;
  name?: string;
  /** Rendered px size. Default 40. */
  size?: number;
  /** Pass orgSlug to keep clipPath IDs unique across map markers. */
  uid: string;
}

export function sponsorMarkerSvg({
  icon,
  color,
  logoUrl,
  name,
  size = 40,
  uid,
}: SponsorMarkerOptions): string {
  const shapeKey: TierIcon = icon ?? "shield";
  const { cx, cy, r } = LOGO_ZONES[shapeKey];
  const maskId = `sm-${uid}-logo`;
  const initials = name ? name.charAt(0).toUpperCase() : "?";

  const logoEl = logoUrl
    ? `<image href="${logoUrl}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}"
         clip-path="url(#${maskId})" preserveAspectRatio="xMidYMid slice"/>`
    : `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
         font-size="${r.toFixed(1)}" font-weight="700" font-family="system-ui,sans-serif"
         fill="${color}" clip-path="url(#${maskId})">${initials}</text>`;

  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs><clipPath id="${maskId}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath></defs>
  ${BODIES[shapeKey](color)}
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="white"/>
  ${logoEl}
</svg>`;
}
