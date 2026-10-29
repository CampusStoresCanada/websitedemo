import { createAdminClient } from "@/lib/supabase/admin";
import { formatDayMonth, parseSupabaseTimestamp, isValidDate } from "@/lib/time/supabase-timestamp";
import { abbreviateProvince } from "@/lib/constants/provinces";

/**
 * The travel-bursary review queue, for the admin console widget.
 *
 * The public side has been collecting these since August — "Register your
 * interest" on the member-facing conference hero writes a row per institution
 * — and until this widget there was no screen that read them back, so the only
 * way to see who had applied was SQL.
 *
 * ⚠️ These are registrations of interest, not scored applications. The CTA says
 * so on purpose: qualification criteria are the board's call, so a row carries
 * contact details and whatever the applicant chose to type, and nothing here
 * ranks, scores or sorts by merit. The widget's job is to show an officer who
 * is waiting and let them record a decision that a human made.
 *
 * The review vocabulary itself lives in ./bursary-status, which the client
 * widget can import without dragging the service-role client along with it.
 */

export interface BursaryApplicationRow {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string | null;
  /**
   * Two-letter code for the applying institution's province — the travel in
   * "travel bursary". Abbreviated here rather than in the widget because an
   * unrecognised value ("Out of Canada" is in real rows) comes back unchanged,
   * and the column that renders it has to be sized for that.
   */
  province: string | null;
  contactName: string;
  contactEmail: string;
  notes: string | null;
  /**
   * Raw stored status, not narrowed. The check constraint allows four values,
   * but a value that somehow isn't one of them must render as itself rather
   * than be relabelled into one that was never recorded.
   */
  status: string;
  /** "24 September", in Mountain time. Null if the timestamp won't parse. */
  submittedOn: string | null;
  /** When it arrived (ISO), for ordering beside other things people wait on. */
  createdAt: string;
  /** Whole days since it arrived. */
  daysWaiting: number;
  /**
   * The travel support request, once the school has submitted one. Null means
   * the row is still only a registration of interest.
   */
  request: {
    delegateName: string | null;
    delegateTitle: string | null;
    hotel: boolean;
    travel: boolean;
    payment: "reimburse" | "prepay" | null;
    /** "24 October", in Mountain time. */
    submittedOn: string | null;
  } | null;
}

export interface BursaryQueueData {
  conferenceId: string;
  conferenceName: string;
  rows: BursaryApplicationRow[];
}

type JoinedRow = {
  id: string;
  organization_id: string;
  contact_name: string;
  contact_email: string;
  notes: string | null;
  status: string;
  created_at: string;
  organizations: { name: string; slug: string | null; province: string | null } | null;
  requested_at: string | null;
  covers_hotel: boolean | null;
  covers_travel: boolean | null;
  payment_preference: "reimburse" | "prepay" | null;
  delegate: { name: string | null; role_title: string | null } | null;
};

function daysSince(createdAt: string): number {
  const parsed = parseSupabaseTimestamp(createdAt);
  if (!isValidDate(parsed)) return 0;
  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86_400_000));
}

/**
 * Every bursary application for one conference, oldest first.
 *
 * Oldest first on purpose: this is a queue, and the institution that has been
 * waiting since August is the one that should be at the top of it.
 *
 * The single read site for these rows — `listBursaryApplications` in
 * lib/actions/conference-bursary.ts delegates here rather than running its own
 * query, so there is one answer to "who applied".
 */
export async function loadBursaryApplications(
  conferenceId: string
): Promise<BursaryApplicationRow[]> {
  const db = createAdminClient();

  // The request columns (2026-10-28) are not in the generated types until
  // they are regenerated; same narrow shim the other new columns use.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as unknown as { from: (t: string) => any })
    .from("conference_bursary_applications")
    .select(
      "id, organization_id, contact_name, contact_email, notes, status, created_at, " +
        "requested_at, covers_hotel, covers_travel, payment_preference, " +
        "organizations(name, slug, province), delegate:contacts!conference_bursary_applications_delegate_contact_id_fkey(name, role_title)"
    )
    .eq("conference_id", conferenceId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to load bursary applications: ${error.message}`);

  return ((data ?? []) as unknown as JoinedRow[]).map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    organizationName: r.organizations?.name ?? "Unknown institution",
    organizationSlug: r.organizations?.slug ?? null,
    province: abbreviateProvince(r.organizations?.province) || null,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    notes: r.notes,
    status: r.status,
    submittedOn: formatDayMonth(r.created_at, "America/Edmonton"),
    createdAt: r.created_at,
    daysWaiting: daysSince(r.created_at),
    request: r.requested_at
      ? {
          delegateName: r.delegate?.name ?? null,
          delegateTitle: r.delegate?.role_title ?? null,
          hotel: r.covers_hotel === true,
          travel: r.covers_travel === true,
          payment: r.payment_preference,
          submittedOn: formatDayMonth(r.requested_at, "America/Edmonton"),
        }
      : null,
  }));
}

/**
 * Widget data for one conference.
 *
 * Takes the conference id rather than resolving "the current conference"
 * itself: the admin console already picked one at the top of the page, and a
 * widget that quietly answers about a different conference than the heading
 * beside it is worse than no widget.
 */
export async function getBursaryQueueData(
  conferenceId: string,
  conferenceName: string
): Promise<BursaryQueueData> {
  return {
    conferenceId,
    conferenceName,
    rows: await loadBursaryApplications(conferenceId),
  };
}
