import type { AccessSummary } from "@/lib/conference/entity-commerce";
import {
  type BadgeBackBlock,
  type BadgeFreeTextLayer,
  type BadgeImageLayer,
  type BadgeLogoBindingKey,
  type BadgePersonRecord,
  type BadgeShapeLayer,
  type BadgeSlotText,
  type BadgeTemplateConfigV1,
  type BadgeTextBindingKey,
  resolveBadgeVariant,
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
  /**
   * The registration type this badge is for — a `conference_entities.id`.
   * Optional: without it the badge falls back to the legacy role layout, which
   * is what every template did before layouts could vary by type.
   */
  variantKey?: string | null;
  person: BadgePersonRecord;
  side: "front" | "back";
  /** Conference-level, derived in resolveBadgeRun from the `venue` entities. */
  venueAddress?: string | null;
  /** Read from the designated contact's profile at print time, never baked in. */
  onsiteContact?: { name: string; phone: string } | null;
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

  // Mapbox burns its own credit line into the returned raster, bottom-right. On a
  // screen that is fine; on a 3.25x5.25in badge it lands INSIDE the trim area and
  // prints on the finished card. Suppressing it is supported by the Static Images
  // API, but Mapbox's terms only permit that when the attribution appears
  // elsewhere in the product -- so whoever turns this off owes an attribution
  // somewhere the attendee can see it (badge back, or the printed programme).
  return `https://api.mapbox.com/styles/v1/${stylePath}/static/${lng},${lat},${zoom},0/${requestWidth}x${requestHeight}?access_token=${encodeURIComponent(
    token
  )}&attribution=false&logo=false`;
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
  // ⛔ Was `firstName: "ATTENDEE"`. Preflight (which splits the same name via
  // run.ts) returned "" and reported the badge clean, while this printed the
  // literal word ATTENDEE onto it — preflight validating a different answer
  // than the renderer produced, which is the whole bug class this pipeline was
  // supposed to have stopped having. An empty name is a preflight problem, not
  // something to paper over at render time.
  if (!display) return { firstName: "", lastName: "" };
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


/** "09:00" / "09:00:00" -> "9:00 AM". Anything else passes through unchanged. */
function formatClock(value: string | null): string {
  if (!value) return "";
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return value.trim();
  const hour = Number(match[1]);
  if (!Number.isFinite(hour)) return value.trim();
  const suffix = hour < 12 ? "AM" : "PM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${match[2]} ${suffix}`;
}

/** What the badge admits its holder to, as display lines. Derived, never authored. */
function accessLines(access: AccessSummary | null): string[] {
  if (!access) return [];
  const lines: string[] = [];
  if (access.days.length) lines.push(access.days.join(" · "));
  if (access.mealsIncluded) lines.push("All meals included");
  if (access.meetingDay) lines.push(`Curated meetings — ${access.meetingDay}`);
  if (access.tradeShowDays.length) {
    lines.push(`Trade show — ${access.tradeShowDays.map((d) => d.name).join(", ")}`);
  }
  // Deliberately NOT listing access.events by name: the agenda block below
  // prints every one of them with its day and time. Naming them twice cost five
  // lines on a full delegate badge and pushed the schedule into the QR.
  if (access.events.length) {
    lines.push(
      access.events.length === 1
        ? "1 evening event — see schedule"
        : `${access.events.length} evening events — see schedule`
    );
  }
  return lines;
}

type BackRow = { html: string; text: string };

/** The derived rows of one block, plus its heading. No layout decisions here. */
function backBlockRows(params: {
  block: BadgeBackBlock;
  person: BadgePersonRecord;
  venueAddress: string | null;
  onsiteContact: { name: string; phone: string } | null;
}): { heading: string | null; rows: BackRow[] } {
  const { block, person, venueAddress, onsiteContact } = params;
  const rows: BackRow[] = [];
  const plain = (text: string, cls = "bb-row") =>
    rows.push({ html: `<div class="${cls}">${escapeHtml(text)}</div>`, text });

  if (block.source === "access_summary") {
    for (const line of accessLines(person.access)) plain(line);
  } else if (block.source === "agenda") {
    let currentDay = "";
    for (const item of person.agenda) {
      if (item.dayName && item.dayName !== currentDay) {
        currentDay = item.dayName;
        plain(currentDay, "bb-day");
      }
      const time = formatClock(item.startTime);
      const room = item.venueName
        ? `<span class="bb-room">${escapeHtml(item.venueName)}</span>`
        : "";
      rows.push({
        html: `<div class="bb-item"><span class="bb-time">${escapeHtml(
          time
        )}</span><span class="bb-name">${escapeHtml(item.name)}${room}</span></div>`,
        // The time sits in a fixed column; name and room share what is left.
        text: `${item.name} ${item.venueName ?? ""}`,
      });
    }
  } else if (block.source === "qr_caption") {
    // ⛔ The caption is ABOUT the code, so no code means no caption. A blank
    // badge has no token and prints no QR; leaving this in pointed the holder
    // at empty space and told them it identified them, which is the opposite of
    // what a blank says. Keyed on the payload rather than the image so it also
    // covers a badge whose QR failed to generate.
    if (person.qrPayload) {
      plain(
        block.text?.trim() ||
          "This code identifies your badge for check-in and scanning on site."
      );
    }
  } else if (block.source === "venue") {
    if (venueAddress) plain(venueAddress);
    if (onsiteContact) {
      plain(
        onsiteContact.name
          ? `On site: ${onsiteContact.name} · ${onsiteContact.phone}`
          : `On site: ${onsiteContact.phone}`
      );
    }
    if (block.text?.trim()) plain(block.text.trim());
  }

  return { heading: block.heading, rows };
}

function familyCssFor(family: BadgeBackBlock["family"]): string {
  return family === "primary"
    ? "var(--font-primary)"
    : family === "slab"
      ? "var(--font-slab)"
      : "var(--font-secondary)";
}

/**
 * Every back block, laid out.
 *
 * Flow blocks share one column so a type with a long agenda pushes down instead
 * of colliding with whatever sits below it. The column has a line budget; rows
 * beyond it are TRUNCATED AND COUNTED, never silently cut, because a badge
 * missing half an agenda looks exactly like one that never had it.
 *
 * Wrapped lines are ESTIMATED from character count — the generator cannot
 * measure text — so the budget is deliberately conservative.
 */
function renderBackBlocks(params: {
  blocks: BadgeBackBlock[];
  person: BadgePersonRecord;
  venueAddress: string | null;
  onsiteContact: { name: string; phone: string } | null;
  dpi: number;
  scaleX: number;
  scaleY: number;
}): string {
  const { blocks, person, venueAddress, onsiteContact, dpi, scaleX, scaleY } = params;
  const flow = blocks.filter((b) => b.flow);
  const pinned = blocks.filter((b) => !b.flow);
  const out: string[] = [];

  const renderOne = (block: BadgeBackBlock, rows: BackRow[], heading: string | null) => {
    const sizePx = designPxFromPt(block.sizePt, dpi) * scaleX;
    const head = heading ? `<div class="bb-head">${escapeHtml(heading)}</div>` : "";
    return `<div class="bb-group" style="font-family:${familyCssFor(
      block.family
    )};font-size:${sizePx}px;">${head}${rows.map((r) => r.html).join("")}</div>`;
  };

  if (flow.length > 0) {
    const anchor = flow[0];
    const budget = anchor.maxLines && anchor.maxLines > 0 ? anchor.maxLines : Infinity;
    // Rough advance width for the block's face; only used to predict wrapping.
    const charsPerLine = Math.max(
      12,
      Math.floor(anchor.width / (designPxFromPt(anchor.sizePt, dpi) * 0.5))
    );
    let used = 0;
    let dropped = 0;
    const groups: string[] = [];

    for (const block of flow) {
      const { heading, rows } = backBlockRows({ block, person, venueAddress, onsiteContact });
      if (rows.length === 0) continue;
      const kept: BackRow[] = [];
      if (heading) used += 1;
      for (const row of rows) {
        const lines = Math.max(1, Math.ceil(row.text.length / charsPerLine));
        if (used + lines > budget) {
          dropped += 1;
          continue;
        }
        used += lines;
        kept.push(row);
      }
      if (kept.length > 0 || heading) groups.push(renderOne(block, kept, heading));
    }
    if (dropped > 0) {
      groups.push(
        `<div class="bb-more">+ ${dropped} more — see the full programme</div>`
      );
    }
    out.push(
      `<div class="back-block" style="left:${anchor.x * scaleX}px;top:${
        anchor.y * scaleY
      }px;width:${anchor.width * scaleX}px;font-size:${
        designPxFromPt(anchor.sizePt, dpi) * scaleX
      }px;">${groups.join("")}</div>`
    );
  }

  for (const block of pinned) {
    const { heading, rows } = backBlockRows({ block, person, venueAddress, onsiteContact });
    if (rows.length === 0) continue;
    out.push(
      `<div class="back-block" style="left:${block.x * scaleX}px;top:${
        block.y * scaleY
      }px;width:${block.width * scaleX}px;">${renderOne(block, rows, heading)}</div>`
    );
  }

  return out.join("");
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
  const { template, person, side } = options;
  // One resolution point for "what does this person's badge look like" — see
  // resolveBadgeVariant. Registration type wins, legacy role is the fallback.
  const {
    front,
    back,
    theme: roleTheme,
    resolvedKey,
  } = resolveBadgeVariant(template, { variantKey: options.variantKey });
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
  // ⛔ Was `|| "ATTENDEE"`, the SAME bug the note on splitDisplayName above says
  // was killed — it had simply moved one function over. fitTextLayout does not
  // just measure, it returns the lines that print (see `lines: firstLayout.lines`
  // below), so a badge with no first name printed the literal word ATTENDEE
  // across its name block. It survived because every real badge has a name and
  // preflight blocks the ones that do not; blanks, which have no name BY
  // DESIGN, printed 152 cards reading ATTENDEE. A space, matching lastName:
  // fit against something non-empty, print nothing.
  const firstLayout = fitTextLayout(bindingValues.firstName || " ", front.firstName, template.canvas.dpi, {
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
  /**
   * ⛔ A ONE-LINE ORGANISATION NAME IS CENTRED ON THE LOGO.
   *
   * Two lines are a bold line above a light one, and together they optically
   * balance the disc beside them. Drop the second line and the first would stay
   * on the upper baseline — one line hanging at the top of a space built for
   * two, with the disc beside it reading bottom-heavy. Stephen: "If there aren't
   * two lines it is one bold line that is centered to the center of the logo."
   *
   * ⛔ This CANNOT live in the layout editor. It depends on the CONTENT of the
   * badge being printed, not on the template: a one-line org and a two-line org
   * share one set of coordinates and must resolve differently at render time.
   * That is the whole reason this rule is code and the rail is config.
   *
   * ⛔ Derived from renderTextBlock's OWN box model, not from a cap-height
   * constant. My first attempt used "a cap is 0.7em" and landed 7.5px (0.6mm)
   * low, because that ratio is a property of the typeface, not a fact — and a
   * number tuned until a render looks right is the hand-crafting this work has
   * already been pulled up for once.
   *
   * renderTextBlock draws the box at `baselineY - em*0.8` with height `em*lh`.
   * Setting that box's centre to the logo's centre and solving for baselineY
   * needs no font metric and stays correct if the typeface changes:
   *
   *   top + height/2 = logoCentre
   *   (baselineY - 0.8em) + (em*lh)/2 = logoCentre
   *   baselineY = logoCentre + 0.8em - (em*lh)/2
   */
  const orgIsSingleLine = !(bindingValues.organizationLine2 ?? "").trim();
  const orgSlot1 = orgIsSingleLine
    ? {
        ...front.organizationLine1,
        baselineY: (() => {
          const em = designPxFromPt(orgLayout1.sizePt, template.canvas.dpi);
          const lh = orgLayout1.lineHeightEm;
          return front.logo.y + front.logo.diameter / 2 + em * 0.8 - (em * lh) / 2;
        })(),
        weight: Math.max(front.organizationLine1.weight, 700),
      }
    : front.organizationLine1;

  const overflowFields: string[] = [];
  if (orgLayout1.overflowed) overflowFields.push("organizationLine1");
  if (orgLayout2.overflowed) overflowFields.push("organizationLine2");
  if (firstLayout.overflowed) overflowFields.push("firstName");
  if (lastLayout.overflowed) overflowFields.push("lastName");
  if (titleLayout.overflowed) overflowFields.push("title");

  // Generated locally in document.ts and inlined. The old path fetched every
  // badge's code from api.qrserver.com, which handed a third party an
  // identifier for every attendee and made printing depend on their uptime.
  //
  // ⛔ Empty payload → NO QR, and in particular no fetch. A blank badge has no
  // person and therefore no token, and both branches below would otherwise
  // misfire on it: the fallback would ask a third party to encode the empty
  // string, printing a scannable code that resolves to nothing. A card with no
  // code on it reads as "not issued yet", which is what a blank is.
  const qrUrl =
    person.qrImageDataUri ??
    (person.qrPayload
      ? `https://api.qrserver.com/v1/create-qr-code/?size=512x512&data=${encodeURIComponent(
          person.qrPayload
        )}`
      : null);

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
<article class="badge variant-${resolvedKey}">
  ${cropMarksHtml}
  <div class="badge-canvas">
    ${finalBackgroundUrl ? `<img class="badge-bg" src="${escapeHtml(finalBackgroundUrl)}" alt="" />` : ""}
    ${overlayUrl ? `<img class="badge-overlay" src="${escapeHtml(overlayUrl)}" alt="" />` : ""}
    ${renderedBackShapes}
    ${renderedBackImages}
    ${renderedBackText}
    ${qrUrl ? `<img class="qr" src="${qrUrl}" alt="Badge QR code" style="left:${back.qr.x * scaleX}px;top:${back.qr.y * scaleY}px;width:${back.qr.size * scaleX}px;height:${back.qr.size * scaleY}px;" />` : ""}
    ${renderBackBlocks({
      blocks: back.blocks ?? [],
      person,
      venueAddress: options.venueAddress ?? null,
      onsiteContact: options.onsiteContact ?? null,
      dpi: template.canvas.dpi,
      scaleX,
      scaleY,
    })}
    ${frontMapBg ? `<div class="map-credit">© Mapbox © OpenStreetMap</div>` : ""}
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

  // ⛔ The FRONT QR is the ORGANISATION's public listing code, not the person's
  // badge token. The two codes are deliberately different and deliberately on
  // different faces: the front faces outward and can be scanned in passing, so
  // it may only reach a public page built from opted-in listing data. The
  // person's token lives on the back, where showing it is a deliberate act.
  // Nothing renders when the org has no public code — a floating QR over the
  // map with no plate behind it is worse than no QR.
  frontLayerHtml.set(
    "front_qr",
    person.orgQrImageDataUri
      ? `<img class="qr" src="${person.orgQrImageDataUri}" alt="${escapeHtml(
          person.organizationName ?? "Exhibitor"
        )} directory listing" style="left:${(front.qr.x + frontOffsetX) * scaleX}px;top:${
          (front.qr.y + frontOffsetY) * scaleY
        }px;width:${front.qr.size * scaleX}px;height:${front.qr.size * scaleY}px;" />`
      : ""
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
          slot: orgSlot1,
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
<article class="badge variant-${resolvedKey}">
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
  venueAddress?: string | null;
  onsiteContact?: { name: string; phone: string } | null;
}): string {
  const pages = params.people.flatMap((person) => {
    // The badge's layout is its registration type. No role, no person kind.
    const variantKey = person.variantKey;
    const front = renderBadgeHtml({
      template: params.template,
      variantKey,
      person,
      side: "front",
      venueAddress: params.venueAddress ?? null,
      onsiteContact: params.onsiteContact ?? null,
    });
    if (!params.includeBack) return [front];
    const back = renderBadgeHtml({
      template: params.template,
      variantKey,
      person,
      side: "back",
      venueAddress: params.venueAddress ?? null,
      onsiteContact: params.onsiteContact ?? null,
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
      /* ⛔ Chrome DROPS background colours and images when printing unless this
         is set. Everything that makes a badge a badge is a background here: the
         map photo, the tint layer, the overlay artwork, and the crop marks
         (which are background-coloured divs). Without it the PDF comes out as
         text on white with no trim guides — and nothing in the HTML preview
         hints at it, because on screen they all render fine. */
      *, *::before, *::after {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
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
      /* The static map request suppresses Mapbox's burnt-in credit, which used to
         print inside the trim on the front. Mapbox's terms allow that only if the
         attribution appears elsewhere in the product -- this is that elsewhere. */
      .back-block {
        position: absolute;
        color: #14161a;
        line-height: 1.25;
      }
      /* Flow groups stack; the gap is what keeps a long access summary from
         touching the schedule heading below it. */
      .bb-group + .bb-group { margin-top: 1.1em; }
      .bb-head {
        font-weight: 700;
        letter-spacing: 0.09em;
        text-transform: uppercase;
        font-size: 0.86em;
        margin-bottom: 0.5em;
      }
      .bb-day {
        font-weight: 700;
        margin-top: 0.55em;
      }
      .bb-item {
        display: flex;
        gap: 0.5em;
      }
      .bb-time {
        flex: 0 0 auto;
        width: 5.8em;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .bb-name { flex: 1 1 auto; }
      .bb-room { opacity: 0.62; }
      .bb-room::before { content: " · "; }
      .bb-more { font-style: italic; opacity: 0.75; margin-top: 0.3em; }
      .map-credit {
        position: absolute;
        left: 0.125in;
        right: 0.125in;
        bottom: 0.3in;
        text-align: center;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 4pt;
        line-height: 1.3;
        color: #8a8a8a;
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
        .sheet { padding: 0; gap: 0; display: block; }
        /* One badge per sheet — flex centring is a screen affordance and leaves
           the page origin somewhere Chrome has to guess at. */
        .badge { box-shadow: none; margin: 0; break-after: page; }
        .badge:last-child { break-after: auto; }
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
