/**
 * When a ghost is allowed to post.
 *
 * Two classes, split by a single question: **does delay change the meaning?**
 *
 *   TIMELY  — a board vote opening, a closing tally, a deadline reminder.
 *             Delay breaks them. Exempt from the caps below; they go when
 *             they go.
 *   AMBIENT — a new-partner announcement, a digest. News rather than a
 *             prompt. Everything below applies.
 *
 * The guardrail is a per-day ceiling, not a per-minute interval. Attention is
 * consumed per day: five posts two minutes apart is still five notifications
 * in ten minutes, which staggers the sending without protecting the reading.
 *
 * Minimum spacing is not implemented here on purpose. If the caller releases
 * at most one queued item per cron tick, the cron interval *is* the spacing —
 * with no timer and no last-posted bookkeeping to drift.
 */

import { isBusinessDay, BOARD_TIMEZONE } from "@/lib/board/vote-schedule";

export type PostingClass = "timely" | "ambient";

export type PipelineKey = "new_partner" | "board_recap";

/**
 * Which class each pipeline belongs to.
 *
 * `board_recap` is TIMELY: one recap a month into a private board space, read
 * by twelve people who were in the room. Delay is the only thing that could
 * spoil it, and the daily caps below exist to protect member attention from
 * ambient news — a different problem entirely. Timely pipelines never call
 * `canPublishAmbient`, so the cap entry for them is inert; it exists so the
 * Record stays exhaustive and a new pipeline cannot be added without deciding
 * which class it is.
 */
export const PIPELINE_CLASS: Record<PipelineKey, PostingClass> = {
  new_partner: "ambient",
  board_recap: "timely",
};

/**
 * The window a post may land in, local Eastern. Outside it the item simply
 * waits — a 3am announcement is worse than one at a predictable 9am.
 */
export const RELEASE_WINDOW_START_HOUR = 9;
export const RELEASE_WINDOW_END_HOUR = 15;

/** Ghost posts allowed into one space per day, across every pipeline. */
export const SPACE_DAILY_CEILING = 3;

/** Per-pipeline daily caps. Sit underneath the space ceiling. */
export const PIPELINE_DAILY_CAP: Record<PipelineKey, number> = {
  new_partner: 1,
  // Inert — board_recap is timely and never reaches canPublishAmbient.
  board_recap: 1,
};

/**
 * A stable 32-bit hash of a string. djb2 — small, deterministic, and identical
 * across runs and platforms, which is what matters here: the release time must
 * not change between ticks on the same day or an item could be published twice
 * or never.
 */
function stableHash(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Today's release time for a pipeline, as minutes past midnight Eastern.
 *
 * Derived from the date so it is stable all day but different tomorrow — the
 * point being that Helpful Ghost should not post at exactly hh:00:00 like a
 * machine. Deterministic rather than random on purpose: `Math.random()` would
 * give a different answer on every tick, so an item might publish at 09:05 one
 * minute and be told to wait until 14:20 the next.
 */
export function releaseMinuteOfDay(civilDate: string, pipeline: PipelineKey): number {
  const windowMinutes = (RELEASE_WINDOW_END_HOUR - RELEASE_WINDOW_START_HOUR) * 60;
  const offset = stableHash(`${civilDate}:${pipeline}`) % windowMinutes;
  return RELEASE_WINDOW_START_HOUR * 60 + offset;
}

export interface PostingWindowInput {
  /** Evaluated in the association's civil timezone, not the server's. */
  now: Date;
  pipeline: PipelineKey;
  /** Ghost posts already made into this space today, all pipelines. */
  postsToSpaceToday: number;
  /** Posts already made today by this pipeline. */
  postsInPipelineToday: number;
}

export type PostingDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
      /**
       * `next_business_day` — nothing more goes today.
       * `retry_later` — the caller may try again on a later tick (currently
       * unused; every ambient block is day-scoped, but a future per-hour rule
       * would use it).
       */
      retry: "next_business_day" | "retry_later";
    };

/** Minutes past midnight in the association's timezone. */
function civilMinuteOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BOARD_TIMEZONE,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute");
}

/** The calendar date in the association's timezone, as parts. */
function civilDateParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOARD_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * May an ambient post go out right now?
 *
 * Timely posts do not call this — they are exempt by definition. Keeping the
 * exemption at the call site rather than as a branch in here makes it obvious
 * in the caller which class it is publishing.
 */
export function canPublishAmbient(input: PostingWindowInput): PostingDecision {
  const { year, month, day } = civilDateParts(input.now);

  if (!isBusinessDay(year, month, day)) {
    return {
      allowed: false,
      reason:
        "Ambient ghost posts only go out on business days — not weekends or national holidays.",
      retry: "next_business_day",
    };
  }

  if (input.postsToSpaceToday >= SPACE_DAILY_CEILING) {
    return {
      allowed: false,
      reason: `The space has already had ${input.postsToSpaceToday} ghost posts today (ceiling ${SPACE_DAILY_CEILING}).`,
      retry: "next_business_day",
    };
  }

  // Wait until today's (pseudo-random, stable) release moment. With a cron
  // ticking every 15 minutes this lands the post at a different time each day
  // rather than on the stroke of the hour.
  const civilDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const target = releaseMinuteOfDay(civilDate, input.pipeline);
  const nowMinutes = civilMinuteOfDay(input.now);
  if (nowMinutes < target) {
    const hh = String(Math.floor(target / 60)).padStart(2, "0");
    const mm = String(target % 60).padStart(2, "0");
    return {
      allowed: false,
      reason: `Waiting until today's release time (${hh}:${mm} ET) so posts don't all land on the hour.`,
      retry: "retry_later",
    };
  }

  const cap = PIPELINE_DAILY_CAP[input.pipeline];
  if (input.postsInPipelineToday >= cap) {
    return {
      allowed: false,
      reason: `The ${input.pipeline} pipeline has already posted ${input.postsInPipelineToday} time(s) today (cap ${cap}).`,
      retry: "next_business_day",
    };
  }

  return { allowed: true };
}

/**
 * The UTC instant range covering "today" in the association's timezone.
 *
 * Counting today's posts with a naive `>= now - 24h` would let a post made at
 * 4pm yesterday suppress one at 9am today. Callers should count within these
 * bounds instead.
 */
export function civilDayBounds(now: Date): { startUtc: string; endUtc: string } {
  const { year, month, day } = civilDateParts(now);
  // Reuse the vote-schedule zoned conversion via a local import would create a
  // cycle; compute directly. Midnight-to-midnight in the civil zone.
  const startLocal = Date.UTC(year, month - 1, day, 0, 0, 0);
  const probe = new Date(startLocal);
  const offset = offsetMs(probe, BOARD_TIMEZONE);
  const start = new Date(startLocal - offset);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );
  return asUtc - instant.getTime();
}
