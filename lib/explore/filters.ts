/**
 * Shared filtering logic for the explore/lens system. Used by both
 * the map explore sidebar and the directory table view.
 */

import type { HomeMapOrg } from "@/lib/homepage";
import type { ExploreLens, ScaleRange, CompoundFilters } from "./types";
import { SCALE_RANGES } from "./types";

/** Build a one-line subtitle from whatever data we have on an org */
export function orgSubtitle(org: HomeMapOrg): string {
  const parts: string[] = [];
  if (org.enrollmentFte) {
    parts.push(`${org.enrollmentFte.toLocaleString()} FTE`);
  }
  if (org.city && org.province) {
    parts.push(`${org.city}, ${org.province}`);
  } else if (org.province) {
    parts.push(org.province);
  }
  if (org.primaryCategory) parts.push(org.primaryCategory);
  if (org.organizationType) parts.push(org.organizationType);
  return parts.join(" · ");
}

/** Check whether an enrollment figure falls within a scale range */
export function inScaleRange(fte: number | null | undefined, rangeKey: ScaleRange): boolean {
  if (fte == null) return false;
  const range = SCALE_RANGES.find((r) => r.key === rangeKey);
  if (!range) return false;
  return fte >= range.min && fte <= range.max;
}

/** Get the base pool of orgs for a given lens + sub-filter */
export function getPoolForLens(
  organizations: HomeMapOrg[],
  lens: ExploreLens,
  subFilters: {
    scaleFilter?: ScaleRange | null;
    posFilter?: string | null;
    serviceFilter?: string | null;
    mandateFilter?: string | null;
    partnerCategoryFilter?: string | null;
  } = {}
): HomeMapOrg[] {
  const members = organizations.filter((o) => o.type === "Member");
  const partners = organizations.filter((o) => o.type === "Vendor Partner");

  switch (lens) {
    case "members":
      return members;
    case "partners":
      return partners;
    case "partner_category":
      if (subFilters.partnerCategoryFilter) {
        return partners.filter((o) => o.primaryCategory === subFilters.partnerCategoryFilter);
      }
      return partners.filter((o) => !!o.primaryCategory);
    case "scale":
      if (subFilters.scaleFilter) {
        const range = SCALE_RANGES.find((r) => r.key === subFilters.scaleFilter)!;
        return members.filter(
          (o) => o.enrollmentFte != null && o.enrollmentFte >= range.min && o.enrollmentFte <= range.max
        );
      }
      return members.filter((o) => o.enrollmentFte != null);
    case "pos_platform":
      if (subFilters.posFilter) {
        return members.filter((o) => o.posSystem === subFilters.posFilter);
      }
      return members.filter((o) => o.posSystem != null);
    case "services":
      if (subFilters.serviceFilter) {
        return members.filter((o) => o.servicesOffered?.includes(subFilters.serviceFilter!));
      }
      return members.filter((o) => o.servicesOffered != null && o.servicesOffered.length > 0);
    case "operating_model":
      if (subFilters.mandateFilter) {
        return members.filter((o) => o.operationsMandate === subFilters.mandateFilter);
      }
      return members.filter((o) => o.operationsMandate != null);
    default:
      return [...organizations];
  }
}

/** Apply compound cross-lens filters on top of an already-filtered pool */
export function applyCompoundFilters(
  pool: HomeMapOrg[],
  filters: CompoundFilters,
  currentLens: ExploreLens
): HomeMapOrg[] {
  let result = pool;

  if (filters.province) {
    result = result.filter((o) => o.province === filters.province);
  }
  if (filters.pos && currentLens !== "pos_platform") {
    result = result.filter((o) => o.posSystem === filters.pos);
  }
  if (filters.service && currentLens !== "services") {
    result = result.filter((o) => o.servicesOffered?.includes(filters.service!));
  }
  if (filters.mandate && currentLens !== "operating_model") {
    result = result.filter((o) => o.operationsMandate === filters.mandate);
  }
  if (filters.scaleRange && currentLens !== "scale") {
    const range = SCALE_RANGES.find((r) => r.key === filters.scaleRange)!;
    result = result.filter(
      (o) => o.enrollmentFte != null && o.enrollmentFte >= range.min && o.enrollmentFte <= range.max
    );
  }
  if (filters.payment) {
    result = result.filter((o) => o.paymentOptions?.includes(filters.payment!));
  }
  if (filters.shopping) {
    result = result.filter((o) => o.shoppingServices?.includes(filters.shopping!));
  }

  return result;
}

/** Returns true if any compound filter is active */
export function hasActiveCompounds(filters: CompoundFilters): boolean {
  return Object.values(filters).some((v) => v != null && v !== "");
}

/** Count occurrences of each value for a given field, for populating filter dropdowns */
export function countByField(
  orgs: HomeMapOrg[],
  field: "posSystem" | "operationsMandate" | "province"
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const org of orgs) {
    const val = org[field];
    if (val && val !== "Out of Canada") {
      counts[val] = (counts[val] || 0) + 1;
    }
  }
  return counts;
}

/** Count how many orgs offer each service */
export function countServices(orgs: HomeMapOrg[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const org of orgs) {
    if (org.servicesOffered) {
      for (const svc of org.servicesOffered) {
        counts[svc] = (counts[svc] || 0) + 1;
      }
    }
  }
  return counts;
}

/** Compute aggregate summary stats for a group of orgs */
export function computeGroupSummary(
  orgs: HomeMapOrg[],
  lens: ExploreLens
): {
  count: number;
  provinceCount: number;
  avgEnrollment: number | null;
  topPos: string | null;
} {
  const provinceSet = new Set(orgs.map((o) => o.province).filter(Boolean));

  const withFte = orgs.filter((o) => o.enrollmentFte != null);
  const avgEnrollment =
    withFte.length > 0
      ? Math.round(withFte.reduce((acc, o) => acc + (o.enrollmentFte ?? 0), 0) / withFte.length)
      : null;

  // Most common POS (skip if already in POS lens)
  let topPos: string | null = null;
  if (lens !== "pos_platform") {
    const counts: Record<string, number> = {};
    for (const o of orgs) {
      if (o.posSystem) counts[o.posSystem] = (counts[o.posSystem] || 0) + 1;
    }
    const entries = Object.entries(counts).sort(([, a], [, b]) => b - a);
    topPos = entries[0] ? entries[0][0] : null;
  }

  return {
    count: orgs.length,
    provinceCount: provinceSet.size,
    avgEnrollment,
    topPos,
  };
}
