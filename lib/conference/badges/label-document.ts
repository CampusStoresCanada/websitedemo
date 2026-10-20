/**
 * Build the reprint label for one job — the pipeline entry point.
 *
 * ⛔ This module exists because the label renderer had ZERO callers. It was real
 * code with real tests reading live config, and it was an island: nothing in the
 * application could produce a label, and the only thing that ever called it was
 * a scratch script. Demonstrating it that way is showing the island as if it
 * were the road.
 *
 * Same shape as buildBadgeJobDocument: takes a job id, returns HTML the print
 * endpoint serves.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveBadgeVariant, type BadgePersonRecord } from "@/lib/conference/badges/template";
import { renderScheduleLabel } from "@/lib/conference/badges/render-html";
import { loadActiveBadgeTemplate } from "@/lib/conference/badges/document";
import { badgeTypeForPerson, resolveBadgeRun } from "@/lib/conference/badges/run";
import { renderReprintLabel } from "@/lib/conference/badges/label-html";
import { reservedPlatesFromOverlay } from "@/lib/conference/badges/label-placement";
import { normalizeBadgePrintStock } from "@/lib/conference/badges/print-stock";
import QRCode from "qrcode";
import {
  badgeScanUrl, deriveBadgeToken, BADGE_TOKEN_FORMAT,
} from "@/lib/conference/badges/tokens";
import { DEFAULT_REPRINT_STOCK, type ReprintPlan } from "@/lib/conference/badges/reprint-plan";

export class LabelDocumentError extends Error {}

/**
 * ⚠️ The overlay a variant prints on decides which plates are reserved, and the
 * two overlays differ: the exhibitor one has a QR plate, the delegate one does
 * not. Choosing by `front_qr` in the layer order rather than by a name keeps
 * this correct for a conference whose registration types are called something
 * else entirely.
 */
async function platesForVariant(front: { layerOrder: string[] }, canvasWidthPx: number) {
  const file = front.layerOrder.includes("front_qr")
    ? "exhibitor-front-overlay-v2.svg"
    : "delegate-front-overlay-v2.svg";
  try {
    const svg = await readFile(path.join(process.cwd(), "public", "badges", file), "utf8");
    return reservedPlatesFromOverlay(svg, canvasWidthPx);
  } catch {
    // ⛔ No plates is NOT the same as no constraint. Returning [] would let a
    // label size itself over a QR. Refuse instead: a badge that stops scanning
    // fails at a door, silently, in front of somebody.
    throw new LabelDocumentError(
      `Could not read the badge overlay (${file}); refusing to place a label without knowing what it must stay clear of.`
    );
  }
}

/**
 * The person's badge QR, derived the same way the printed badge derives it.
 *
 * ⛔ From the token ROW ID through deriveBadgeToken — not re-minted, not the
 * person id. A second derivation rule would produce a code that scans to
 * nothing while looking perfectly valid.
 *
 * ⚠️ Returns null when the person has no token row, and the caller must treat
 * that as "no back label" rather than printing an empty sticker.
 */
async function personQrDataUri(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, conferenceId: string, personId: string
): Promise<string | null> {
  const { data: row } = await db
    .from("conference_badge_tokens")
    .select("id, token_format, revoked_at")
    .eq("conference_id", conferenceId)
    .eq("person_id", personId)
    .maybeSingle();
  if (!row || row.revoked_at) return null;
  if (row.token_format !== BADGE_TOKEN_FORMAT) return null;
  const svg = await QRCode.toString(badgeScanUrl(deriveBadgeToken(conferenceId, row.id as string)), {
    type: "svg", errorCorrectionLevel: "M", margin: 0,
  });
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

export async function buildReprintLabelDocument(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any;
  conferenceId: string;
  jobId: string;
  /**
   * Which sticker. A reprint onto a blank needs front and back (the QR); onto a
   * spare also the schedule, because a spare prints its schedule area empty.
   */
  side?: "front" | "back" | "schedule";
}): Promise<{ html: string; widthMm: number; heightMm: number; side: "front" | "back" | "schedule" }> {
  const { db, conferenceId, jobId } = params;

  const { data: job } = await db
    .from("badge_print_jobs")
    .select("id, person_id, pipeline_type, metadata, template_version")
    .eq("id", jobId)
    .eq("conference_id", conferenceId)
    .maybeSingle();
  if (!job) throw new LabelDocumentError("That print job does not exist.");
  if (job.pipeline_type !== "onsite_reprint") {
    throw new LabelDocumentError("Only an on-site reprint produces a label.");
  }

  // ⛔ The plan is read from the JOB, not recomputed. What the desk had in hand
  // is a fact about that moment — blanks get used up — so re-deriving it later
  // would describe a different card from the one that was printed.
  const plan = (job.metadata as Record<string, unknown> | null)?.reprint_plan as ReprintPlan | undefined;
  if (!plan) throw new LabelDocumentError("This job carries no reprint plan; it predates label printing.");
  if (plan.transport !== "ql_label") {
    throw new LabelDocumentError("This reprint is a full badge, not a label.");
  }

  const { data: person } = await db
    .from("conference_people")
    .select("id, display_name, role_title, organization_id, organizations(name, logo_url)")
    .eq("id", job.person_id)
    .maybeSingle();
  if (!person) throw new LabelDocumentError("That person is no longer on this conference.");

  // ⛔ Which badge this person's card is: the badge run's own answer
  // (badgeTypeForPerson), not "any seat they hold" — an event seat would pick
  // the wrong design, and the sticker would land off its card.
  const run = await resolveBadgeRun(conferenceId);
  const badgeTypeId = badgeTypeForPerson(run, job.person_id as string)?.entityId ?? null;

  // The template the cards were printed with — the same rule as the print run.
  const template = await loadActiveBadgeTemplate(db, conferenceId);

  // ⛔ Same resolver the badge printer uses. A label resolved any other way is a
  // second answer to "what does this person's badge look like".
  const { front } = resolveBadgeVariant(template, { variantKey: badgeTypeId });

  const display = String(person.display_name ?? "").trim();
  const gap = display.lastIndexOf(" ");
  const stock = plan.stockSpec ?? DEFAULT_REPRINT_STOCK;

  const side = params.side ?? "front";

  // ── The schedule sticker (spares only) ─────────────────────────────────────
  if (side === "schedule") {
    if (!plan.delta.includes("schedule")) {
      throw new LabelDocumentError("This card already carries its schedule; there is no schedule sticker.");
    }
    // ⛔ The person's OWN access and schedule, as their badge would print them:
    // the badge run's entitlement, not their type's (add-ons count).
    const entitlement = run.entitlements.find((e) => e.personId === job.person_id);
    if (!entitlement) throw new LabelDocumentError("Nothing on this person's registration to put on a schedule.");
    const { back } = resolveBadgeVariant(template, { variantKey: badgeTypeId });
    const out = renderScheduleLabel({
      template: { ...template, back },
      person: { access: entitlement.access, agenda: entitlement.agenda, qrPayload: "" } as unknown as BadgePersonRecord,
      widthMm: stock.widthMm,
    });
    if (!out.html) throw new LabelDocumentError("There is nothing to print on this schedule.");
    return { html: out.html, widthMm: out.widthMm, heightMm: out.heightMm, side };
  }

  const qrDataUri = side === "back"
    ? await personQrDataUri(db, conferenceId, job.person_id as string)
    : null;
  if (side === "back" && !qrDataUri) {
    throw new LabelDocumentError(
      "No usable badge token for this person, so there is no back label to print. " +
      "A back sticker with no QR would look like a finished reprint and scan as nothing."
    );
  }
  const out = renderReprintLabel({
    side,
    qrDataUri,
    person: {
      firstName: gap > 0 ? display.slice(0, gap) : display,
      lastName: gap > 0 ? display.slice(gap + 1) : "",
      roleTitle: String(person.role_title ?? ""),
      organizationName: (person.organizations as { name?: string } | null)?.name ?? "",
      // ⛔ A spare carries no branding, so the sticker supplies the mark.
      logoUrl: (person.organizations as { logo_url?: string } | null)?.logo_url ?? null,
    },
    template: { ...template, front },
    delta: plan.delta,
    stock,
    anchorTextToEdge: true,
    reserved: await platesForVariant(front, template.canvas.widthIn * template.canvas.dpi),
  });

  if (!out.html) throw new LabelDocumentError("There is nothing to print on this label.");
  return { html: out.html, widthMm: out.widthMm, heightMm: out.heightMm, side };
}

/** So the print stock policy stays one normalizer. */
export { normalizeBadgePrintStock };

/**
 * Every sticker of one reprint as ONE print job (Stephen, 2026-10-20).
 *
 * ⛔ Each sticker keeps its OWN length: a CSS named page per sticker
 * (`page: pN` + `@page pN { size }`), so the QL's auto-cut separates them and
 * no sticker is padded to another's height — sharing one page height wasted
 * 27–46 mm of film per reprint, and a schedule runs to ~96 mm. Chrome honours
 * named pages (the print station); iPad Safari's page sizing is unreliable, so
 * the desk keeps one-sticker-at-a-time as the fallback.
 *
 * Pure: takes the finished sticker documents, so each is still rendered by its
 * own renderer and nothing about a sticker's layout changes.
 */
export function combineStickerDocuments(
  stickers: ReadonlyArray<{ html: string; widthMm: number; heightMm: number }>
): string {
  const pages = stickers.filter((s) => s.html && s.heightMm > 0);
  if (pages.length === 0) return "";
  const styles: string[] = [];
  const bodies: string[] = [];
  let rootVars = "";
  pages.forEach((sticker, i) => {
    const name = `p${i + 1}`;
    const style = /<style>([\s\S]*?)<\/style>/.exec(sticker.html)?.[1] ?? "";
    const body = /<body>([\s\S]*?)<\/body>/.exec(sticker.html)?.[1] ?? "";
    // The page size moves to a named @page; html/body are set once below.
    let css = style
      .replace(/@page\s*\{[^}]*\}/g, "")
      .replace(/html\s*,\s*body\s*\{[^}]*\}/g, "");
    // Each sticker's root vars are the same template's fonts; keep the fullest.
    const root = /:root\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    if (root.length > rootVars.length) rootVars = root;
    css = css.replace(/:root\s*\{[^}]*\}/g, "");
    // ⛔ `.label` carries each sticker's own width and height — rename it per
    // page so the stickers' sizes cannot overwrite each other.
    css = css.replace(/\.label\b/g, `.label-${name}`);
    styles.push(
      `@page ${name} { size: ${sticker.widthMm}mm ${sticker.heightMm}mm; margin: 0; }\n` +
        `.page-${name} { page: ${name}; break-after: page; width: ${sticker.widthMm}mm; height: ${sticker.heightMm}mm; overflow: hidden; }\n` +
        css
    );
    bodies.push(`<section class="page-${name}">${body.replace(/class="label"/g, `class="label-${name}"`)}</section>`);
  });
  const first = pages[0];
  const typekit = /<link rel="stylesheet" href="([^"]+)"/.exec(first.html)?.[1];
  return `<!doctype html><html><head><meta charset="utf-8">
${typekit ? `<link rel="stylesheet" href="${typekit}" />` : ""}
<style>
  @page { size: ${first.widthMm}mm ${first.heightMm}mm; margin: 0; }
  ${rootVars}
  html,body { margin:0; padding:0; background:transparent; }
  section:last-of-type { break-after: auto; }
  ${styles.join("\n")}
</style></head><body>${bodies.join("")}</body></html>`;
}
