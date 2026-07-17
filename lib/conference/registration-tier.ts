export type RegistrationTier = {
  personKind: "delegate" | "exhibitor";
  tierLabel: string;
};

/**
 * What a person should show up as, derived from the catalog entity their seat
 * is tied to — not picked by hand. Prefers structured attributes (set via the
 * Build tab's generic attribute editor) and falls back to name matching
 * against the known catalog entities so it works before any backfill.
 */
export function deriveRegistrationTier(entity: {
  kind: string;
  name: string;
  attributes?: Record<string, unknown> | null;
}): RegistrationTier {
  const badgeRole = entity.attributes?.badge_role;
  const badgeTierLabel = entity.attributes?.badge_tier_label;
  if (
    (badgeRole === "delegate" || badgeRole === "exhibitor") &&
    typeof badgeTierLabel === "string" &&
    badgeTierLabel.length > 0
  ) {
    return { personKind: badgeRole, tierLabel: badgeTierLabel };
  }

  const name = entity.name.toLowerCase();
  if (name.includes("connected exhibitor")) {
    return { personKind: "exhibitor", tierLabel: "Connected Exhibitor" };
  }
  if (name.includes("exhibitor")) {
    return { personKind: "exhibitor", tierLabel: "Exhibitor" };
  }
  if (name.includes("day pass")) {
    return { personKind: "delegate", tierLabel: entity.name };
  }
  if (name.includes("full conference")) {
    return { personKind: "delegate", tierLabel: "Full Conference" };
  }

  return {
    personKind: entity.kind === "booth" ? "exhibitor" : "delegate",
    tierLabel: entity.name,
  };
}
