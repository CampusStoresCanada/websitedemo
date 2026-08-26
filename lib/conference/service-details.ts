/**
 * The facts an exhibitor needs to actually place a service order.
 *
 * These used to be a paragraph inside the task's `description` — show code,
 * four deadlines and a URL, written as prose. Nobody reads a paragraph to find
 * a number they have to type into somebody else's website. The task says what
 * to do; this says what you need to do it.
 *
 * Stored on a `service`-kind conference entity's `attributes`, not a new
 * table: a show contractor is a thing at the conference with properties, which
 * is exactly what the v3 entity graph is for, and the task already carries a
 * `check_entity_id` to point at it.
 */

export type ServiceDeadline = {
  label: string;
  /** ISO date. Rendered in Toronto time — these are show-floor deadlines. */
  date: string;
  /** What happens if it is missed. Null when nothing does. */
  consequence: string | null;
};

export type ServiceDetails = {
  name: string;
  what: string | null;
  actionUrl: string | null;
  actionLabel: string | null;
  /** Typed into the supplier's own site — the single most copied string here. */
  showCode: string | null;
  contactName: string | null;
  contactEmail: string | null;
  deadlines: ServiceDeadline[];
  /** Forms and kits attached to this supplier. */
  documents: { label: string; url: string }[];
  /**
   * True when the task says to submit a form and we hold neither the form nor
   * a link to it — the exhibitor is being told to complete something we have
   * not given them.
   *
   * Surfaced rather than hidden. The alternative is a card that looks finished
   * while the one thing it exists to provide is missing, which is how a made-up
   * URL survives: it fills the hole that would otherwise be visible.
   */
  formMissing: boolean;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

/** Parse one `service` entity's attributes. Unknown keys are ignored. */
export function parseServiceDetails(
  name: string,
  attributes: unknown
): ServiceDetails | null {
  if (!attributes || typeof attributes !== "object") return null;
  const a = attributes as Record<string, unknown>;

  const rawDeadlines = Array.isArray(a.deadlines) ? a.deadlines : [];
  const deadlines: ServiceDeadline[] = [];
  for (const entry of rawDeadlines) {
    if (!entry || typeof entry !== "object") continue;
    const d = entry as Record<string, unknown>;
    const label = str(d.label);
    const date = str(d.date);
    if (!label || !date) continue;
    deadlines.push({ label, date, consequence: str(d.consequence) });
  }
  // Soonest first: the one that costs money is usually the nearest.
  deadlines.sort((x, y) => x.date.localeCompare(y.date));

  const rawDocs = Array.isArray(a.documents) ? a.documents : [];
  const documents: { label: string; url: string }[] = [];
  for (const entry of rawDocs) {
    if (!entry || typeof entry !== "object") continue;
    const d = entry as Record<string, unknown>;
    const label = str(d.label);
    const url = str(d.url);
    if (label && url) documents.push({ label, url });
  }

  const details: ServiceDetails = {
    name,
    what: str(a.what),
    actionUrl: str(a.action_url),
    actionLabel: str(a.action_label),
    showCode: str(a.show_code),
    contactName: str(a.contact_name),
    contactEmail: str(a.contact_email),
    deadlines,
    documents,
    formMissing:
      str(a.submit_by) !== null && !str(a.action_url) && documents.length === 0,
  };

  // An entity with none of this is not a service card, it is an empty box.
  const hasAnything =
    details.actionUrl || details.showCode || details.contactEmail ||
    deadlines.length > 0 || documents.length > 0;
  return hasAnything ? details : null;
}
