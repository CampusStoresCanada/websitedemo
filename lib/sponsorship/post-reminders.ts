// Run daily from /api/cron/action-item-reminders, before it looks for due items.
import { createAdminClient } from "@/lib/supabase/admin";
import { getRenewalConfig } from "../policy/engine";
import { raiseAlertIfNotOpen } from "../ops/alerts";
import { resolveAgreementBenefits, type BenefitConfig } from "./types";

/**
 * The quarterly sponsored Circle post, as board action items.
 *
 * CSC owes the sponsor at most one post a quarter, up to the benefit's count.
 * Each quarter gets ONE action item, so the post rides everything action items
 * already do: the board checklist, the emailed "mark done" link, the reminder
 * cron, escalation. Marking it done is the count ticking: there is no second
 * tally to keep in step.
 *
 * Quarters are the membership year's (renewal.cycle_start_month_day, Sep 1):
 * Sep–Nov, Dec–Feb, Mar–May, Jun–Aug, so they line up with the term.
 *
 * The item is due 30 days before the quarter ends. The reminder cron fires its
 * usual N days ahead of that, to CSC's assignees, and for these items also
 * emails the sponsor (sponsorPostReminderEmail), so both sides hear about it
 * while there is still a month to post.
 *
 * Minted by the clock, one per quarter, not on completion like a recurring
 * item: the sponsor is owed a post each quarter whether or not last quarter's
 * went up. Capped twice over: never more items than the benefit's count, and
 * never past the agreement's end.
 */

export const SPONSOR_POST_BENEFIT_KEY = "circle_sponsored_post";
/** How long before the quarter ends the post is due. */
export const SPONSOR_POST_LEAD_DAYS = 30;
/** Who at CSC is assigned the post: app_settings, a JSON array of profile ids. */
export const SPONSOR_POST_ASSIGNEES_SETTING = "sponsorship_post_assignees";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface MembershipQuarter {
  /** YYYY-MM-DD, first day. */
  start: string;
  /** YYYY-MM-DD, last day. */
  end: string;
  /** "Dec 2026 – Feb 2027" style, for titles and email. */
  label: string;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The membership-year quarter `date` (YYYY-MM-DD) falls in. */
export function membershipQuarterFor(date: string, cycleStartMonthDay: string): MembershipQuarter {
  const [cm, cd] = cycleStartMonthDay.split("-").map(Number);
  const day = new Date(`${date}T00:00:00Z`);
  // The cycle start on or before `date`.
  let yearStart = new Date(Date.UTC(day.getUTCFullYear(), cm - 1, cd));
  if (yearStart > day) yearStart = new Date(Date.UTC(day.getUTCFullYear() - 1, cm - 1, cd));
  let start = yearStart;
  for (let q = 1; q < 4; q++) {
    const next = new Date(Date.UTC(yearStart.getUTCFullYear(), yearStart.getUTCMonth() + 3 * q, cd));
    if (next <= day) start = next;
  }
  const endExclusive = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, start.getUTCDate()));
  const end = new Date(endExclusive);
  end.setUTCDate(end.getUTCDate() - 1);
  const label = `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()} – ${MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`;
  return { start: iso(start), end: iso(end), label };
}

/**
 * When the quarter's post is due: 30 days before it ends. An agreement that
 * starts inside that last month is due at the quarter's end instead, so the
 * item is never born overdue.
 */
export function sponsorPostDueDate(quarter: MembershipQuarter, today: string): string {
  const due = new Date(`${quarter.end}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() - SPONSOR_POST_LEAD_DAYS);
  const dueIso = iso(due);
  return dueIso >= today ? dueIso : quarter.end;
}

/** The marker on the item (source_excerpt) that ties it to an agreement and quarter. */
export function sponsorPostMarker(agreementId: string, quarterStart: string): string {
  return `sponsor_post:${agreementId}:${quarterStart}`;
}

export function parseSponsorPostMarker(marker: string | null | undefined): { agreementId: string; quarterStart: string } | null {
  const m = /^sponsor_post:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/.exec(marker ?? "");
  return m ? { agreementId: m[1], quarterStart: m[2] } : null;
}

export interface SponsorPostSync {
  created: number;
  skipped: number;
}

/**
 * Make sure every live agreement owed a Circle post has this quarter's item.
 * Re-runnable: an agreement that already has an item for the quarter, or has
 * used up its count, is left alone.
 */
export async function syncSponsorPostActionItems(today: string = iso(new Date())): Promise<SponsorPostSync> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;
  const result: SponsorPostSync = { created: 0, skipped: 0 };

  const { data: agreements, error } = await db
    .from("sponsor_agreements")
    .select("id, organization_id, start_date, end_date, custom_benefits, tier:sponsor_tiers(benefits), organization:organizations(name)")
    .eq("status", "active")
    .lte("start_date", today)
    .gte("end_date", today);
  if (error) throw new Error(`Could not read agreements for sponsored posts: ${error.message}`);

  type AgreementRow = {
    id: string;
    organization_id: string;
    end_date: string;
    custom_benefits: BenefitConfig[] | null;
    tier?: { benefits?: BenefitConfig[] | null } | null;
    organization?: { name?: string } | null;
  };
  const owed = ((agreements ?? []) as AgreementRow[])
    .map((a) => ({
      agreement: a,
      benefit: resolveAgreementBenefits(a.tier?.benefits ?? [], a.custom_benefits ?? []).all.find(
        (b) => b.key === SPONSOR_POST_BENEFIT_KEY
      ),
    }))
    .filter((x): x is { agreement: AgreementRow; benefit: BenefitConfig } => !!x.benefit);
  if (owed.length === 0) return result;

  const { cycle_start_month_day } = await getRenewalConfig();
  const quarter = membershipQuarterFor(today, cycle_start_month_day);

  const [{ data: meeting }, { data: setting }] = await Promise.all([
    db
      .from("board_meetings")
      .select("id")
      .eq("status", "upcoming")
      .gte("meeting_date", today)
      .order("meeting_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    db.from("app_settings").select("value").eq("key", SPONSOR_POST_ASSIGNEES_SETTING).maybeSingle(),
  ]);
  if (!meeting) {
    // Every action item belongs to a meeting. Never invent one.
    await raiseAlertIfNotOpen({
      ruleKey: `sponsor_post_no_meeting:${quarter.start}`,
      severity: "warning",
      message: `Sponsored Circle posts for ${quarter.label} could not be put on the checklist: no upcoming board meeting is scheduled.`,
      details: { quarter_start: quarter.start, agreements: owed.map((o) => o.agreement.id) },
    });
    result.skipped += owed.length;
    return result;
  }
  let assignees: string[] = [];
  try {
    const parsed = JSON.parse(String(setting?.value ?? "[]"));
    if (Array.isArray(parsed)) assignees = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    assignees = [];
  }

  for (const { agreement, benefit } of owed) {
    const { data: existing } = await db
      .from("board_action_items")
      .select("id, status, source_excerpt")
      .eq("source", "sponsorship")
      .like("source_excerpt", `sponsor_post:${agreement.id}:%`);
    const items = ((existing ?? []) as Array<{ status: string; source_excerpt: string }>).filter(
      (i) => i.status !== "dropped"
    );
    const count = typeof benefit.config?.count === "number" && benefit.config.count > 0 ? benefit.config.count : 4;
    const marker = sponsorPostMarker(agreement.id, quarter.start);
    if (items.some((i) => i.source_excerpt === marker) || items.length >= count) {
      result.skipped += 1;
      continue;
    }

    const orgName = agreement.organization?.name ?? "Sponsor";
    const dueDate = sponsorPostDueDate(quarter, today);
    const { data: last } = await db
      .from("board_action_items")
      .select("sort_order")
      .eq("meeting_id", meeting.id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error: insertError } = await db.from("board_action_items").insert({
      meeting_id: meeting.id,
      title: `Sponsored Circle post: ${orgName} (${quarter.label})`,
      description:
        `${orgName}'s sponsorship includes one sponsored post in Circle from a CSC account each quarter ` +
        `(${items.length + 1} of ${count}). Post it before ${quarter.end}, then mark this done: that is the count. ` +
        `${orgName} gets a reminder email too if this is still open when the reminder goes out.`,
      assignees,
      due_date: dueDate,
      due_date_original: dueDate,
      status: "open",
      sort_order: ((last?.sort_order as number) ?? -1) + 1,
      source: "sponsorship",
      source_excerpt: marker,
    });
    if (insertError) throw new Error(`Could not add ${orgName}'s sponsored post item: ${insertError.message}`);
    result.created += 1;
  }
  return result;
}

/**
 * The email the sponsor gets when their quarter's post is still open at
 * reminder time. Member copy: speaks to them, no em dashes.
 */
export function sponsorPostReminderEmail(params: { orgName: string; quarter: MembershipQuarter }): {
  subject: string;
  html: string;
} {
  const { orgName, quarter } = params;
  return {
    subject: `Your sponsored Circle post for ${quarter.label.replace(" – ", " to ")}`,
    html:
      `<p>Hi ${escapeHtml(orgName)} team,</p>` +
      `<p>Your CSC sponsorship includes one sponsored post in our Circle community each quarter. ` +
      `We haven't shared yours for ${escapeHtml(quarter.label.replace(" – ", " to "))} yet.</p>` +
      `<p>Reply to this email with what you'd like us to post: a few lines of text, an image and a link if you have one. ` +
      `We'll post it from CSC's account before ${formatLongDate(quarter.end)}.</p>` +
      `<p>Thank you for supporting Campus Stores Canada.</p>`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatLongDate(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
