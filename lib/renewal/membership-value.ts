/**
 * What a CSC membership actually carries, said in the renewal series.
 *
 * The renewal reminders were a clean invoice notice and nothing more: here is
 * your date, here is your amount, here is the button. That is fine for a utility
 * bill and wrong for an association whose whole argument is that it does things
 * no single store can do alone — the sector benchmarks, the salary survey, the
 * network, a vote in who runs it. None of that was being said at the one moment
 * of the year when every member is being asked to decide whether it is worth
 * paying for.
 *
 * The clause ESCALATES across the series, because the reader's situation does:
 *
 *   reminder  — before expiry. What the membership carries. Positive, factual.
 *   grace     — expired, still recoverable. What lapses, and on what date.
 *   locked    — stopped. What has stopped, and how to get it back.
 *
 * Rendered as a VARIABLE rather than a conditional block, because the comms
 * renderer's only conditional is `{{#if}}` against a flags map that
 * sendTransactional does not pass — see lib/elections/notify.ts for the same
 * constraint. An empty string is a legitimate value and renders as nothing.
 *
 * Pure. Callers supply the facts.
 */

export type RenewalStage = "reminder" | "grace" | "locked";

export interface MembershipValueInput {
  stage: RenewalStage;
  /** The date access stops if nothing is paid. Null where not yet determined. */
  lapsesOn: string | null;
  /**
   * An election whose nomination or voting window this member would lose by
   * lapsing. Null when no cycle is open — the clause must not invent one.
   */
  election: {
    cycleYear: number;
    nominationsOpenOn: string;
    nominationsCloseOn: string;
    agmDate: string;
    seatsAvailable: number;
  } | null;
  /** Absolute base URL, for the member-facing links. */
  appUrl: string;
}

function longDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * The standing benefits.
 *
 * This is the association's OWN approved language, lifted from the renewal
 * campaign sent 2025-11-05 ("Membership Renewal: The Value of Your CSC
 * Membership Year-Round"). Four pillars, each stated as what it does for the
 * reader rather than as a feature. Do not reword these without checking — they
 * were written and approved to be said to the whole membership.
 *
 * Two things deliberately NOT here:
 *  - The salary survey. Participation is not confirmed for this year, and a
 *    renewal notice is the last place to promise something that might not run.
 *  - Any split between "Circle" and "Member Space". They are the same thing.
 */
function benefits(appUrl: string): string[] {
  return [
    `<strong>A community that gets it.</strong> When you are navigating a tricky vendor situation, or your administration has questions about your store's future, you are not figuring it out alone. Your peers are in Circle, ready to share what worked — and what didn't — when they faced the same thing.`,
    `<strong>Data that proves your value.</strong> Our benchmarking data gives you the numbers you need when budget conversations happen. It is there when you need it, helping you demonstrate why your independent campus store matters to your institution.`,
    `<strong>Ongoing education.</strong> Monthly online sessions on the real issues you are facing right now — course materials, merchandising, operational efficiency. Learning doesn't stop after the conference.`,
    `<strong>Collective advocacy.</strong> When industry challenges affect us all, CSC speaks up on behalf of Canadian campus stores in ways no single store could manage alone.`,
    `<strong>The conference and trade show</strong> at member rates — though your membership is worth having whether you make it to the show or not.`,
    `<strong><a href="${appUrl}">The member platform</a></strong>: renew, register, and keep your institution's own information current in one place, alongside your store profile, the partner directory, and the resources behind the member login. Built for members, and still growing.`,
  ];
}

/** The election line, only ever rendered when a cycle is genuinely open. */
function electionLine(
  election: NonNullable<MembershipValueInput["election"]>,
  stage: RenewalStage
): string {
  const seats = `${election.seatsAvailable} seat${election.seatsAvailable === 1 ? "" : "s"}`;
  if (stage === "locked") {
    return (
      `<p><strong>The ${election.cycleYear} board election is under way.</strong> ${seats} are being filled at the annual general meeting on ` +
      `${longDate(election.agmDate)}. A suspended membership cannot nominate, second a nomination, or vote. ` +
      `Reactivating restores all three.</p>`
    );
  }
  return (
    `<p><strong>This year that includes the ${election.cycleYear} board election.</strong> Nominations are open ` +
    `${longDate(election.nominationsOpenOn)} to ${longDate(election.nominationsCloseOn)} for ${seats}, and every member store ` +
    `gets one vote. A membership that is not current on those dates cannot nominate anyone, cannot second a colleague's ` +
    `nomination, and cannot vote.</p>`
  );
}

export function buildMembershipValueHtml(input: MembershipValueInput): string {
  const list = `<ul style="margin:8px 0 16px;padding-left:20px">${benefits(input.appUrl)
    .map((b) => `<li style="margin-bottom:6px">${b}</li>`)
    .join("")}</ul>`;

  const election = input.election ? electionLine(input.election, input.stage) : "";

  if (input.stage === "reminder") {
    return (
      `<div style="border-top:1px solid #e5e7eb;margin-top:24px;padding-top:16px">` +
      `<h3 style="margin:0 0 8px">What your membership carries</h3>` +
      `<p style="margin:0 0 8px">We know budgets are under pressure across the sector, and we know the landscape is challenging. That is exactly why this community matters more than ever.</p>` +
      list +
      election +
      `</div>`
    );
  }

  if (input.stage === "grace") {
    const when = input.lapsesOn ? ` on <strong>${longDate(input.lapsesOn)}</strong>` : "";
    return (
      `<div style="border-top:1px solid #e5e7eb;margin-top:24px;padding-top:16px">` +
      `<h3 style="margin:0 0 8px">What lapses${when}</h3>` +
      list +
      election +
      `<p style="color:#6b7280;font-size:14px">If the invoice is held up somewhere on your side, tell us — we would far rather sort it out than switch anything off.</p>` +
      `</div>`
    );
  }

  return (
    `<div style="border-top:1px solid #e5e7eb;margin-top:24px;padding-top:16px">` +
    `<h3 style="margin:0 0 8px">What has stopped</h3>` +
    list +
    election +
    `<p style="color:#6b7280;font-size:14px">Reactivating restores everything above. Nothing has been deleted.</p>` +
    `</div>`
  );
}

/**
 * The election a lapsing member would be shut out of, if one is running.
 *
 * Deliberately a small standalone query rather than a call into
 * lib/elections/service: that module pulls the whole election machinery (and,
 * transitively, the mail sender) into the renewal cron, and the renewal job has
 * no business failing because an election module could not load.
 *
 * Returns null unless a cycle is genuinely open and still has something the
 * member could lose. The clause must never invent an election.
 */
export async function getOpenElectionForRenewal(): Promise<
  MembershipValueInput["election"]
> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  const { data } = await db
    .from("elections")
    .select("cycle_year, nominations_open_at, nominations_close_at, agm_date, seats_available, status")
    .in("status", ["draft", "nominating", "nominations_closed", "balloting"])
    .order("agm_date", { ascending: true })
    .limit(1);

  const e = data?.[0];
  if (!e) return null;

  // Past the AGM there is nothing left to lose by lapsing.
  const today = new Date().toISOString().slice(0, 10);
  if ((e.agm_date as string) < today) return null;

  return {
    cycleYear: e.cycle_year as number,
    nominationsOpenOn: e.nominations_open_at as string,
    nominationsCloseOn: e.nominations_close_at as string,
    agmDate: e.agm_date as string,
    seatsAvailable: e.seats_available as number,
  };
}
