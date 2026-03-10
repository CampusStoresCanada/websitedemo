/**
 * Shared types for the explore/lens system used by both the map explore
 * sidebar (MapHero) and the directory table view.
 */

export type ExploreLens =
  | null
  | "members"
  | "partners"
  | "partner_category"
  | "scale"
  | "pos_platform"
  | "services"
  | "operating_model";

export type ScaleRange = "small" | "medium" | "large" | "xlarge";

export interface ScaleRangeDef {
  key: ScaleRange;
  label: string;
  description: string;
  min: number;
  max: number;
}

export const SCALE_RANGES: ScaleRangeDef[] = [
  { key: "small", label: "Under 5,000", description: "Smaller institutions", min: 0, max: 4999 },
  { key: "medium", label: "5,000 – 15,000", description: "Mid-size institutions", min: 5000, max: 14999 },
  { key: "large", label: "15,000 – 30,000", description: "Large institutions", min: 15000, max: 29999 },
  { key: "xlarge", label: "Over 30,000", description: "Major institutions", min: 30000, max: Infinity },
];

/** Cross-lens compound filter state — every field is AND-ed together */
export interface CompoundFilters {
  province?: string;
  scaleRange?: ScaleRange;
  pos?: string;
  service?: string;
  mandate?: string;
  payment?: string;
  shopping?: string;
}

/** Human-readable labels for each lens */
export const LENS_LABELS: Record<string, string> = {
  members: "Members",
  partners: "Partners",
  partner_category: "Partner Categories",
  scale: "By Scale",
  pos_platform: "Same Platform",
  services: "Services Offered",
  operating_model: "Operating Model",
};
