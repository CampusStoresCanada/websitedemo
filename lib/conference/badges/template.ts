import type { AccessSummary, AgendaItem } from "../entity-commerce";

/**
 * The key every badge layout hangs off: normally a `conference_entities.id` of
 * kind `registration`, i.e. an actual ticket type this conference sells.
 *
 * `DEFAULT_VARIANT` is the one reserved key — the look every type inherits
 * unless someone deliberately differentiates it. A conference nobody has
 * differentiated has exactly one variant and every badge matches.
 *
 * There is no `BadgeRole`. It was "delegate" | "exhibitor" and it existed only
 * to pick between two hardcoded designs; a badge builder that works for a home
 * show or an academic summit cannot have opinions about what a person "is".
 */
export const DEFAULT_VARIANT = "default";

export type BadgeSlotText = {
  x: number;
  baselineY: number;
  width: number;
  height?: number;
  defaultPt: number;
  minPt: number;
  maxLines?: number;
  allCaps?: boolean;
  family: "primary" | "secondary" | "slab";
  weight: number;
  lineHeight?: number;
  trackingMinEm?: number;
  trackingMaxEm?: number;
  trackingStepEm?: number;
};

export type BadgeShapeKind = "rect" | "circle" | "line";

export type BadgeShapeLayer = {
  id: string;
  kind: BadgeShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  fillColor: string | null;
  strokeWidth: number;
  opacity: number;
  rotationDeg?: number;
};

export type BadgeImageLayer = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  opacity: number;
  rotationDeg?: number;
  fit?: "contain" | "cover" | "fill";
};

export type BadgeFreeTextLayer = {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  sizePt: number;
  family: "primary" | "secondary" | "slab";
  weight: number;
  lineHeight?: number;
  opacity: number;
  rotationDeg?: number;
};

export type BadgeFrontLayerId =
  | "role_visuals"
  | "front_qr"
  | "logo"
  | "organizationLine1"
  | "organizationLine2"
  | "firstName"
  | "lastName"
  | "title"
  | `text:${string}`
  | `shape:${string}`
  | `image:${string}`;

export type BadgeLayerSettings = {
  visible: boolean;
  locked: boolean;
};

export type BadgeTextBindingKey =
  | "computed.org_line_1"
  | "computed.org_line_2"
  | "computed.first_name"
  | "computed.last_name"
  | "computed.role_title"
  | "person.display_name"
  | "person.first_name"
  | "person.last_name"
  | "person.role_title"
  | "person.organization_name"
  | "person.city"
  | "person.province";

export type BadgeLogoBindingKey = "person.logo_url" | "none" | "static_url";

/**
 * What a badge layout varies BY.
 *
 * Normally a `conference_entities.id` of kind `registration` — the actual
 * ticket types this conference sells. `"delegate"` and `"exhibitor"` are the
 * legacy keys from when the pipeline hardcoded two roles; they still resolve so
 * existing templates keep rendering, but new differentiation should key off the
 * registration type, because that is the thing that actually differs between a
 * one-day member pass and a four-day exhibitor.
 */
export type BadgeVariantKey = string;

export type BadgeVariantTheme = {
  frontBackgroundUrl: string | null;
  backBackgroundUrl: string | null;
  frontOverlayUrl: string | null;
  accentColor: string;
  textColor: string;
  mapTintColor: string;
  mapTintOpacity: number;
  logoStyle: "icon";
};

export type BadgeVariantLayout = {
  front: BadgeFrontConfig;
  back: BadgeBackConfig;
};

export type BadgeTemplateConfigV1 = {
  schema: "badge_template_config_v1";
  canvas: {
    widthIn: number;
    heightIn: number;
    bleedIn: number;
    dpi: number;
  };
  fonts: {
    primary: string;
    secondary: string;
    slab: string;
  };
  mapbox: {
    styleId: string;
    defaultZoom: number;
  };
  /**
   * Whose number to print as the onsite contact — a `contacts.id`, NOT a name
   * and number copied onto the card. The renderer reads that profile at print
   * time, so a coordinator who changes their number between now and the
   * conference changes what the badge says.
   */
  onsiteContactId: string | null;
  /**
   * Per-variant styling. Keyed by `BadgeVariantKey`, which is normally a
   * registration entity id — so a conference with "Vendor", "Public" and "VIP"
   * gets those three, and one with a single ticket type gets one. `delegate`
   * and `exhibitor` remain present as the legacy fallback keys.
   */
  variants: Record<string, BadgeVariantTheme> & { [DEFAULT_VARIANT]: BadgeVariantTheme };
  /**
   * Per-variant geometry.
   *
   * ⚠️ Normalisation ALWAYS materialises a `default` entry cloned from the base
   * `front`/`back`, so this is never empty and the base fields below are not
   * consulted at render time once a template has been normalised once. Editing
   * `config.front` without also writing `variantLayouts.default` is a silent
   * no-op on the printed badge. (An earlier version of this comment claimed an
   * untouched conference has no entries here — it does, and believing otherwise
   * is how a base-only edit disappears.)
   *
   * A registration type gets its own entry only when someone differentiates it;
   * everything else resolves to `default`. That is the "if they all look the
   * same, magic" case.
   */
  variantLayouts?: Partial<Record<BadgeVariantKey, BadgeVariantLayout>>;
  front: BadgeFrontConfig;
  back: BadgeBackConfig;
};

export type BadgeFrontConfig = {
    offsetX: number;
    offsetY: number;
    layerOrder: BadgeFrontLayerId[];
    layerSettings: Partial<Record<BadgeFrontLayerId, BadgeLayerSettings>>;
    bindings: {
      organizationLine1: BadgeTextBindingKey;
      organizationLine2: BadgeTextBindingKey;
      firstName: BadgeTextBindingKey;
      lastName: BadgeTextBindingKey;
      title: BadgeTextBindingKey;
      logo: BadgeLogoBindingKey;
    };
    shapes: BadgeShapeLayer[];
    images: BadgeImageLayer[];
    textLayers: BadgeFreeTextLayer[];
    qr: {
      x: number;
      y: number;
      size: number;
    };
    logo: {
      x: number;
      y: number;
      diameter: number;
      shape: "circle" | "square";
      staticUrl?: string | null;
    };
    organizationLine1: BadgeSlotText;
    organizationLine2: BadgeSlotText;
    firstName: BadgeSlotText;
    lastName: BadgeSlotText;
    title: BadgeSlotText;
};

/**
 * What a back-of-badge block renders. The operator places and labels the block;
 * its CONTENT is derived from the entity graph for the registration type this
 * badge is for, so a home show and an academic summit both get a correct back
 * without anyone authoring copy per conference.
 */
export type BadgeBackBlockSource =
  | "access_summary"
  | "agenda"
  | "qr_caption"
  | "venue";

export type BadgeBackBlock = {
  id: string;
  source: BadgeBackBlockSource;
  /** Operator-authored label above the derived content; null prints no heading. */
  heading: string | null;
  x: number;
  y: number;
  width: number;
  sizePt: number;
  family: "primary" | "secondary" | "slab";
  /** Derived content is unbounded; a printed card is not. Overflow is reported,
   *  never silently dropped — see renderBackBlock. */
  maxLines?: number;
  /**
   * Operator-authored text for the parts no graph can supply — the QR caption's
   * wording, or an onsite contact number to sit under the venue address. Blocks
   * whose content IS derived ignore it.
   */
  text?: string | null;
  /**
   * Stack this block with the other flow blocks instead of pinning it to `y`.
   *
   * Derived content varies per registration type — a day pass grants four items,
   * a full delegate twenty-seven — so fixed coordinates collide for one type or
   * waste half the card for another. Flow blocks share one column that starts at
   * the FIRST flow block's x/y/width and carries that block's `maxLines` as the
   * budget for the whole column.
   */
  flow?: boolean;
};

export type BadgeBackConfig = {
  qr: {
    x: number;
    y: number;
    size: number;
  };
  shapes: BadgeShapeLayer[];
  images: BadgeImageLayer[];
  textLayers: BadgeFreeTextLayer[];
  blocks: BadgeBackBlock[];
};

export type BadgePersonRecord = {
  id: string;
  /** The registration type this badge is for — a `conference_entities.id`, and
   *  the layout variant key. Null only for a record built outside a run. */
  variantKey: string | null;
  /** That type's own name, for display in operator surfaces. */
  variantName: string | null;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  roleTitle: string | null;
  organizationName: string | null;
  logoUrl: string | null;
  /** What the QR encodes — a scan URL carrying a revocable token. */
  qrPayload: string;
  /** The QR itself, pre-rendered as an inline SVG data URI. No network at print time. */
  qrImageDataUri: string | null;
  /**
   * The ORGANISATION's own page, and its QR.
   *
   * ⛔ A different destination from `qrPayload`, on purpose. The back carries
   * the person and is protected — a scan there needs a session and can trigger
   * a consent request. The front points at `/org/<slug>`, which is already
   * viewer-aware: `getViewerContext()` masks by ViewerLevel (public →
   * authenticated → partner → member → org_admin → …) and the page renders
   * MemberProfile or PartnerProfile by org type. So a passer-by sees the public
   * card and a signed-in viewer sees specials, pricing and catalogue — without
   * the badge deciding any of that. The physical placement IS the boundary.
   */
  organizationSlug: string | null;
  orgQrImageDataUri: string | null;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  province: string | null;
  organizationType: string | null;
  /** What this badge's registration type admits the holder to. Null when the
   *  record was built outside a run and no catalogue graph was available. */
  access: AccessSummary | null;
  /** That same entitlement as a timed, day-ordered list, for the printed back. */
  agenda: AgendaItem[];
};

export const DEFAULT_BADGE_TEMPLATE_CONFIG_V1: BadgeTemplateConfigV1 = {
  schema: "badge_template_config_v1",
  canvas: {
    widthIn: 3.25,
    heightIn: 5.25,
    bleedIn: 0.125,
    dpi: 300,
  },
  fonts: {
    primary: "\"gotham\", Calibri, Arial, sans-serif",
    secondary: "Calibri, Arial, sans-serif",
    slab: "\"museo-slab\", Georgia, serif",
  },
  onsiteContactId: null,
  mapbox: {
    styleId: "mapbox/light-v11",
    defaultZoom: 11.5,
  },
  variants: {
    [DEFAULT_VARIANT]: {
      frontBackgroundUrl: null,
      backBackgroundUrl: null,
      frontOverlayUrl: "/badges/delegate-front-overlay-v2.svg",
      accentColor: "#e72a28",
      textColor: "#111111",
      mapTintColor: "#e72a28",
      mapTintOpacity: 0.14,
      logoStyle: "icon",
    },
  },
  front: {
    offsetX: 0,
    offsetY: 0,
    layerOrder: [
      "role_visuals",
      "logo",
      "organizationLine1",
      "organizationLine2",
      "firstName",
      "lastName",
      "title",
    ],
    layerSettings: {},
    bindings: {
      organizationLine1: "computed.org_line_1",
      organizationLine2: "computed.org_line_2",
      firstName: "computed.first_name",
      lastName: "computed.last_name",
      title: "computed.role_title",
      logo: "person.logo_url",
    },
    shapes: [],
    images: [],
    textLayers: [],
    qr: {
      x: 705,
      y: 1210,
      size: 200,
    },
    logo: {
      x: 44,
      y: 48,
      diameter: 104,
      shape: "circle",
      staticUrl: null,
    },
    organizationLine1: {
      x: 166,
      baselineY: 90,
      width: 730,
      defaultPt: 20,
      minPt: 9,
      maxLines: 1,
      allCaps: true,
      family: "primary",
      weight: 700,
      trackingMinEm: -0.06,
      trackingMaxEm: 0,
      trackingStepEm: 0.005,
    },
    organizationLine2: {
      x: 166,
      baselineY: 164,
      width: 730,
      defaultPt: 20,
      minPt: 9,
      maxLines: 1,
      allCaps: true,
      family: "secondary",
      weight: 400,
      trackingMinEm: -0.06,
      trackingMaxEm: 0,
      trackingStepEm: 0.005,
    },
    firstName: {
      x: 44,
      baselineY: 555,
      width: 850,
      defaultPt: 64,
      minPt: 16,
      maxLines: 1,
      allCaps: true,
      family: "primary",
      weight: 700,
      trackingMinEm: -0.06,
      trackingMaxEm: 0,
      trackingStepEm: 0.005,
    },
    lastName: {
      x: 44,
      baselineY: 706,
      width: 850,
      defaultPt: 29,
      minPt: 12,
      maxLines: 2,
      family: "secondary",
      weight: 500,
      trackingMinEm: -0.06,
      trackingMaxEm: 0,
      trackingStepEm: 0.005,
    },
    title: {
      x: 44,
      baselineY: 815,
      width: 850,
      defaultPt: 14,
      minPt: 9,
      maxLines: 3,
      family: "secondary",
      weight: 600,
      lineHeight: 1.2,
      trackingMinEm: -0.06,
      trackingMaxEm: 0,
      trackingStepEm: 0.005,
    },
  },
  back: {
    qr: {
      x: 88,
      y: 1236,
      size: 216,
    },
    shapes: [],
    images: [],
    textLayers: [],
    // A badge back is where door and meal staff actually look. Every block
    // below is derived from this badge's registration type, so these defaults
    // stay correct for a conference that sells different things entirely.
    blocks: [
      {
        id: "back_agenda",
        source: "agenda",
        heading: "YOUR SCHEDULE",
        x: 75,
        y: 90,
        width: 825,
        sizePt: 5.9,
        family: "primary",
        flow: true,
        // Budget for the whole flow column, down to the QR.
        maxLines: 35,
      },
      {
        id: "back_qr_caption",
        source: "qr_caption",
        heading: null,
        x: 330,
        y: 1240,
        width: 570,
        sizePt: 7,
        family: "primary",
      },
      {
        id: "back_venue",
        source: "venue",
        heading: null,
        x: 330,
        y: 1360,
        width: 570,
        sizePt: 6.5,
        family: "primary",
      },
    ],
  },
};

export function normalizeBadgeTemplateConfig(
  value: unknown
): BadgeTemplateConfigV1 {
  if (!value || typeof value !== "object") return DEFAULT_BADGE_TEMPLATE_CONFIG_V1;
  const source = value as Partial<BadgeTemplateConfigV1>;
  if (source.schema !== "badge_template_config_v1") {
    return DEFAULT_BADGE_TEMPLATE_CONFIG_V1;
  }
  /**
   * Rewrite display font names to their loaded family, idempotently.
   *
   * ⛔ This was `.replace(/\bGotham\b/gi, '"gotham"')`. A double-quote is a
   * non-word character, so `\b` still matches INSIDE the replacement — every
   * pass wrapped the result again. Normalisation runs on every read, so the
   * stored value grew by two quotes each time: the live CSC 2027 templates
   * reached 1,956 characters of quote marks around a 34-character stack. The
   * emitted `--font-primary` was invalid CSS, so every badge silently rendered
   * in the Calibri/Arial fallback. `Museo Slab` never showed it because
   * `museo-slab` does not re-match `Museo Slab`.
   *
   * The lookarounds make it a no-op on an already-normalised stack.
   */
  const normalizeFontStack = (stack: string): string =>
    stack
      .replace(/(?<!")\bGotham\b(?!")/gi, '"gotham"')
      .replace(/(?<!")\bMuseo Slab\b(?!")/gi, '"museo-slab"');
  const deepClone = <T>(input: T): T => JSON.parse(JSON.stringify(input)) as T;

  const allowedLayerIds = new Set<string>([
    "role_visuals",
    "front_qr",
    "logo",
    "organizationLine1",
    "organizationLine2",
    "firstName",
    "lastName",
    "title",
  ]);

  const sourceLayerOrder = Array.isArray(source.front?.layerOrder)
    ? source.front?.layerOrder
    : [];
  const normalizedLayerOrderRaw = sourceLayerOrder
    .map((layer) => String(layer))
    .filter(
      (layer) =>
        allowedLayerIds.has(layer) ||
        layer.startsWith("shape:") ||
        layer.startsWith("image:") ||
        layer.startsWith("text:")
    ) as BadgeFrontLayerId[];

  const normalizedShapes = (Array.isArray(source.front?.shapes)
    ? source.front?.shapes
    : []
  )
    .filter((shape) => shape && typeof shape === "object")
    .map((shape, index) => {
      const candidate = shape as Partial<BadgeShapeLayer>;
      const kind: BadgeShapeKind =
        candidate.kind === "circle" || candidate.kind === "line"
          ? candidate.kind
          : "rect";
      const id = String(candidate.id ?? `shape_${index + 1}`);
      return {
        id,
        kind,
        x: Number(candidate.x ?? 0),
        y: Number(candidate.y ?? 0),
        width: Number(candidate.width ?? 100),
        height: Number(candidate.height ?? (kind === "line" ? 2 : 100)),
        strokeColor:
          typeof candidate.strokeColor === "string"
            ? candidate.strokeColor
            : "#111111",
        fillColor:
          candidate.fillColor === null
            ? null
            : typeof candidate.fillColor === "string"
              ? candidate.fillColor
              : kind === "line"
                ? null
                : "transparent",
        strokeWidth: Number(candidate.strokeWidth ?? 1),
        opacity: Number(candidate.opacity ?? 1),
        rotationDeg: Number(candidate.rotationDeg ?? 0),
      } satisfies BadgeShapeLayer;
    });

  const shapeLayerIds = normalizedShapes.map(
    (shape) => `shape:${shape.id}` as const
  );
  const normalizedImages = (Array.isArray(source.front?.images)
    ? source.front?.images
    : []
  )
    .filter((image) => image && typeof image === "object")
    .map((image, index) => {
      const candidate = image as Partial<BadgeImageLayer>;
      const id = String(candidate.id ?? `image_${index + 1}`);
      return {
        id,
        x: Number(candidate.x ?? 0),
        y: Number(candidate.y ?? 0),
        width: Number(candidate.width ?? 120),
        height: Number(candidate.height ?? 120),
        src: typeof candidate.src === "string" ? candidate.src : "",
        opacity: Number(candidate.opacity ?? 1),
        rotationDeg: Number(candidate.rotationDeg ?? 0),
        fit:
          candidate.fit === "cover" || candidate.fit === "fill"
            ? candidate.fit
            : "contain",
      } satisfies BadgeImageLayer;
    });
  const imageLayerIds = normalizedImages.map(
    (image) => `image:${image.id}` as const
  );
  const normalizedTextLayers = (Array.isArray(source.front?.textLayers)
    ? source.front.textLayers
    : []
  )
    .filter((text) => text && typeof text === "object")
    .map((text, index) => {
      const candidate = text as Partial<BadgeFreeTextLayer>;
      const id = String(candidate.id ?? `text_${index + 1}`);
      return {
        id,
        text: typeof candidate.text === "string" ? candidate.text : "Sample text",
        x: Number(candidate.x ?? 80),
        y: Number(candidate.y ?? 80),
        width: Number(candidate.width ?? 360),
        sizePt: Number(candidate.sizePt ?? 16),
        family:
          candidate.family === "secondary" || candidate.family === "slab"
            ? candidate.family
            : "primary",
        weight: Number(candidate.weight ?? 600),
        lineHeight: Number(candidate.lineHeight ?? 1.2),
        opacity: Number(candidate.opacity ?? 1),
        rotationDeg: Number(candidate.rotationDeg ?? 0),
      } satisfies BadgeFreeTextLayer;
    });
  const textLayerIds = normalizedTextLayers.map((text) => `text:${text.id}` as const);
  const dedupedLayerOrder = Array.from(
    new Set([
      ...normalizedLayerOrderRaw,
      ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front.layerOrder,
      ...shapeLayerIds,
      ...imageLayerIds,
      ...textLayerIds,
    ])
  ) as BadgeFrontLayerId[];

  const sourceLayerSettings =
    source.front?.layerSettings && typeof source.front.layerSettings === "object"
      ? source.front.layerSettings
      : {};
  const normalizedLayerSettings: Partial<Record<BadgeFrontLayerId, BadgeLayerSettings>> = {};
  for (const layerId of dedupedLayerOrder) {
    const raw = (sourceLayerSettings as Record<string, unknown>)[layerId];
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Partial<BadgeLayerSettings>;
    normalizedLayerSettings[layerId] = {
      visible: candidate.visible !== false,
      locked: candidate.locked === true,
    };
  }

  const rawBindings =
    source.front?.bindings && typeof source.front.bindings === "object"
      ? source.front.bindings
      : {};
  const defaultBindings = DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front.bindings;
  const normalizedBindings = {
    organizationLine1:
      (rawBindings as Record<string, unknown>).organizationLine1 as BadgeTextBindingKey ??
      defaultBindings.organizationLine1,
    organizationLine2:
      (rawBindings as Record<string, unknown>).organizationLine2 as BadgeTextBindingKey ??
      defaultBindings.organizationLine2,
    firstName:
      (rawBindings as Record<string, unknown>).firstName as BadgeTextBindingKey ??
      defaultBindings.firstName,
    lastName:
      (rawBindings as Record<string, unknown>).lastName as BadgeTextBindingKey ??
      defaultBindings.lastName,
    title:
      (rawBindings as Record<string, unknown>).title as BadgeTextBindingKey ??
      defaultBindings.title,
    logo:
      (rawBindings as Record<string, unknown>).logo as BadgeLogoBindingKey ??
      defaultBindings.logo,
  };

  const normalizedFront: BadgeFrontConfig = {
    ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front,
    ...(source.front ?? {}),
    layerOrder: dedupedLayerOrder,
    layerSettings: normalizedLayerSettings,
    bindings: normalizedBindings,
    shapes: normalizedShapes,
    images: normalizedImages,
    textLayers: normalizedTextLayers,
    qr: {
      ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front.qr,
      ...(source.front?.qr ?? {}),
    },
    logo: {
      ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front.logo,
      ...(source.front?.logo ?? {}),
      staticUrl:
        source.front?.logo?.staticUrl === undefined
          ? DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front.logo.staticUrl
          : source.front?.logo?.staticUrl,
    },
    organizationLine1: {
      ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front.organizationLine1,
      ...(source.front?.organizationLine1 ?? {}),
    },
    organizationLine2: {
      ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front.organizationLine2,
      ...(source.front?.organizationLine2 ?? {}),
    },
    firstName: {
      ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front.firstName,
      ...(source.front?.firstName ?? {}),
      maxLines: 1,
    },
    lastName: {
      ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front.lastName,
      ...(source.front?.lastName ?? {}),
    },
    title: {
      ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.front.title,
      ...(source.front?.title ?? {}),
    },
  };

  const normalizedBack: BadgeBackConfig = {
    ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.back,
    ...(source.back ?? {}),
    qr: {
      ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.back.qr,
      ...(source.back?.qr ?? {}),
    },
    // Configs stored before derived blocks existed carry no `blocks` key at all.
    // They inherit the defaults rather than rendering a blank back; an operator
    // who has deliberately emptied the array keeps their empty back.
    blocks: !Array.isArray(source.back?.blocks)
      ? DEFAULT_BADGE_TEMPLATE_CONFIG_V1.back.blocks
      : source.back.blocks
          .filter((block) => block && typeof block === "object")
          .map((block, index) => {
            const candidate = block as Partial<BadgeBackBlock>;
            const source_: BadgeBackBlockSource =
              candidate.source === "agenda" ||
              candidate.source === "qr_caption" ||
              candidate.source === "venue"
                ? candidate.source
                : "access_summary";
            const family =
              candidate.family === "primary" || candidate.family === "slab"
                ? candidate.family
                : "secondary";
            return {
              id: String(candidate.id ?? `back_block_${index + 1}`),
              source: source_,
              heading:
                typeof candidate.heading === "string" && candidate.heading.trim()
                  ? candidate.heading
                  : null,
              x: Number(candidate.x ?? 75),
              y: Number(candidate.y ?? 75),
              width: Number(candidate.width ?? 825),
              sizePt: Number(candidate.sizePt ?? 7),
              family,
              ...(Number.isFinite(Number(candidate.maxLines))
                ? { maxLines: Number(candidate.maxLines) }
                : {}),
              ...(typeof candidate.text === "string" && candidate.text.trim()
                ? { text: candidate.text }
                : {}),
              ...(candidate.flow === true ? { flow: true } : {}),
            };
          }),
    shapes: (Array.isArray(source.back?.shapes) ? source.back.shapes : [])
      .filter((shape) => shape && typeof shape === "object")
      .map((shape, index) => {
        const candidate = shape as Partial<BadgeShapeLayer>;
        const kind: BadgeShapeKind =
          candidate.kind === "circle" || candidate.kind === "line"
            ? candidate.kind
            : "rect";
        const id = String(candidate.id ?? `back_shape_${index + 1}`);
        return {
          id,
          kind,
          x: Number(candidate.x ?? 0),
          y: Number(candidate.y ?? 0),
          width: Number(candidate.width ?? 100),
          height: Number(candidate.height ?? (kind === "line" ? 2 : 100)),
          strokeColor:
            typeof candidate.strokeColor === "string"
              ? candidate.strokeColor
              : "#111111",
          fillColor:
            candidate.fillColor === null
              ? null
              : typeof candidate.fillColor === "string"
                ? candidate.fillColor
                : kind === "line"
                  ? null
                  : "transparent",
          strokeWidth: Number(candidate.strokeWidth ?? 1),
          opacity: Number(candidate.opacity ?? 1),
          rotationDeg: Number(candidate.rotationDeg ?? 0),
        } satisfies BadgeShapeLayer;
      }),
    images: (Array.isArray(source.back?.images) ? source.back.images : [])
      .filter((image) => image && typeof image === "object")
      .map((image, index) => {
        const candidate = image as Partial<BadgeImageLayer>;
        const id = String(candidate.id ?? `back_image_${index + 1}`);
        return {
          id,
          x: Number(candidate.x ?? 0),
          y: Number(candidate.y ?? 0),
          width: Number(candidate.width ?? 120),
          height: Number(candidate.height ?? 120),
          src: typeof candidate.src === "string" ? candidate.src : "",
          opacity: Number(candidate.opacity ?? 1),
          rotationDeg: Number(candidate.rotationDeg ?? 0),
          fit:
            candidate.fit === "cover" || candidate.fit === "fill"
              ? candidate.fit
              : "contain",
        } satisfies BadgeImageLayer;
      }),
    textLayers: (Array.isArray(source.back?.textLayers) ? source.back.textLayers : [])
      .filter((text) => text && typeof text === "object")
      .map((text, index) => {
        const candidate = text as Partial<BadgeFreeTextLayer>;
        const id = String(candidate.id ?? `back_text_${index + 1}`);
        return {
          id,
          text: typeof candidate.text === "string" ? candidate.text : "Sample text",
          x: Number(candidate.x ?? 80),
          y: Number(candidate.y ?? 80),
          width: Number(candidate.width ?? 360),
          sizePt: Number(candidate.sizePt ?? 16),
          family:
            candidate.family === "secondary" || candidate.family === "slab"
              ? candidate.family
              : "primary",
          weight: Number(candidate.weight ?? 600),
          lineHeight: Number(candidate.lineHeight ?? 1.2),
          opacity: Number(candidate.opacity ?? 1),
          rotationDeg: Number(candidate.rotationDeg ?? 0),
        } satisfies BadgeFreeTextLayer;
      }),
  };

  // Same rule as `variants` above — new shape wins outright, legacy is history.
  const legacyLayouts = (source as unknown as {
    roleLayouts?: Partial<Record<BadgeVariantKey, Partial<BadgeVariantLayout>>>;
  }).roleLayouts;
  const sourceRoleLayouts: Partial<Record<BadgeVariantKey, Partial<BadgeVariantLayout>>> =
    source.variantLayouts ?? legacyLayouts ?? {};

  /**
   * Merge one variant's overrides onto the base layout.
   *
   * A variant stores only what it changes; everything unstated falls through to
   * the base. That is what makes "all badges look the same" the default and
   * differentiation the deliberate act.
   */
  const layoutForVariant = (
    override: Partial<BadgeVariantLayout> | undefined
  ): BadgeVariantLayout => ({
    front:
      override?.front && typeof override.front === "object"
        ? deepClone({ ...normalizedFront, ...override.front } as BadgeFrontConfig)
        : deepClone(normalizedFront),
    back:
      override?.back && typeof override.back === "object"
        ? deepClone({
            ...normalizedBack,
            ...override.back,
            qr: { ...normalizedBack.qr, ...(override.back?.qr ?? {}) },
          } as BadgeBackConfig)
        : deepClone(normalizedBack),
  });

  // Every key the source carries survives normalisation. Previously this
  // rebuilt exactly `delegate` and `exhibitor` and silently DROPPED anything
  // else, so a layout keyed to a registration type could never round-trip
  // through a save. The two legacy keys stay guaranteed for back-compat.
  const normalizedRoleLayouts: Partial<Record<BadgeVariantKey, BadgeVariantLayout>> = {};
  for (const key of new Set<string>([DEFAULT_VARIANT, ...Object.keys(sourceRoleLayouts)])) {
    // `delegate` was the base look; it becomes the default variant's layout.
    const source_ = key === DEFAULT_VARIANT ? (sourceRoleLayouts[DEFAULT_VARIANT] ?? sourceRoleLayouts.delegate) : sourceRoleLayouts[key];
    normalizedRoleLayouts[key] = layoutForVariant(source_);
  }
  delete normalizedRoleLayouts.delegate;

  // Same for per-variant styling.
  // Legacy templates keyed their look off `roles.delegate` / `roles.exhibitor`.
  // `delegate` was the majority look, so it becomes the default everything
  // inherits; `exhibitor` is preserved as an ordinary named variant so its
  // design is not lost, and a data migration re-keys it onto the registration
  // types that actually require a booth.
  // ⛔ Legacy `roles` is ROLLBACK DATA, not merge input. Merging both left the
  // old `exhibitor` key alive as a fourth variant — it showed up in the editor
  // as a tab called "exhibitor" next to the real registration types, and its
  // theme could still be resolved. Once a template carries `variants`, the
  // legacy keys are history and are ignored.
  const legacy = (source as unknown as { roles?: Record<string, Partial<BadgeVariantTheme>> }).roles;
  const sourceVariants: Record<string, Partial<BadgeVariantTheme>> =
    (source.variants as Record<string, Partial<BadgeVariantTheme>> | undefined) ?? legacy ?? {};
  const base = DEFAULT_BADGE_TEMPLATE_CONFIG_V1.variants[DEFAULT_VARIANT];
  const normalizedVariants: Record<string, BadgeVariantTheme> = {
    [DEFAULT_VARIANT]: {
      ...base,
      ...(sourceVariants[DEFAULT_VARIANT] ?? sourceVariants.delegate ?? {}),
    },
  };
  for (const [key, value] of Object.entries(sourceVariants)) {
    if (key === DEFAULT_VARIANT || key === "delegate") continue;
    normalizedVariants[key] = { ...base, ...(value ?? {}) };
  }

  return {
    ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1,
    ...source,
    canvas: {
      ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.canvas,
      ...(source.canvas ?? {}),
    },
    fonts: {
      ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.fonts,
      ...(source.fonts ?? {}),
      primary: normalizeFontStack(
        source.fonts?.primary ?? DEFAULT_BADGE_TEMPLATE_CONFIG_V1.fonts.primary
      ),
      secondary: normalizeFontStack(
        source.fonts?.secondary ?? DEFAULT_BADGE_TEMPLATE_CONFIG_V1.fonts.secondary
      ),
      slab: normalizeFontStack(
        source.fonts?.slab ?? DEFAULT_BADGE_TEMPLATE_CONFIG_V1.fonts.slab
      ),
    },
    mapbox: {
      ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.mapbox,
      ...(source.mapbox ?? {}),
    },
    onsiteContactId:
      typeof source.onsiteContactId === "string" && source.onsiteContactId.trim()
        ? source.onsiteContactId.trim()
        : null,
    variants: normalizedVariants as BadgeTemplateConfigV1["variants"],
    variantLayouts: normalizedRoleLayouts,
    front: normalizedFront,
    back: normalizedBack,
  };
}


/**
 * Pick the layout and styling for one badge.
 *
 * Resolution order, most specific first:
 *   1. the person's registration type (a `conference_entities.id`)
 *   2. the legacy `delegate` / `exhibitor` key
 *   3. the template's base `front` / `back`
 *
 * This is the ONLY place a person is turned into a layout. Anything that needs
 * to know what a badge looks like calls this rather than reaching into
 * `roleLayouts` itself — otherwise the fallback order gets restated slightly
 * differently in each caller, which is how the print run and the preview start
 * disagreeing about the same badge.
 */
export function resolveBadgeVariant(
  template: BadgeTemplateConfigV1,
  params: { variantKey?: string | null }
): { front: BadgeFrontConfig; back: BadgeBackConfig; theme: BadgeVariantTheme; resolvedKey: string } {
  const layouts = template.variantLayouts ?? {};
  // ONE key decision for both maps. These used to be resolved separately —
  // `key` gated on variantLayouts, `theme` on variants — so a variant with a
  // colour but no layout (exactly what the setup wizard produces) reported
  // resolvedKey "default" while wearing its own theme, and the rendered badge
  // carried class="badge variant-default" in the wrong colour.
  const known = Boolean(
    params.variantKey && (layouts[params.variantKey] || template.variants[params.variantKey])
  );
  const key = known && params.variantKey ? params.variantKey : DEFAULT_VARIANT;
  const layout = layouts[key] ?? layouts[DEFAULT_VARIANT] ?? null;
  const theme = template.variants[key] ?? template.variants[DEFAULT_VARIANT];
  return {
    front: layout?.front ?? template.front,
    back: layout?.back ?? template.back,
    theme,
    resolvedKey: key,
  };
}
