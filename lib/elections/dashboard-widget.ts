/**
 * The elections widget's data.
 *
 * ⚠️ SECRECY: this feeds the admin console's front page, so it must never carry
 * anything about HOW an institution voted. It counts ballots returned and
 * nothing else — no selections, no per-candidate totals, not even a list of
 * which stores have voted. `election_participation` records that an institution
 * voted and when; that is deliberately a different table from the selections,
 * and only the count crosses into this module.
 *
 * The widget shows nominations while nominations are open and turnout while
 * voting is open, and returns null the rest of the year. One key rather than
 * two: only one of them can ever be live, and a dashboard that accumulates
 * empty slots is worse than one that changes shape.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getElection, evaluateElectionEligibility, listNominations } from "./service";

export interface ElectionsWidgetData {
  slug: string;
  cycleYear: number;
  seats: number;
  phase: "nominating" | "balloting";
  /** Days until the phase's deadline. Negative once past. */
  daysLeft: number;
  deadline: string;
  electorate: number;

  /** Nominating phase. */
  nominationsReceived: number;
  validatedNominees: number;
  incompleteNominations: number;

  /** Balloting phase. Counts only — never who, never how. */
  ballotsReturned: number;

  /**
   * Arrivals per day since the phase opened, oldest first. Nominations while
   * nominating; institutions casting their first ballot while balloting.
   *
   * ⚠️ For turnout this is WHEN institutions voted, aggregated to a day. That is
   * participation timing — already on the audit page as "that an institution
   * voted, and when it first did" — and a daily count is strictly less than
   * that. It says nothing about selections.
   */
  daily: { date: string; count: number }[];
  /** Arrivals in the last seven days. */
  recent7: number;
  /** Mean arrivals per day since the phase opened. */
  perDay: number;
  /**
   * Where the current pace lands by the deadline. Null until there is enough
   * to extrapolate from — a projection off one data point is a guess wearing a
   * number's clothes.
   */
  projected: number | null;
}

/** Daily buckets from `fromIso` to `today` inclusive, zero-filled. */
export function bucketByDay(
  timestamps: string[],
  fromIso: string,
  today: string
): { date: string; count: number }[] {
  const start = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const end = new Date(`${today}T00:00:00Z`).getTime();
  const days: { date: string; count: number }[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    days.push({ date: new Date(t).toISOString().slice(0, 10), count: 0 });
  }
  const index = new Map(days.map((d, i) => [d.date, i]));
  for (const ts of timestamps) {
    const i = index.get(ts.slice(0, 10));
    if (i !== undefined) days[i].count++;
  }
  return days;
}

export function summarise(
  daily: { date: string; count: number }[],
  total: number,
  daysLeft: number,
  ceiling: number | null
): { recent7: number; perDay: number; projected: number | null } {
  const recent7 = daily.slice(-7).reduce((n, d) => n + d.count, 0);
  const elapsed = Math.max(1, daily.length);
  const perDay = total / elapsed;

  // Two arrivals is the floor for a line rather than a point. Below that the
  // honest answer is "not yet", not a number.
  const projected =
    total < 2 || daysLeft <= 0
      ? null
      : Math.min(ceiling ?? Infinity, Math.round(total + perDay * daysLeft));

  return { recent7, perDay: Math.round(perDay * 10) / 10, projected };
}

function daysBetween(fromIso: string, toIso: string): number {
  const p = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(toIso) - p(fromIso)) / 86_400_000);
}

export async function getElectionsWidgetData(
  today: string
): Promise<ElectionsWidgetData | null> {
  const db = createAdminClient();

  // The live cycle, if there is one. Anything else — draft, sealed, certified —
  // has nothing a glanceable widget can usefully say.
  const { data: row } = await db
    .from("elections")
    .select("slug, status")
    .in("status", ["nominating", "balloting"])
    .order("agm_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!row) return null;

  const election = await getElection(row.slug as string);
  if (!election) return null;

  const { summary } = await evaluateElectionEligibility(election.id);
  const phase = election.status === "nominating" ? "nominating" : "balloting";

  if (phase === "nominating") {
    const nominations = await listNominations(election.slug);
    const validated = nominations.filter((n) => n.completeness.complete).length;

    const { data: created } = await db
      .from("nominations")
      .select("created_at")
      .eq("election_id", election.id);
    const daily = bucketByDay(
      (created ?? []).map((r) => r.created_at as string),
      election.schedule.nominationsOpenAt,
      today
    );
    const rate = summarise(
      daily,
      nominations.length,
      daysBetween(today, election.schedule.nominationsCloseAt),
      null
    );

    return {
      slug: election.slug,
      cycleYear: election.cycleYear,
      seats: election.seatsAvailable,
      phase,
      deadline: election.schedule.nominationsCloseAt,
      daysLeft: daysBetween(today, election.schedule.nominationsCloseAt),
      electorate: summary.eligible,
      nominationsReceived: nominations.length,
      validatedNominees: validated,
      incompleteNominations: nominations.length - validated,
      ballotsReturned: 0,
      daily,
      ...rate,
    };
  }

  // Turnout. A count of rows, nothing else — the selections live elsewhere and
  // are not read here.
  // first_cast_at only — when an institution voted, never what it chose.
  const { data: cast } = await db
    .from("election_participation")
    .select("first_cast_at")
    .eq("election_id", election.id);

  const count = (cast ?? []).length;
  const daily = bucketByDay(
    (cast ?? []).map((r) => r.first_cast_at as string).filter(Boolean),
    election.schedule.ballotsOpenAt,
    today
  );
  const rate = summarise(
    daily,
    count,
    daysBetween(today, election.schedule.ballotsCloseAt),
    summary.eligible
  );

  return {
    slug: election.slug,
    cycleYear: election.cycleYear,
    seats: election.seatsAvailable,
    phase,
    deadline: election.schedule.ballotsCloseAt,
    daysLeft: daysBetween(today, election.schedule.ballotsCloseAt),
    electorate: summary.eligible,
    nominationsReceived: 0,
    validatedNominees: 0,
    incompleteNominations: 0,
    ballotsReturned: count,
    daily,
    ...rate,
  };
}
