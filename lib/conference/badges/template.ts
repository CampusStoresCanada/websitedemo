export type BadgeRole = "delegate" | "exhibitor";

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
  roles: Record<
    BadgeRole,
    {
      frontBackgroundUrl: string | null;
      backBackgroundUrl: string | null;
      frontOverlayUrl: string | null;
      accentColor: string;
      textColor: string;
      mapTintColor: string;
      mapTintOpacity: number;
      logoStyle: "icon";
    }
  >;
  roleLayouts?: Partial<
    Record<
      BadgeRole,
      {
        front: BadgeFrontConfig;
        back: BadgeBackConfig;
      }
    >
  >;
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

export type BadgeBackConfig = {
  qr: {
    x: number;
    y: number;
    size: number;
  };
  shapes: BadgeShapeLayer[];
  images: BadgeImageLayer[];
  textLayers: BadgeFreeTextLayer[];
};

export type BadgePersonRecord = {
  id: string;
  personKind: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  roleTitle: string | null;
  organizationName: string | null;
  logoUrl: string | null;
  qrPayload: string;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  province: string | null;
  organizationType: string | null;
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
  mapbox: {
    styleId: "mapbox/light-v11",
    defaultZoom: 11.5,
  },
  roles: {
    delegate: {
      frontBackgroundUrl: null,
      backBackgroundUrl: null,
      frontOverlayUrl: "/badges/delegate-front-overlay-v1.png",
      accentColor: "#e72a28",
      textColor: "#111111",
      mapTintColor: "#e72a28",
      mapTintOpacity: 0.14,
      logoStyle: "icon",
    },
    exhibitor: {
      frontBackgroundUrl: null,
      backBackgroundUrl: null,
      frontOverlayUrl: "/badges/exhibitor-front-overlay-v1.png",
      accentColor: "#16345a",
      textColor: "#111111",
      mapTintColor: "#16345a",
      mapTintOpacity: 0.16,
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
  const normalizeFontStack = (stack: string): string =>
    stack
      .replace(/\bGotham\b/gi, "\"gotham\"")
      .replace(/\bMuseo Slab\b/gi, "\"museo-slab\"");
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

  const sourceRoleLayouts =
    source.roleLayouts && typeof source.roleLayouts === "object"
      ? (source.roleLayouts as Partial<
          Record<BadgeRole, { front: BadgeFrontConfig; back: BadgeBackConfig }>
        >)
      : {};

  const normalizedRoleLayouts: Partial<
    Record<BadgeRole, { front: BadgeFrontConfig; back: BadgeBackConfig }>
  > = {
    delegate: {
      front:
        sourceRoleLayouts.delegate?.front && typeof sourceRoleLayouts.delegate.front === "object"
          ? deepClone({ ...normalizedFront, ...sourceRoleLayouts.delegate.front } as BadgeFrontConfig)
          : deepClone(normalizedFront),
      back:
        sourceRoleLayouts.delegate?.back && typeof sourceRoleLayouts.delegate.back === "object"
          ? deepClone({
              ...normalizedBack,
              ...sourceRoleLayouts.delegate.back,
              qr: {
                ...normalizedBack.qr,
                ...(sourceRoleLayouts.delegate.back?.qr ?? {}),
              },
            } as BadgeBackConfig)
          : deepClone(normalizedBack),
    },
    exhibitor: {
      front:
        sourceRoleLayouts.exhibitor?.front && typeof sourceRoleLayouts.exhibitor.front === "object"
          ? deepClone({ ...normalizedFront, ...sourceRoleLayouts.exhibitor.front } as BadgeFrontConfig)
          : deepClone(normalizedFront),
      back:
        sourceRoleLayouts.exhibitor?.back && typeof sourceRoleLayouts.exhibitor.back === "object"
          ? deepClone({
              ...normalizedBack,
              ...sourceRoleLayouts.exhibitor.back,
              qr: {
                ...normalizedBack.qr,
                ...(sourceRoleLayouts.exhibitor.back?.qr ?? {}),
              },
            } as BadgeBackConfig)
          : deepClone(normalizedBack),
    },
  };

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
    roles: {
      delegate: {
        ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.roles.delegate,
        ...(source.roles?.delegate ?? {}),
      },
      exhibitor: {
        ...DEFAULT_BADGE_TEMPLATE_CONFIG_V1.roles.exhibitor,
        ...(source.roles?.exhibitor ?? {}),
      },
    },
    roleLayouts: normalizedRoleLayouts,
    front: normalizedFront,
    back: normalizedBack,
  };
}

export function personRoleFromKind(kind: string): BadgeRole {
  return kind.toLowerCase() === "exhibitor" ? "exhibitor" : "delegate";
}
