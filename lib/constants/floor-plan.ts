import type { BoothStatus } from "@/lib/actions/conference-booths";

// Booth coordinates (map_cx/cy/w/h) are stored in this SVG viewBox space.
// Uploaded floor plan images should match this 16:9 (1920x1080) aspect ratio
// so booth overlay positions line up correctly.
export const FLOOR_PLAN_SVG_W = 1920;
export const FLOOR_PLAN_SVG_H = 1080;

export const DEFAULT_FLOOR_PLAN_URL = "/conference-floor-plan-2027.svg";

export const BOOTH_STATUS_COLORS: Record<BoothStatus, string> = {
  available: "rgba(34, 197, 94, 0.35)",
  sponsor_hold: "rgba(251, 146, 60, 0.55)",
  reserved: "rgba(234, 179, 8, 0.55)",
  sold: "rgba(239, 68, 68, 0.70)",
  waitlisted: "rgba(156, 163, 175, 0.55)",
};

export const BOOTH_STATUS_BORDER_COLORS: Record<BoothStatus, string> = {
  available: "#16a34a",
  sponsor_hold: "#ea580c",
  reserved: "#ca8a04",
  sold: "#dc2626",
  waitlisted: "#6b7280",
};

export const BOOTH_STATUS_LABELS: Record<BoothStatus, string> = {
  available: "Available",
  sponsor_hold: "Sponsor Hold",
  reserved: "Hold (20 min)",
  sold: "Sold",
  waitlisted: "Waitlisted",
};

export type BoothDayRole = "floor" | "meeting" | "move_in" | "move_out";

export const BOOTH_DAY_ROLE_LABELS: Record<BoothDayRole, string> = {
  floor: "Floor access",
  meeting: "Meeting space",
  move_in: "Move-in",
  move_out: "Move-out",
};

export type BoothPackage = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_cents: number;
  max_per_account: number | null;
  display_order: number;
  is_active: boolean;
  dayPattern: Record<string, BoothDayRole[]>;
};

type BoothPackageSourceProduct = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_cents: number;
  max_per_account: number | null;
  display_order: number;
  is_active: boolean;
  metadata: unknown;
};

/**
 * A "Booth Package" is any conference_product with booth_system + day_pattern
 * metadata. annual_partnership_bundle has booth_system but no day_pattern, so
 * it's correctly excluded.
 */
export function getBoothPackagesFromProducts(
  products: BoothPackageSourceProduct[]
): BoothPackage[] {
  return products
    .filter((p) => {
      const m = p.metadata as Record<string, unknown> | null;
      return (
        Boolean(m?.booth_system) &&
        typeof m?.day_pattern === "object" &&
        m?.day_pattern !== null
      );
    })
    .map((p) => {
      const m = p.metadata as Record<string, unknown>;
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        price_cents: p.price_cents,
        max_per_account: p.max_per_account,
        display_order: p.display_order,
        is_active: p.is_active,
        dayPattern: (m.day_pattern ?? {}) as Record<string, BoothDayRole[]>,
      };
    })
    .sort((a, b) => a.display_order - b.display_order);
}
