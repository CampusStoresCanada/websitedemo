import {
  type BadgeFreeTextLayer,
  type BadgeImageLayer,
  type BadgeLogoBindingKey,
  type BadgePersonRecord,
  type BadgeShapeLayer,
  type BadgeRole,
  type BadgeSlotText,
  type BadgeTemplateConfigV1,
  type BadgeTextBindingKey,
  personRoleFromKind,
} from "@/lib/conference/badges/template";
import {
  compactWhitespace,
  designPxFromPt,
  fitTextLayout,
  slotHeightDesignPx,
  type FittedTextLayout,
} from "@/lib/conference/badges/text-fit";

type RenderBadgeOptions = {
  template: BadgeTemplateConfigV1;
  role: BadgeRole;
  person: BadgePersonRecord;
  side: "front" | "back";
};

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function mapboxStaticBackground(
  token: string | undefined,
  styleId: string,
  longitude: number | null,
  latitude: number | null,
  zoom: number,
  widthPx: number,
  heightPx: number
): string | null {
  if (!token) return null;
  const lng = longitude ?? -95;
  const lat = latitude ?? 56;
  const cleanedStyle = styleId.trim();
  const stylePath = cleanedStyle.startsWith("mapbox://styles/")
    ? cleanedStyle.replace("mapbox://styles/", "")
    : cleanedStyle
        .replace(/^https:\/\/api\.mapbox\.com\/styles\/v1\//, "")
        .replace(/\.html.*$/i, "")
        .replace(/\?.*$/, "");

  const maxSide = Math.max(widthPx, heightPx);
  const scale = maxSide > 1280 ? 1280 / maxSide : 1;
  const requestWidth = Math.max(320, Math.round(widthPx * scale));
  const requestHeight = Math.max(320, Math.round(heightPx * scale));

  return `https://api.mapbox.com/styles/v1/${stylePath}/static/${lng},${lat},${zoom},0/${requestWidth}x${requestHeight}?access_token=${encodeURIComponent(
    token
  )}`;
}

function generatedFallbackBackground(tintHex: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 976 1576'>
  <rect width='976' height='1576' fill='#faf7f7'/>
  <g opacity='0.12' fill='${tintHex}'>
    <circle cx='180' cy='280' r='140'/>
    <circle cx='760' cy='480' r='190'/>
    <circle cx='280' cy='980' r='170'/>
    <circle cx='700' cy='1220' r='150'/>
  </g>
  <g opacity='0.08' stroke='${tintHex}' stroke-width='10' fill='none'>
    <path d='M90 220 C230 120, 420 140, 560 230' />
    <path d='M240 880 C420 740, 640 760, 840 900' />
    <path d='M120 1340 C260 1220, 450 1240, 620 1360' />
  </g>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function splitDisplayName(person: BadgePersonRecord): {
  firstName: string;
  lastName: string;
} {
  if (person.firstName || person.lastName) {
    return {
      firstName: person.firstName?.trim() || "",
      lastName: person.lastName?.trim() || "",
    };
  }
  const display = person.displayName?.trim() || "";
  if (!display) return { firstName: "ATTENDEE", lastName: "" };
  const parts = display.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  // Treat last token as surname and keep all remaining tokens in the first-name block
  // so compound given names can wrap when needed.
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

function splitOrganizationSmart(orgName: string): { line1: string; line2: string } {
  const words = compactWhitespace(orgName).split(" ").filter(Boolean);
  if (words.length <= 1) return { line1: orgName, line2: "" };
  let bestIdx = 1;
  let bestMaxLen = Number.POSITIVE_INFINITY;
  for (let idx = 1; idx < words.length; idx += 1) {
    const l1 = words.slice(0, idx).join(" ");
    const l2 = words.slice(idx).join(" ");
    const maxLen = Math.max(l1.length, l2.length);
    if (maxLen < bestMaxLen) {
      bestMaxLen = maxLen;
      bestIdx = idx;
    }
  }
  return {
    line1: words.slice(0, bestIdx).join(" "),
    line2: words.slice(bestIdx).join(" "),
  };
}

function isFrontLayerVisible(front: BadgeTemplateConfigV1["front"], layerId: string): boolean {
  const settings = front.layerSettings?.[layerId as keyof typeof front.layerSettings];
  return settings?.visible !== false;
}

function resolveTextBindingValue(params: {
  binding: BadgeTextBindingKey;
  person: BadgePersonRecord;
  computed: {
    orgLine1: string;
    orgLine2: string;
    firstName: string;
    lastName: string;
    roleTitle: string;
  };
}): string {
  const { binding, person, computed } = params;
  switch (binding) {
    case "computed.org_line_1":
      return computed.orgLine1;
    case "computed.org_line_2":
      return computed.orgLine2;
    case "computed.first_name":
      return computed.firstName;
    case "computed.last_name":
      return computed.lastName;
    case "computed.role_title":
      return computed.roleTitle;
    case "person.display_name":
      return compactWhitespace(person.displayName || "");
    case "person.first_name":
      return compactWhitespace(person.firstName || "");
    case "person.last_name":
      return compactWhitespace(person.lastName || "");
    case "person.role_title":
      return compactWhitespace(person.roleTitle || "");
    case "person.organization_name":
      return compactWhitespace(person.organizationName || "");
    case "person.city":
      return compactWhitespace(person.city || "");
    case "person.province":
      return compactWhitespace(person.province || "");
    default:
      return "";
  }
}

function resolveLogoUrl(
  binding: BadgeLogoBindingKey,
  person: BadgePersonRecord,
  staticUrl: string | null | undefined
): string | null {
  if (binding === "none") return null;
  if (binding === "static_url") {
    const candidate = staticUrl?.trim() || "";
    return candidate.length > 0 ? candidate : null;
  }
  const personLogo = person.logoUrl?.trim() || "";
  return personLogo.length > 0 ? personLogo : null;
}

function renderTextBlock(params: {
  lines: string[];
  slot: BadgeSlotText;
  layout: FittedTextLayout;
  dpi: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}): string {
  const familyCss =
    params.slot.family === "primary"
      ? "var(--font-primary)"
      : params.slot.family === "secondary"
        ? "var(--font-secondary)"
        : "var(--font-slab)";

  const fontDesignPx = designPxFromPt(params.layout.sizePt, params.dpi);
  const fontPx = fontDesignPx * params.scaleX;
  const topDesignY = params.slot.baselineY - fontDesignPx * 0.8;
  const leftPx = (params.slot.x + params.offsetX) * params.scaleX;
  const topPx = (topDesignY + params.offsetY) * params.scaleY;
  const widthPx = params.slot.width * params.scaleX;
  const heightPx =
    slotHeightDesignPx(params.slot, params.dpi, {
      maxLines: params.lines.length,
      lineHeightEm: params.layout.lineHeightEm,
      fallbackPt: params.layout.sizePt,
    }) * params.scaleY;
  const linesHtml = params.lines
    .map(
      (line) =>
        `<div class="slot-text-line" style="font-size:${fontPx}px;letter-spacing:${params.layout.trackingEm}em;line-height:${params.layout.lineHeightEm};">${escapeHtml(
          line
        )}</div>`
    )
    .join("");
  return `<div class="slot-text" style="left:${leftPx}px;top:${topPx}px;width:${widthPx}px;height:${heightPx}px;font-family:${familyCss};font-weight:${params.slot.weight};">${linesHtml}</div>`;
}

function renderShapeLayer(params: {
  shape: BadgeShapeLayer;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}): string {
  const { shape, scaleX, scaleY, offsetX, offsetY } = params;
  const left = (shape.x + offsetX) * scaleX;
  const top = (shape.y + offsetY) * scaleY;
  const width = shape.width * scaleX;
  const height = shape.height * scaleY;
  const opacity = Number.isFinite(shape.opacity) ? shape.opacity : 1;
  const strokeWidth = Math.max(0, shape.strokeWidth * scaleX);
  const rotation = shape.rotationDeg ?? 0;

  if (shape.kind === "line") {
    return `<div class="shape-layer" style="left:${left}px;top:${top}px;width:${width}px;height:${Math.max(
      1,
      height
    )}px;opacity:${opacity};transform:rotate(${rotation}deg);transform-origin:top left;border-top:${strokeWidth}px solid ${escapeHtml(
      shape.strokeColor
    )};"></div>`;
  }

  const borderRadius =
    shape.kind === "circle"
      ? "9999px"
      : "0px";

  const fillCss = shape.fillColor ? `background:${escapeHtml(shape.fillColor)};` : "";
  return `<div class="shape-layer" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;opacity:${opacity};transform:rotate(${rotation}deg);transform-origin:top left;border:${strokeWidth}px solid ${escapeHtml(
    shape.strokeColor
  )};border-radius:${borderRadius};${fillCss}"></div>`;
}

function renderImageLayer(params: {
  image: BadgeImageLayer;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}): string {
  const { image, scaleX, scaleY, offsetX, offsetY } = params;
  if (!image.src || image.src.trim().length === 0) return "";
  const left = (image.x + offsetX) * scaleX;
  const top = (image.y + offsetY) * scaleY;
  const width = image.width * scaleX;
  const height = image.height * scaleY;
  const opacity = Number.isFinite(image.opacity) ? image.opacity : 1;
  const rotation = image.rotationDeg ?? 0;
  const fit = image.fit ?? "contain";
  const objectFit = fit === "fill" ? "fill" : fit === "cover" ? "cover" : "contain";
  return `<img class="image-layer" src="${escapeHtml(image.src)}" alt="" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;opacity:${opacity};transform:rotate(${rotation}deg);transform-origin:top left;object-fit:${objectFit};" />`;
}

function renderFreeTextLayer(params: {
  textLayer: BadgeFreeTextLayer;
  dpi: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}): string {
  const { textLayer, dpi, scaleX, scaleY, offsetX, offsetY } = params;
  const familyCss =
    textLayer.family === "primary"
      ? "var(--font-primary)"
      : textLayer.family === "secondary"
        ? "var(--font-secondary)"
        : "var(--font-slab)";
  const text = escapeHtml(textLayer.text ?? "");
  const left = (textLayer.x + offsetX) * scaleX;
  const top = (textLayer.y + offsetY) * scaleY;
  const width = textLayer.width * scaleX;
  const sizePx = designPxFromPt(textLayer.sizePt, dpi) * scaleX;
  const lineHeight = textLayer.lineHeight ?? 1.2;
  const opacity = Number.isFinite(textLayer.opacity) ? textLayer.opacity : 1;
  const rotation = textLayer.rotationDeg ?? 0;
  return `<div class="slot-text" style="left:${left}px;top:${top}px;width:${width}px;font-family:${familyCss};font-weight:${textLayer.weight};font-size:${sizePx}px;line-height:${lineHeight};opacity:${opacity};transform:rotate(${rotation}deg);transform-origin:top left;white-space:pre-wrap;">${text}</div>`;
}

function renderCropMarks(params: { pageWidthIn: number; pageHeightIn: number; bleedIn: number }): string {
  const { pageWidthIn, pageHeightIn, bleedIn } = params;
  const trimLeft = bleedIn;
  const trimTop = bleedIn;
  const trimRight = Math.max(trimLeft, pageWidthIn - bleedIn);
  const trimBottom = Math.max(trimTop, pageHeightIn - bleedIn);
  const markLen = Math.max(0.08, Math.min(0.18, bleedIn));
  const thicknessPt = 0.5;

  return `
    <div class="crop-mark crop-h" style="left:${trimLeft}in;top:${trimTop}in;width:${markLen}in;height:${thicknessPt}pt;"></div>
    <div class="crop-mark crop-v" style="left:${trimLeft}in;top:${trimTop}in;width:${thicknessPt}pt;height:${markLen}in;"></div>

    <div class="crop-mark crop-h" style="left:${trimRight - markLen}in;top:${trimTop}in;width:${markLen}in;height:${thicknessPt}pt;"></div>
    <div class="crop-mark crop-v" style="left:${trimRight}in;top:${trimTop}in;width:${thicknessPt}pt;height:${markLen}in;"></div>

    <div class="crop-mark crop-h" style="left:${trimLeft}in;top:${trimBottom}in;width:${markLen}in;height:${thicknessPt}pt;"></div>
    <div class="crop-mark crop-v" style="left:${trimLeft}in;top:${trimBottom - markLen}in;width:${thicknessPt}pt;height:${markLen}in;"></div>

    <div class="crop-mark crop-h" style="left:${trimRight - markLen}in;top:${trimBottom}in;width:${markLen}in;height:${thicknessPt}pt;"></div>
    <div class="crop-mark crop-v" style="left:${trimRight}in;top:${trimBottom - markLen}in;width:${thicknessPt}pt;height:${markLen}in;"></div>
  `;
}

export function renderBadgeHtml(options: RenderBadgeOptions): string {
  const { template, person, role, side } = options;
  const roleLayout = template.roleLayouts?.[role] ?? null;
  const front = roleLayout?.front ?? template.front;
  const back = roleLayout?.back ?? template.back;
  const roleTheme = template.roles[role];
  const { firstName, lastName } = splitDisplayName(person);
  const orgName = compactWhitespace(person.organizationName || "");
  const orgSplit = splitOrganizationSmart(orgName.toUpperCase());

  const computedFirst = front.firstName.allCaps ? firstName.toUpperCase() : firstName;
  const computedLast = front.lastName.allCaps ? lastName.toUpperCase() : lastName;
  const computedRoleText = compactWhitespace(person.roleTitle || "");
  const bindingValues = {
    organizationLine1: resolveTextBindingValue({
      binding: front.bindings.organizationLine1,
      person,
      computed: {
        orgLine1: orgSplit.line1,
        orgLine2: orgSplit.line2,
        firstName: computedFirst,
        lastName: computedLast,
        roleTitle: computedRoleText,
      },
    }),
    organizationLine2: resolveTextBindingValue({
      binding: front.bindings.organizationLine2,
      person,
      computed: {
        orgLine1: orgSplit.line1,
        orgLine2: orgSplit.line2,
        firstName: computedFirst,
        lastName: computedLast,
        roleTitle: computedRoleText,
      },
    }),
    firstName: resolveTextBindingValue({
      binding: front.bindings.firstName,
      person,
      computed: {
        orgLine1: orgSplit.line1,
        orgLine2: orgSplit.line2,
        firstName: computedFirst,
        lastName: computedLast,
        roleTitle: computedRoleText,
      },
    }),
    lastName: resolveTextBindingValue({
      binding: front.bindings.lastName,
      person,
      computed: {
        orgLine1: orgSplit.line1,
        orgLine2: orgSplit.line2,
        firstName: computedFirst,
        lastName: computedLast,
        roleTitle: computedRoleText,
      },
    }),
    title: resolveTextBindingValue({
      binding: front.bindings.title,
      person,
      computed: {
        orgLine1: orgSplit.line1,
        orgLine2: orgSplit.line2,
        firstName: computedFirst,
        lastName: computedLast,
        roleTitle: computedRoleText,
      },
    }),
  };
  const logoUrl = resolveLogoUrl(
    front.bindings.logo,
    person,
    front.logo.staticUrl
  );

  // widthIn/heightIn are total physical output dimensions and already include bleed.
  const pageWidthIn = template.canvas.widthIn;
  const pageHeightIn = template.canvas.heightIn;
  const cssWidthPx = pageWidthIn * 96;
  const cssHeightPx = pageHeightIn * 96;
  const designWidthPx = pageWidthIn * template.canvas.dpi;
  const designHeightPx = pageHeightIn * template.canvas.dpi;
  const scaleX = cssWidthPx / designWidthPx;
  const scaleY = cssHeightPx / designHeightPx;
  const frontOffsetX = front.offsetX ?? 0;
  const frontOffsetY = front.offsetY ?? 0;
  const cropMarksHtml = renderCropMarks({
    pageWidthIn,
    pageHeightIn,
    bleedIn: template.canvas.bleedIn,
  });

  const orgLayout1 = fitTextLayout(
    bindingValues.organizationLine1 || " ",
    front.organizationLine1,
    template.canvas.dpi,
    { maxLines: front.organizationLine1.maxLines ?? 1 }
  );
  const orgLayout2 = fitTextLayout(
    bindingValues.organizationLine2 || " ",
    front.organizationLine2,
    template.canvas.dpi,
    { maxLines: front.organizationLine2.maxLines ?? 1 }
  );
  const firstLayout = fitTextLayout(bindingValues.firstName || "ATTENDEE", front.firstName, template.canvas.dpi, {
    maxLines: 1,
    lineHeightEm: 1.0,
  });
  const lastLayout = fitTextLayout(bindingValues.lastName || " ", front.lastName, template.canvas.dpi, {
    maxLines: front.lastName.maxLines ?? 2,
    lineHeightEm: 1.02,
  });
  const titleLayout = fitTextLayout(bindingValues.title, front.title, template.canvas.dpi, {
    maxLines: front.title.maxLines ?? 3,
    lineHeightEm: front.title.lineHeight ?? 1.15,
  });
  const overflowFields: string[] = [];
  if (orgLayout1.overflowed) overflowFields.push("organizationLine1");
  if (orgLayout2.overflowed) overflowFields.push("organizationLine2");
  if (firstLayout.overflowed) overflowFields.push("firstName");
  if (lastLayout.overflowed) overflowFields.push("lastName");
  if (titleLayout.overflowed) overflowFields.push("title");

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(
    person.qrPayload
  )}`;

  const frontMapBg = mapboxStaticBackground(
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
    template.mapbox.styleId,
    person.longitude,
    person.latitude,
    template.mapbox.defaultZoom,
    Math.round(designWidthPx),
    Math.round(designHeightPx)
  );

  const finalBackgroundUrl =
    side === "front"
      ? frontMapBg || generatedFallbackBackground(roleTheme.mapTintColor)
      : roleTheme.backBackgroundUrl;
  const overlayUrl = side === "front" ? roleTheme.frontOverlayUrl : null;

  if (side === "back") {
    const renderedBackShapes = (back.shapes ?? [])
      .map((shape) =>
        renderShapeLayer({
          shape,
          scaleX,
          scaleY,
          offsetX: 0,
          offsetY: 0,
        })
      )
      .join("");
    const renderedBackImages = (back.images ?? [])
      .map((image) =>
        renderImageLayer({
          image,
          scaleX,
          scaleY,
          offsetX: 0,
          offsetY: 0,
        })
      )
      .join("");
    const renderedBackText = (back.textLayers ?? [])
      .map((textLayer) =>
        renderFreeTextLayer({
          textLayer,
          dpi: template.canvas.dpi,
          scaleX,
          scaleY,
          offsetX: 0,
          offsetY: 0,
        })
      )
      .join("");
    return `
<article class="badge role-${role}">
  ${cropMarksHtml}
  <div class="badge-canvas">
    ${finalBackgroundUrl ? `<img class="badge-bg" src="${escapeHtml(finalBackgroundUrl)}" alt="" />` : ""}
    ${overlayUrl ? `<img class="badge-overlay" src="${escapeHtml(overlayUrl)}" alt="" />` : ""}
    ${renderedBackShapes}
    ${renderedBackImages}
    ${renderedBackText}
    <img class="qr" src="${qrUrl}" alt="Badge QR code" style="left:${back.qr.x * scaleX}px;top:${back.qr.y * scaleY}px;width:${back.qr.size * scaleX}px;height:${back.qr.size * scaleY}px;" />
  </div>
</article>`;
  }

  const frontLayerHtml = new Map<string, string>();
  frontLayerHtml.set(
    "role_visuals",
    `<div class="map-tint" style="background:${escapeHtml(roleTheme.mapTintColor)};opacity:${roleTheme.mapTintOpacity};"></div>${
      overlayUrl ? `<img class="badge-overlay" src="${escapeHtml(overlayUrl)}" alt="" />` : ""
    }`
  );

  frontLayerHtml.set(
    "front_qr",
    `<img class="qr" src="${qrUrl}" alt="Badge QR code" style="left:${(front.qr.x + frontOffsetX) * scaleX}px;top:${
      (front.qr.y + frontOffsetY) * scaleY
    }px;width:${front.qr.size * scaleX}px;height:${front.qr.size * scaleY}px;" />`
  );

  frontLayerHtml.set(
    "logo",
    `<div class="org-logo-shell ${front.logo.shape === "circle" ? "circle" : ""}" style="left:${
      (front.logo.x + frontOffsetX) * scaleX
    }px;top:${(front.logo.y + frontOffsetY) * scaleY}px;width:${
      front.logo.diameter * scaleX
    }px;height:${front.logo.diameter * scaleY}px;">${
      logoUrl
        ? `<img class="org-logo ${front.logo.shape === "circle" ? "circle" : ""}" src="${escapeHtml(
            logoUrl
          )}" alt="" />`
        : ""
    }</div>`
  );

  frontLayerHtml.set(
    "organizationLine1",
    bindingValues.organizationLine1
      ? renderTextBlock({
          lines: [bindingValues.organizationLine1],
          slot: front.organizationLine1,
          layout: orgLayout1,
          dpi: template.canvas.dpi,
          scaleX,
          scaleY,
          offsetX: frontOffsetX,
          offsetY: frontOffsetY,
        })
      : ""
  );

  frontLayerHtml.set(
    "organizationLine2",
    bindingValues.organizationLine2
      ? renderTextBlock({
          lines: [bindingValues.organizationLine2],
          slot: front.organizationLine2,
          layout: orgLayout2,
          dpi: template.canvas.dpi,
          scaleX,
          scaleY,
          offsetX: frontOffsetX,
          offsetY: frontOffsetY,
        })
      : ""
  );

  frontLayerHtml.set(
    "firstName",
    renderTextBlock({
      lines: firstLayout.lines,
      slot: front.firstName,
      layout: firstLayout,
      dpi: template.canvas.dpi,
      scaleX,
      scaleY,
      offsetX: frontOffsetX,
      offsetY: frontOffsetY,
    })
  );

  frontLayerHtml.set(
    "lastName",
    bindingValues.lastName
      ? renderTextBlock({
          lines: lastLayout.lines,
          slot: front.lastName,
          layout: lastLayout,
          dpi: template.canvas.dpi,
          scaleX,
          scaleY,
          offsetX: frontOffsetX,
          offsetY: frontOffsetY,
        })
      : ""
  );

  frontLayerHtml.set(
    "title",
    bindingValues.title
      ? renderTextBlock({
          lines: titleLayout.lines,
          slot: front.title,
          layout: titleLayout,
          dpi: template.canvas.dpi,
          scaleX,
          scaleY,
          offsetX: frontOffsetX,
          offsetY: frontOffsetY,
        })
      : ""
  );

  for (const shape of front.shapes ?? []) {
    frontLayerHtml.set(
      `shape:${shape.id}`,
      renderShapeLayer({
        shape,
        scaleX,
        scaleY,
        offsetX: frontOffsetX,
        offsetY: frontOffsetY,
      })
    );
  }
  for (const image of front.images ?? []) {
    frontLayerHtml.set(
      `image:${image.id}`,
      renderImageLayer({
        image,
        scaleX,
        scaleY,
        offsetX: frontOffsetX,
        offsetY: frontOffsetY,
      })
    );
  }
  for (const textLayer of front.textLayers ?? []) {
    frontLayerHtml.set(
      `text:${textLayer.id}`,
      renderFreeTextLayer({
        textLayer,
        dpi: template.canvas.dpi,
        scaleX,
        scaleY,
        offsetX: frontOffsetX,
        offsetY: frontOffsetY,
      })
    );
  }

  const frontLayerOrder = front.layerOrder ?? [];
  const renderedFrontLayers = frontLayerOrder
    .map((layerId) =>
      isFrontLayerVisible(front, layerId) ? frontLayerHtml.get(layerId) ?? "" : ""
    )
    .join("");

  return `
<article class="badge role-${role}">
  ${cropMarksHtml}
  <div class="badge-canvas">
    ${finalBackgroundUrl ? `<img class="badge-bg" src="${escapeHtml(finalBackgroundUrl)}" alt="" />` : ""}
    ${renderedFrontLayers}
  </div>
</article>`;
}

export function renderJobDocumentHtml(params: {
  title: string;
  template: BadgeTemplateConfigV1;
  people: BadgePersonRecord[];
  includeBack: boolean;
}): string {
  const pages = params.people.flatMap((person) => {
    const role = personRoleFromKind(person.personKind);
    const front = renderBadgeHtml({
      template: params.template,
      role,
      person,
      side: "front",
    });
    if (!params.includeBack) return [front];
    const back = renderBadgeHtml({
      template: params.template,
      role,
      person,
      side: "back",
    });
    return [front, back];
  });

  const pageWidthIn = params.template.canvas.widthIn;
  const pageHeightIn = params.template.canvas.heightIn;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <link rel="stylesheet" href="https://use.typekit.net/uxh8ckq.css" />
    <title>${escapeHtml(params.title)}</title>
    <style>
      @page { size: ${pageWidthIn}in ${pageHeightIn}in; margin: 0; }
      html, body { margin: 0; padding: 0; background: #f5f5f5; }
      body {
        --font-primary: ${params.template.fonts.primary};
        --font-secondary: ${params.template.fonts.secondary};
        --font-slab: ${params.template.fonts.slab};
        font-family: var(--font-secondary);
      }
      .sheet { display: flex; flex-wrap: wrap; gap: 12px; padding: 12px; justify-content: center; }
      .badge {
        width: ${pageWidthIn}in;
        height: ${pageHeightIn}in;
        position: relative;
        background: #fff;
        overflow: hidden;
        box-shadow: 0 1px 4px rgba(0,0,0,0.12);
        page-break-after: always;
      }
      .crop-mark {
        position: absolute;
        background: #111;
        z-index: 30;
        pointer-events: none;
      }
      .badge-canvas {
        position: absolute;
        inset: 0;
      }
      .badge-bg {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .badge-overlay {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .map-tint {
        position: absolute;
        inset: 0;
        mix-blend-mode: multiply;
      }
      .org-logo-shell {
        position: absolute;
        background: #fff;
        overflow: hidden;
      }
      .org-logo-shell.circle { border-radius: 999px; }
      .org-logo {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: transparent;
      }
      .org-logo.circle { border-radius: 999px; }
      .shape-layer { position: absolute; box-sizing: border-box; }
      .image-layer { position: absolute; }
      .slot-text {
        position: absolute;
        color: #111;
        overflow: visible;
      }
      .slot-text-line {
        white-space: nowrap;
        overflow: visible;
      }
      .qr {
        position: absolute;
        background: #fff;
      }
      @media print {
        body { background: #fff; }
        .sheet { padding: 0; gap: 0; }
        .badge { box-shadow: none; }
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      ${pages.join("\n")}
    </main>
  </body>
</html>`;
}
