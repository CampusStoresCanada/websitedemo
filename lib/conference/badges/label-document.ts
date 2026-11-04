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
import { badgeNames, badgeRoleTitle, loadActiveBadgeTemplate } from "@/lib/conference/badges/document";
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

/**
 * The name and title a reprint prints, for one roster row.
 *
 * ⛔ The badge's own identity rule (badgeNames / badgeRoleTitle): the contact
 * record first, then the roster row, never a split of our own. One reader for
 * the sticker AND the desk's preview, so what the operator checks is what prints.
 */
export async function loadBadgeIdentity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any,
  person: Record<string, unknown>
): Promise<{
  contactId: string | null;
  names: { firstName: string | null; lastName: string | null; displayName: string | null };
  roleTitle: string | null;
}> {
  const canonicalId = typeof person.canonical_person_id === "string" ? person.canonical_person_id : null;
  const { data: canonical } = canonicalId
    ? await db.from("contacts").select("first_name, last_name, title:role_title").eq("id", canonicalId).maybeSingle()
    : { data: null };
  const rowEmail =
    (typeof person.contact_email === "string" && person.contact_email.trim().toLowerCase()) ||
    (typeof person.assigned_email_snapshot === "string" && person.assigned_email_snapshot.trim().toLowerCase()) ||
    null;
  const { data: emailContact } =
    rowEmail && person.organization_id
      ? await db
          .from("contacts")
          .select("role_title")
          .eq("organization_id", person.organization_id)
          .or(`work_email.eq.${rowEmail},email.eq.${rowEmail}`)
          .limit(1)
          .maybeSingle()
      : { data: null };
  return {
    contactId: canonical ? canonicalId : null,
    names: badgeNames(person, canonical ?? null),
    roleTitle: badgeRoleTitle(person, canonical ?? null, emailContact ?? null),
  };
}

export async function buildReprintLabelDocument(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any;
  conferenceId: string;
  jobId: string;
  /**
   * Which sticker: the front, or the back (the QR; on a spare also the
   * schedule above it, in one piece, because a spare's schedule area is empty).
   */
  side?: "front" | "back";
}): Promise<{ html: string; widthMm: number; heightMm: number; side: "front" | "back" }> {
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
    .select("*, organizations(name, logo_url)")
    .eq("id", job.person_id)
    .maybeSingle();
  if (!person) throw new LabelDocumentError("That person is no longer on this conference.");

  const { names, roleTitle } = await loadBadgeIdentity(db, person as Record<string, unknown>);

  // ⛔ Which badge this person's card is: the badge run's own answer
  // (badgeTypeForPerson), not "any seat they hold" — an event seat would pick
  // the wrong design, and the sticker would land off its card.
  const run = await resolveBadgeRun(conferenceId, { includeTestOrganizations: true });
  const badgeTypeId = badgeTypeForPerson(run, job.person_id as string)?.entityId ?? null;

  // The template the cards were printed with — the same rule as the print run.
  const template = await loadActiveBadgeTemplate(db, conferenceId);

  // ⛔ Same resolver the badge printer uses. A label resolved any other way is a
  // second answer to "what does this person's badge look like".
  const { front } = resolveBadgeVariant(template, { variantKey: badgeTypeId });

  const stock = plan.stockSpec ?? DEFAULT_REPRINT_STOCK;

  const side = params.side ?? "front";

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
      firstName: names.firstName ?? "",
      lastName: names.lastName ?? "",
      roleTitle: roleTitle ?? "",
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

  // ⛔ A SPARE's back is one sticker (Stephen, 2026-10-20): its schedule area
  // was printed empty, so the schedule goes on top and the QR below, at the
  // places the card's back design puts them. A company blank already carries
  // its schedule, so its back stays the QR alone.
  if (side === "back" && plan.delta.includes("schedule")) {
    const entitlement = run.entitlements.find((e) => e.personId === job.person_id);
    const { back } = resolveBadgeVariant(template, { variantKey: badgeTypeId });
    const schedule = entitlement
      ? renderScheduleLabel({
          template: { ...template, back },
          person: { access: entitlement.access, agenda: entitlement.agenda, qrPayload: "" } as unknown as BadgePersonRecord,
          widthMm: stock.widthMm,
        })
      : null;
    if (schedule?.html) {
      const dpi = template.canvas.dpi;
      const mm = (px: number) => (px / dpi) * 25.4;
      const anchor = (back.blocks ?? []).find((b) => b.flow) ?? null;
      // Where each part sits on the card (top-left, in mm) — mirroring how each
      // renderer frames its own sticker: the schedule 3 mm outside its column,
      // the QR label from its band and 16 design px above the code.
      const scheduleLeft = anchor ? mm(anchor.x) - 3 : 0;
      const scheduleTop = anchor ? mm(anchor.y) - 3 : 0;
      const qrLeft = mm(Math.min(back.qr.x, ...(back.blocks ?? []).map((b) => b.x)));
      const qrTop = mm(back.qr.y - 16);
      const originX = Math.min(scheduleLeft, qrLeft);
      const heightMm = Math.ceil(qrTop + out.heightMm - scheduleTop);
      const html = stackStickerParts({
        widthMm: stock.widthMm,
        heightMm,
        parts: [
          { html: schedule.html, xMm: scheduleLeft - originX, yMm: 0 },
          { html: out.html, xMm: qrLeft - originX, yMm: qrTop - scheduleTop },
        ],
      });
      return { html, widthMm: stock.widthMm, heightMm, side };
    }
  }

  return { html: out.html, widthMm: out.widthMm, heightMm: out.heightMm, side };
}

/** So the print stock policy stays one normalizer. */
export { normalizeBadgePrintStock };

/** One finished sticker document, split so it can share a page with others. */
function stickerPart(html: string, name: string) {
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
  const body = /<body>([\s\S]*?)<\/body>/.exec(html)?.[1] ?? "";
  // The page size and html/body are set once by the caller.
  let css = style.replace(/@page\s*\{[^}]*\}/g, "").replace(/html\s*,\s*body\s*\{[^}]*\}/g, "");
  const root = /:root\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
  css = css.replace(/:root\s*\{[^}]*\}/g, "");
  // ⛔ `.label` carries each sticker's own width and height — rename it per
  // part so one sticker's size cannot overwrite another's.
  css = css.replace(/\.label\b/g, `.label-${name}`);
  return {
    css,
    body: body.replace(/class="label"/g, `class="label-${name}"`),
    root,
    typekit: /<link rel="stylesheet" href="([^"]+)"/.exec(html)?.[1] ?? null,
  };
}

/**
 * Two stickers printed as ONE, each at its place on the card (Stephen,
 * 2026-10-20: a spare's back is one sticker — the schedule at the top and the
 * QR at the bottom). Offsets are from the combined sticker's top-left corner,
 * taken from the card's own layout, so the two land exactly as a printed badge
 * has them. One sticker to place instead of two, and they cannot drift apart.
 */
export function stackStickerParts(params: {
  widthMm: number;
  heightMm: number;
  parts: ReadonlyArray<{ html: string; xMm: number; yMm: number }>;
}): string {
  const parts = params.parts.filter((part) => part.html);
  if (parts.length === 0) return "";
  let rootVars = "";
  let typekit: string | null = null;
  const styles: string[] = [];
  const bodies: string[] = [];
  parts.forEach((part, i) => {
    const one = stickerPart(part.html, `s${i + 1}`);
    if (one.root.length > rootVars.length) rootVars = one.root;
    typekit = typekit ?? one.typekit;
    styles.push(one.css);
    bodies.push(`<div style="position:absolute;left:${part.xMm}mm;top:${part.yMm}mm;">${one.body}</div>`);
  });
  return `<!doctype html><html><head><meta charset="utf-8">
${typekit ? `<link rel="stylesheet" href="${typekit}" />` : ""}
<style>
  @page { size: ${params.widthMm}mm ${params.heightMm}mm; margin: 0; }
  ${rootVars}
  html,body { margin:0; padding:0; background:transparent; }
  .label { position:relative; width:${params.widthMm}mm; height:${params.heightMm}mm; overflow:hidden; }
  ${styles.join("\n")}
</style></head><body><div class="label">${bodies.join("")}</div></body></html>`;
}
