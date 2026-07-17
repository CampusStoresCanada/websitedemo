/**
 * One palette for the conference, keyed by entity kind, so a meal reads
 * differently from a meeting from a session at a glance — the "different types
 * get different colours" ask. Shared by the Schedule timeline AND the Build
 * catalog so the two pages speak the same colour language. Plain hex (not
 * Tailwind classes) so it works as inline style without JIT safelisting. The
 * engine never branches on kind; this is presentation only.
 */

export type KindColor = {
  /** Solid accent — left border / dot / badge. */
  accent: string;
  /** Tint background for the row/card. */
  bg: string;
  /** Border that reads on the tint. */
  border: string;
  /** Text colour that reads on the tint. */
  text: string;
};

const DEFAULT_COLOR: KindColor = {
  accent: "#6b7280",
  bg: "#f9fafb",
  border: "#e5e7eb",
  text: "#374151",
};

export const KIND_COLORS: Record<string, KindColor> = {
  // Schedule kinds
  session: { accent: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", text: "#1e3a8a" },
  meeting: { accent: "#dc2626", bg: "#fef2f2", border: "#fecaca", text: "#991b1b" },
  event: { accent: "#9333ea", bg: "#faf5ff", border: "#e9d5ff", text: "#6b21a8" },
  networking: { accent: "#0891b2", bg: "#ecfeff", border: "#a5f3fc", text: "#155e75" },
  meal: { accent: "#ea580c", bg: "#fff7ed", border: "#fed7aa", text: "#9a3412" },
  move_in: { accent: "#65a30d", bg: "#f7fee7", border: "#d9f99d", text: "#3f6212" },
  move_out: { accent: "#65a30d", bg: "#f7fee7", border: "#d9f99d", text: "#3f6212" },
  // Catalog kinds
  booth: { accent: "#0d9488", bg: "#f0fdfa", border: "#99f6e4", text: "#115e59" },
  suite: { accent: "#4f46e5", bg: "#eef2ff", border: "#c7d2fe", text: "#3730a3" },
  venue: { accent: "#db2777", bg: "#fdf2f8", border: "#fbcfe8", text: "#9d174d" },
  registration: { accent: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0", text: "#166534" },
  ticket: { accent: "#d97706", bg: "#fffbeb", border: "#fde68a", text: "#92400e" },
  audience: { accent: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe", text: "#5b21b6" },
  day: { accent: "#475569", bg: "#f8fafc", border: "#e2e8f0", text: "#1e293b" },
  policy: { accent: "#57534e", bg: "#fafaf9", border: "#e7e5e4", text: "#292524" },
  floorplan: { accent: "#c026d3", bg: "#fdf4ff", border: "#f5d0fe", text: "#86198f" },
  equipment: { accent: "#0284c7", bg: "#f0f9ff", border: "#bae6fd", text: "#075985" },
  item: DEFAULT_COLOR,
};

// Stable colours for kinds we didn't curate (coined-on-the-fly catalog kinds),
// so every kind gets a distinct, consistent accent instead of all-grey.
const FALLBACK_PALETTE: KindColor[] = [
  { accent: "#0d9488", bg: "#f0fdfa", border: "#99f6e4", text: "#115e59" },
  { accent: "#4f46e5", bg: "#eef2ff", border: "#c7d2fe", text: "#3730a3" },
  { accent: "#db2777", bg: "#fdf2f8", border: "#fbcfe8", text: "#9d174d" },
  { accent: "#c026d3", bg: "#fdf4ff", border: "#f5d0fe", text: "#86198f" },
  { accent: "#e11d48", bg: "#fff1f2", border: "#fecdd3", text: "#9f1239" },
  { accent: "#0284c7", bg: "#f0f9ff", border: "#bae6fd", text: "#075985" },
];

function hashKind(kind: string): number {
  let h = 0;
  for (let i = 0; i < kind.length; i += 1) h = (h * 31 + kind.charCodeAt(i)) >>> 0;
  return h;
}

export function colorForKind(kind: string): KindColor {
  return KIND_COLORS[kind] ?? FALLBACK_PALETTE[hashKind(kind) % FALLBACK_PALETTE.length];
}
