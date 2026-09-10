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
  /** Calendar date, YYYY-MM-DD. Formatted as digits, never parsed to an instant. */
  date: string;
  /**
   * The supplier's stated time, verbatim — "11:59 PM", "8:00 AM - 4:00 PM".
   *
   * A display string, not a timestamp. Stronco states a cut-off of 11:59 PM
   * and a receiving window of 8:00 AM - 4:00 PM; those are their dock's local
   * hours, and re-expressing them as instants would invent a precision the
   * supplier never gave. Dropping them, which the first version did, loses the
   * difference between "the 10th" and "the end of the 10th".
   */
  time: string | null;
  /** What happens if it is missed. Null when nothing does. */
  consequence: string | null;
  /**
   * The supplier's own wording where the date is DERIVED from a rule rather
   * than stated — Encore's advance rate depends on "10 business days or more
   * before show opening", so the date is our arithmetic, not their promise.
   */
  derivedFrom: string | null;
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
  contactPhone: string | null;
  /** Rung from the floor when something has failed, not to place an order. */
  onsiteSupportPhone: string | null;
  /** How the order is actually placed, in the supplier's own process terms. */
  how: string | null;
  /** Costs or limits the rate sheet does not show. */
  watchFor: string | null;
  deadlines: ServiceDeadline[];
  /**
   * Forms and kits, ready to render. `href` is either an external link or a
   * signed URL for a private file — resolved by the loader, on the server,
   * because the component that renders this is reached through a client
   * component and so cannot be async.
   */
  documents: { label: string; href: string }[];
  /** Unresolved sources. The loader turns these into `documents`. */
  documentSources: { label: string; url: string | null; storagePath: string | null }[];
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
    deadlines.push({
      label, date,
      time: str(d.time),
      consequence: str(d.consequence),
      derivedFrom: str(d.derived_from),
    });
  }
  // Soonest first: the one that costs money is usually the nearest.
  deadlines.sort((x, y) => x.date.localeCompare(y.date));

  const rawDocs = Array.isArray(a.documents) ? a.documents : [];
  const documentSources: { label: string; url: string | null; storagePath: string | null }[] = [];
  for (const entry of rawDocs) {
    if (!entry || typeof entry !== "object") continue;
    const d = entry as Record<string, unknown>;
    const label = str(d.label);
    const url = str(d.url);
    const storagePath = str(d.storage_path);
    // A document with a label and no source is a dead link with a name on it.
    if (label && (url || storagePath)) documentSources.push({ label, url, storagePath });
  }

  const details: ServiceDetails = {
    name,
    what: str(a.what),
    actionUrl: str(a.action_url),
    actionLabel: str(a.action_label),
    showCode: str(a.show_code),
    contactName: str(a.contact_name),
    contactEmail: str(a.contact_email),
    contactPhone: str(a.contact_phone),
    onsiteSupportPhone: str(a.onsite_support_phone),
    how: str(a.how),
    watchFor: str(a.watch_for),
    deadlines,
    documents: [],
    documentSources,
    formMissing:
      str(a.submit_by) !== null && !str(a.action_url) && documentSources.length === 0,
  };

  // An entity with none of this is not a service card, it is an empty box.
  const hasAnything =
    details.actionUrl || details.showCode || details.contactEmail ||
    deadlines.length > 0 || documentSources.length > 0;
  return hasAnything ? details : null;
}
