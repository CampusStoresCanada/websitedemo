import type { VisibilityConfig, MaskingRule } from "../policy/types";
import {
  DEFAULT_CROSS_VISIBILITY_RULES,
  DEFAULT_VISIBILITY_CONFIG,
  type CrossVisibilityRules,
  type ViewerLevel,
} from "./defaults";

export interface VisibilityRuntimeConfig extends VisibilityConfig {
  cross_visibility_rules: CrossVisibilityRules;
}

// ---------------------------------------------------------------------------
// Config loader with fallback
// ---------------------------------------------------------------------------

/**
 * Load visibility config from policy engine. Falls back to hardcoded
 * defaults if policy keys aren't seeded yet.
 */
export async function loadVisibilityConfig(): Promise<VisibilityRuntimeConfig> {
  try {
    const { getEffectivePolicy, getVisibilityConfig } = await import("../policy/engine");
    const base = await getVisibilityConfig();

    try {
      const cross = await getEffectivePolicy<CrossVisibilityRules>(
        "visibility.cross_visibility_rules"
      );
      return {
        ...base,
        cross_visibility_rules: {
          member_to_partner_fields: cross?.member_to_partner_fields ??
            DEFAULT_CROSS_VISIBILITY_RULES.member_to_partner_fields,
          partner_to_member_fields: cross?.partner_to_member_fields ??
            DEFAULT_CROSS_VISIBILITY_RULES.partner_to_member_fields,
        },
      };
    } catch {
      return {
        ...base,
        cross_visibility_rules: DEFAULT_CROSS_VISIBILITY_RULES,
      };
    }
  } catch {
    // Policy keys not seeded — use defaults
    return {
      ...DEFAULT_VISIBILITY_CONFIG,
      cross_visibility_rules: DEFAULT_CROSS_VISIBILITY_RULES,
    };
  }
}

// ---------------------------------------------------------------------------
// Field visibility check
// ---------------------------------------------------------------------------

function isVisibleByCrossRules(
  fieldPath: string,
  viewerLevel: ViewerLevel,
  targetOrgType: string | null,
  rules: CrossVisibilityRules
): boolean {
  if (!targetOrgType) return false;

  const isTargetMember = targetOrgType === "Member";
  const isTargetPartner = targetOrgType === "Vendor Partner";

  if (viewerLevel === "member" && isTargetPartner) {
    return rules.member_to_partner_fields.includes(fieldPath);
  }

  if (viewerLevel === "partner" && isTargetMember) {
    return rules.partner_to_member_fields.includes(fieldPath);
  }

  return false;
}

/**
 * Determine if a specific field is visible to a viewer.
 *
 * - admin/super_admin: always see everything
 * - org_admin: returns false here (caller must check isOwnOrg separately)
 * - public/member/partner: allowlist + explicit cross-rules only
 * - private list is always hidden unless admin/super_admin/own-org-admin
 * - Unlisted fields: hidden (fail-closed)
 */
export function isFieldVisible(
  fieldPath: string,
  viewerLevel: ViewerLevel,
  config: VisibilityRuntimeConfig,
  targetOrgType: string | null
): boolean {
  if (viewerLevel === "admin" || viewerLevel === "super_admin") return true;
  if (viewerLevel === "org_admin") return false;

  if (config.public_allowlist.includes(fieldPath)) return true;

  if (
    isVisibleByCrossRules(
      fieldPath,
      viewerLevel,
      targetOrgType,
      config.cross_visibility_rules
    )
  ) {
    return true;
  }

  if (config.private_fields.includes(fieldPath)) return false;

  return false;
}

/**
 * Check if an org_admin can see a field on a specific org.
 * org_admins see everything on their own org.
 */
export function canOrgAdminViewField(
  viewerOrgId: string | null,
  targetOrgId: string
): boolean {
  return viewerOrgId !== null && viewerOrgId === targetOrgId;
}

// ---------------------------------------------------------------------------
// Masking functions
// ---------------------------------------------------------------------------

/**
 * Apply masking rule to a raw value. Returns the masked string,
 * or null if no masking rule applies (field should be fully hidden).
 */
export function applyMasking(
  fieldPath: string,
  rawValue: unknown,
  config: VisibilityRuntimeConfig
): string | null {
  // Not in masked reveal list -> fully hidden
  if (!config.masked_reveal_fields.includes(fieldPath)) return null;

  const rule = config.masking_rules[fieldPath];
  if (!rule) return null;

  const strValue = typeof rawValue === "string" ? rawValue : String(rawValue ?? "");
  if (!strValue) return null;

  return applyMaskingRule(strValue, rule);
}

/**
 * Apply a specific masking rule to a string value.
 */
function applyMaskingRule(value: string, rule: MaskingRule): string {
  switch (rule.mode) {
    case "initials":
      return maskInitials(value);
    case "email_domain":
      return maskEmailDomain(value);
    case "phone_prefix":
      return maskPhonePrefix(value, rule.visible_digits ?? 6);
    case "truncate":
      return value.length > 3 ? value.slice(0, 3) + "..." : value;
    default:
      return "••••••";
  }
}

function maskInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.map((p) => p.charAt(0).toUpperCase() + ".").join(" ");
}

function maskEmailDomain(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return "••••••";
  return email.slice(atIndex);
}

/**
 * "403-555-1234" -> "403-555-••••"
 * Keeps first N digits (default 6), masks the rest.
 */
function maskPhonePrefix(phone: string, visibleDigits: number): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= visibleDigits) return phone;

  let digitsSeen = 0;
  let cutoffIndex = 0;

  for (let i = 0; i < phone.length; i += 1) {
    if (/\d/.test(phone[i])) {
      digitsSeen += 1;
      if (digitsSeen === visibleDigits) {
        cutoffIndex = i + 1;
        break;
      }
    }
  }

  const visiblePart = phone.slice(0, cutoffIndex);
  const remainingLength = digits.length - visibleDigits;
  return visiblePart + "-" + "•".repeat(remainingLength);
}

// ---------------------------------------------------------------------------
// Field mask application
// ---------------------------------------------------------------------------

/**
 * Apply visibility masks to a data object. Returns a shallow copy with:
 * - Visible fields: left intact
 * - Masked fields: replaced with masked teaser string
 * - Hidden fields: set to null
 */
export function applyFieldMask<T extends Record<string, unknown>>(
  data: T,
  viewerLevel: ViewerLevel,
  config: VisibilityRuntimeConfig,
  tablePrefix: string,
  isOwnOrg: boolean,
  targetOrgType: string | null
): Partial<T> {
  if (
    viewerLevel === "admin" ||
    viewerLevel === "super_admin" ||
    (viewerLevel === "org_admin" && isOwnOrg)
  ) {
    return { ...data };
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const fieldPath = `${tablePrefix}.${key}`;
    const visible = isFieldVisible(fieldPath, viewerLevel, config, targetOrgType);

    if (visible) {
      result[key] = value;
    } else {
      const masked = applyMasking(fieldPath, value, config);
      result[key] = masked;
    }
  }

  return result as Partial<T>;
}

// ---------------------------------------------------------------------------
// Field mask summary (for UI components)
// ---------------------------------------------------------------------------

/**
 * Get a summary of which fields are visible, masked, or hidden for a viewer level.
 */
export async function getVisibleFieldMask(
  viewerLevel: ViewerLevel,
  targetOrgType: string | null = null
): Promise<{ visible: string[]; masked: string[]; hidden: string[] }> {
  const config = await loadVisibilityConfig();

  const allFields = [
    ...new Set([
      ...config.public_allowlist,
      ...config.private_fields,
      ...config.masked_reveal_fields,
      ...config.cross_visibility_rules.member_to_partner_fields,
      ...config.cross_visibility_rules.partner_to_member_fields,
    ]),
  ];

  const visible: string[] = [];
  const masked: string[] = [];
  const hidden: string[] = [];

  for (const field of allFields) {
    if (isFieldVisible(field, viewerLevel, config, targetOrgType)) {
      visible.push(field);
    } else if (config.masked_reveal_fields.includes(field)) {
      masked.push(field);
    } else {
      hidden.push(field);
    }
  }

  return { visible, masked, hidden };
}
