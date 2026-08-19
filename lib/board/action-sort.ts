/**
 * Ordering for the board action-item checklist.
 *
 * The widget is a checklist, not a dashboard — the question is "what should
 * this person tick next", not "what is most important in the abstract".
 * See docs/BOARD_ACTION_ITEM_MINT.md §11.
 *
 * Pure functions. Policy constants are passed in so they can come from
 * app_settings without this module knowing about the database.
 */

export type ActionStatus = "open" | "in_progress" | "complete" | "deferred" | "intention";
export type Priority = "high" | "medium" | "low";

export interface SortableItem {
  id: string;
  status: ActionStatus;
  priority: Priority | null;
  /** YYYY-MM-DD, or null when the item has no deadline. */
  dueDate: string | null;
  startedAt: string | null;
  heldAt: string | null;
  /** Date of the meeting that raised it — the clock for aging. */
  raisedOn: string;
  assigneeCount: number;
  /** Used only for tier 5 adoptability. */
  titleLength: number;
  qualityFlagCount: number;
}

export interface SortPolicy {
  ageCeiling: number;
  ageTauDays: number;
  urgencyWindowDays: number;
  escalationMeetings: number;
  priorityWeights: Record<"high" | "medium" | "low" | "unset", number>;
}

export const DEFAULT_SORT_POLICY: SortPolicy = {
  ageCeiling: 0.5,
  ageTauDays: 60,
  urgencyWindowDays: 7,
  escalationMeetings: 3,
  // Unset sits between medium and high on purpose: an ungraded item should be
  // neither buried nor rewarded for having no grade.
  priorityWeights: { high: 3, medium: 2, low: 1, unset: 1.5 },
};

export const TIERS = [
  "running_out",
  "live_work",
  "stalled",
  "held",
  "unclaimed",
] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABELS: Record<Tier, string> = {
  running_out: "Running out of time",
  live_work: "In flight",
  stalled: "No date set",
  held: "On hold",
  unclaimed: "Unclaimed",
};

function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toISO.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Age multiplier, saturating toward 1 + ceiling.
 *
 * Linear aging is unbounded and lets an ancient low-value item outrank
 * something due on Friday. A hard cap creates a cliff where every old item
 * collapses to one identical score with no ordering left. The exponential
 * keeps separating them while earning most of its boost in the first month —
 * which is when a nudge can still work. After that, escalation takes over.
 */
export function ageBoost(daysOpen: number, policy: SortPolicy = DEFAULT_SORT_POLICY): number {
  if (daysOpen <= 0) return 1;
  return 1 + policy.ageCeiling * (1 - Math.exp(-daysOpen / policy.ageTauDays));
}

/**
 * How much of the runway is gone, 0..1. This is what the bar draws: it fills
 * as time runs out, so full means out of time, not nearly done.
 *
 * A held item freezes at the fill it had when it was held.
 */
export function runwayUsed(item: SortableItem, today: string): number {
  if (!item.dueDate) return 0;

  const asOf = item.heldAt ? item.heldAt.slice(0, 10) : today;
  const start = item.startedAt ? item.startedAt.slice(0, 10) : item.raisedOn;

  const total = daysBetween(start, item.dueDate);
  if (total <= 0) return 1;

  const elapsed = daysBetween(start, asOf);
  return Math.min(1, Math.max(0, elapsed / total));
}

export function tierOf(item: SortableItem, today: string, policy: SortPolicy): Tier {
  if (item.status === "deferred") return "held";
  if (item.status === "intention" || item.assigneeCount === 0) return "unclaimed";
  if (item.dueDate) {
    const daysLeft = daysBetween(today, item.dueDate);
    return daysLeft <= policy.urgencyWindowDays ? "running_out" : "live_work";
  }
  return "stalled";
}

function priorityWeight(priority: Priority | null, policy: SortPolicy): number {
  return policy.priorityWeights[priority ?? "unset"];
}

export interface ScoredItem {
  item: SortableItem;
  tier: Tier;
  tierIndex: number;
  score: number;
  daysOpen: number;
  runway: number;
  escalated: boolean;
}

/**
 * An item open across `escalationMeetings` board meetings is not urgent, it is
 * doubtful — the useful question is "is this still real", and that belongs on
 * an agenda rather than at the top of a list. So escalation is a flag, never a
 * boost: it must not let a stale item climb past live work.
 */
export function isEscalated(
  item: SortableItem,
  meetingDatesSince: string[],
  policy: SortPolicy
): boolean {
  if (item.status === "complete" || item.status === "deferred") return false;
  const meetingsElapsed = meetingDatesSince.filter((d) => d > item.raisedOn).length;
  return meetingsElapsed >= policy.escalationMeetings;
}

export function scoreItem(
  item: SortableItem,
  today: string,
  policy: SortPolicy = DEFAULT_SORT_POLICY
): Omit<ScoredItem, "escalated"> {
  const tier = tierOf(item, today, policy);
  const daysOpen = Math.max(0, daysBetween(item.raisedOn, today));
  const runway = runwayUsed(item, today);
  const weight = priorityWeight(item.priority, policy);

  let score: number;
  switch (tier) {
    case "running_out":
      // Soonest first. Age deliberately absent — nothing gets to jump the
      // queue here by being old.
      score = -daysBetween(today, item.dueDate as string) * 100 + weight;
      break;
    case "live_work":
      score = weight * (1 + runway) * ageBoost(daysOpen, policy);
      break;
    case "stalled":
      score = weight * ageBoost(daysOpen, policy);
      break;
    case "held":
      // Held work does not age: On Hold carries a stated reason, and aging it
      // would punish honesty and push people to rot in Not Started instead.
      score = weight;
      break;
    case "unclaimed":
      // Adoptability, not urgency — nobody owns these so nothing is late.
      // Short and well-formed first, so a volunteer gets a win.
      score = 1000 - item.titleLength - item.qualityFlagCount * 50;
      break;
  }

  return { item, tier, tierIndex: TIERS.indexOf(tier), score, daysOpen, runway };
}

/**
 * Order the checklist. Tiers are lexicographic — nothing ages into a higher
 * band, which is what stops a very old item outranking something due Friday.
 */
export function sortActionItems(
  items: SortableItem[],
  today: string,
  meetingDates: string[] = [],
  policy: SortPolicy = DEFAULT_SORT_POLICY
): ScoredItem[] {
  return items
    .map((item) => ({
      ...scoreItem(item, today, policy),
      escalated: isEscalated(item, meetingDates, policy),
    }))
    .sort((a, b) =>
      a.tierIndex !== b.tierIndex
        ? a.tierIndex - b.tierIndex
        : b.score - a.score || a.item.id.localeCompare(b.item.id)
    );
}

/** Due-date column text. Never blank — blank reads as broken. */
export function dueDateLabel(item: SortableItem, isStandingWork: boolean): string {
  if (item.dueDate) return item.dueDate;
  return isStandingWork ? "Ongoing" : "Open";
}
