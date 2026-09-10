import { describe, expect, it } from "vitest";
import {
  DEFAULT_VARIANT,
  normalizeBadgeTemplateConfig,
  resolveBadgeVariant,
} from "../template";

/**
 * A badge builder for ANY conference.
 *
 * Layouts vary by REGISTRATION TYPE — whatever types a given conference sells.
 * There is no role: the pipeline has no opinion about what a person "is". One
 * default variant everyone inherits; a type gets its own only when someone
 * deliberately differentiates it.
 */

const ONE_DAY = "entity-one-day-member";
const FOUR_DAY = "entity-full-conference";

const cfg = (over: Record<string, unknown>) =>
  normalizeBadgeTemplateConfig({ schema: "badge_template_config_v1", ...over } as unknown);

describe("resolveBadgeVariant", () => {
  it("gives every type the same badge when nothing is differentiated", () => {
    const t = cfg({});
    const a = resolveBadgeVariant(t, { variantKey: ONE_DAY });
    const b = resolveBadgeVariant(t, { variantKey: FOUR_DAY });
    expect(a.front).toEqual(t.front);
    expect(b.front).toEqual(t.front);
    expect(a.resolvedKey).toBe(DEFAULT_VARIANT);
  });

  // The point of the exercise: a one-day pass can look different from a
  // four-day one, keyed to the registration type.
  it("uses a type's own layout when it has one", () => {
    const t = cfg({ variantLayouts: { [ONE_DAY]: { front: { offsetX: 2.2 } } } });
    expect(resolveBadgeVariant(t, { variantKey: ONE_DAY }).front.offsetX).toBe(2.2);
    expect(resolveBadgeVariant(t, { variantKey: ONE_DAY }).resolvedKey).toBe(ONE_DAY);
  });

  it("falls back to the default for a type nobody differentiated", () => {
    const t = cfg({
      variantLayouts: {
        [DEFAULT_VARIANT]: { front: { offsetX: 1.1 } },
        [ONE_DAY]: { front: { offsetX: 2.2 } },
      },
    });
    expect(resolveBadgeVariant(t, { variantKey: FOUR_DAY }).front.offsetX).toBe(1.1);
    expect(resolveBadgeVariant(t, { variantKey: null }).front.offsetX).toBe(1.1);
  });
});

describe("normalizeBadgeTemplateConfig", () => {
  it("round-trips a layout keyed to a registration type", () => {
    const once = cfg({ variantLayouts: { [ONE_DAY]: { front: { offsetX: 4.4 } } } });
    expect(once.variantLayouts?.[ONE_DAY]?.front.offsetX).toBe(4.4);
    const twice = normalizeBadgeTemplateConfig(once as unknown);
    expect(twice.variantLayouts?.[ONE_DAY]?.front.offsetX).toBe(4.4);
  });

  // ⛔ Deep idempotence, not one field. The previous version asserted a single
  // offsetX survived, which is why `normalizeFontStack` re-wrapping its own
  // output went unnoticed until live templates carried 1,956 characters of
  // quote marks and every badge silently rendered in the fallback typeface.
  // Normalising is a read-path operation; it must be a fixed point.
  it("is a fixed point — normalising twice changes nothing", () => {
    const once = cfg({
      fonts: { primary: "Gotham, Calibri, Arial, sans-serif", slab: "Museo Slab, Georgia, serif" },
      variantLayouts: { [ONE_DAY]: { front: { offsetX: 4.4 } } },
    });
    expect(normalizeBadgeTemplateConfig(once as unknown)).toEqual(once);
  });

  it("does not re-wrap an already-normalised font stack", () => {
    let f = cfg({ fonts: { primary: "Gotham, Calibri, Arial, sans-serif" } }).fonts.primary;
    expect(f).toBe('"gotham", Calibri, Arial, sans-serif');
    for (let i = 0; i < 5; i += 1) {
      f = cfg({ fonts: { primary: f } }).fonts.primary;
    }
    expect(f).toBe('"gotham", Calibri, Arial, sans-serif');
  });

  it("always produces a default variant", () => {
    expect(cfg({}).variants[DEFAULT_VARIANT]).toBeDefined();
  });

  // Legacy templates keyed off roles. `delegate` was the majority look, so it
  // becomes the default; `exhibitor` survives as a named variant so its design
  // is not lost while a migration re-keys it onto the types that need a booth.
  it("migrates a legacy role-keyed template without losing the exhibitor design", () => {
    const t = cfg({
      roles: {
        delegate: { accentColor: "#e72a28" },
        exhibitor: { accentColor: "#16345a" },
      },
      roleLayouts: {
        delegate: { front: { offsetX: 1 } },
        exhibitor: { front: { offsetX: 9 } },
      },
    });
    expect(t.variants[DEFAULT_VARIANT].accentColor).toBe("#e72a28");
    expect(t.variants.exhibitor?.accentColor).toBe("#16345a");
    expect(t.variantLayouts?.[DEFAULT_VARIANT]?.front.offsetX).toBe(1);
    expect(t.variantLayouts?.exhibitor?.front.offsetX).toBe(9);
    // `delegate` is not carried forward under its old name — it IS the default.
    expect(t.variantLayouts?.delegate).toBeUndefined();
  });
});
