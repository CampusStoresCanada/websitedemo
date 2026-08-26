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

/**
 * Which programme the reader is in.
 *
 * The renewal run covers BOTH member stores and vendor partners — 43 partners
 * received the 14-day reminder this year. They are paying for entirely different
 * things, and the member benefits are not merely irrelevant to them but wrong:
 * partners do not receive benchmarking data (it is data ABOUT campus stores),
 * CSC does not advocate on their behalf, and they cannot nominate a director or
 * vote. Sending the member clause to a partner would tell 43 vendors they have a
 * vote they do not have.
 */
export type MembershipProgram = "member" | "partner";

export interface MembershipValueInput {
  stage: RenewalStage;
  /** Member store or vendor partner. They buy different things. */
  program: MembershipProgram;
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
function memberBenefits(appUrl: string): string[] {
  return [
    `<strong>A community that gets it.</strong> When you are navigating a tricky vendor situation, or your administration has questions about your store's future, you are not figuring it out alone. Your peers are in Circle, ready to share what worked — and what didn't — when they faced the same thing.`,
    `<strong>Data that proves your value.</strong> Our benchmarking data gives you the numbers you need when budget conversations happen. It is there when you need it, helping you demonstrate why your independent campus store matters to your institution.`,
    `<strong>Ongoing education.</strong> Monthly online sessions on the real issues you are facing right now — course materials, merchandising, operational efficiency. Learning doesn't stop after the conference.`,
    `<strong>Collective advocacy.</strong> When industry challenges affect us all, CSC speaks up on behalf of Canadian campus stores in ways no single store could manage alone.`,
    `<strong>The conference and trade show</strong> at member rates — though your membership is worth having whether you make it to the show or not.`,
    `<strong><a href="${appUrl}">The member platform</a></strong>: renew, register, and keep your institution's own information current in one place, alongside your store profile, the partner directory, and the resources behind the member login. Built for members, and still growing.`,
  ];
}

/**
 * What a vendor partner is actually paying for.
 *
 * Not the member list with the voting removed — a different relationship. A
 * partner buys reach into the sector: the show, the directory, the year-round
 * presence, and being asked when members are looking for something.
 */
function partnerBenefits(appUrl: string): string[] {
  return [
    `<strong>The trade show.</strong> The one time of year the Canadian campus store sector is in a room together, and the reason most partners are here.`,
    `<strong>A year-round listing</strong> in the <a href="${appUrl}/partners">partner directory</a> — what your store contacts see when they are looking for what you supply, not just in January.`,
    `<strong>Access to the community.</strong> Partners are in Circle alongside members, which is where a lot of the useful conversation actually happens.`,
    `<strong>Being asked.</strong> When members tell us what they are looking for, we come to our partners first.`,
    `<strong><a href="${appUrl}">The partner platform</a></strong>: your own profile, your booth and conference details, and the exhibitor checklist all in one place. Built this year, and still growing.`,
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
  const isMember = input.program === "member";
  const items = isMember ? memberBenefits(input.appUrl) : partnerBenefits(input.appUrl);
  const list = `<ul style="margin:8px 0 16px;padding-left:20px">${items
    .map((b) => `<li style="margin-bottom:6px">${b}</li>`)
    .join("")}</ul>`;

  // Governance belongs to member stores. A partner has no vote and no
  // nomination right, so the election line is never rendered for them.
  const election = isMember && input.election ? electionLine(input.election, input.stage) : "";

  if (input.stage === "reminder") {
    return (
      `<div style="border-top:1px solid #e5e7eb;margin-top:24px;padding-top:16px">` +
      `<h3 style="margin:0 0 8px">What your ${isMember ? "membership" : "partnership"} carries</h3>` +
      (isMember
        ? `<p style="margin:0 0 8px">We know budgets are under pressure across the sector, and we know the landscape is challenging. That is exactly why this community matters more than ever.</p>`
        : `<p style="margin:0 0 8px">Your partnership is how Canadian campus stores find you, and how we keep the sector talking to each other.</p>`) +
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
    // "draft" is deliberately NOT here. A draft election is one nobody has
    // pressed go on yet — the dates and seat count can still change, and the
    // term-limit reading that sets `seats_available` may not be settled. This
    // query feeds member-facing renewal email, and announcing nomination dates
    // to 30+ member stores is what makes them real. 2026-08-24: a draft row
    // created during the elections build would have put "nominations are open
    // September 23 to October 23 for 4 seats" into the day-7 reminder.
    // The clause appears when the cycle actually opens, not before.
    .in("status", ["nominating", "nominations_closed", "balloting"])
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


/**
 * Which programme an organization is in, for the purposes of this clause.
 *
 * Reads the configured programs rather than matching on the literal org type,
 * because `organizations.type` is capitalised ("Member" / "Vendor Partner") and
 * a lowercase comparison silently matches nothing. Anything that is not a
 * member-level program is treated as a partner — the safe direction, since the
 * partner clause promises less and claims no vote.
 */
export function resolveProgramFromOrgType(
  orgType: string | null | undefined,
  programs: { orgTypeValue: string; permissionLevel: string }[]
): MembershipProgram {
  const program = programs.find((p) => p.orgTypeValue === orgType);
  return program?.permissionLevel === "member" ? "member" : "partner";
}


/**
 * Which template a renewal message should use, given the programme.
 *
 * Kept beside the value clause because the two decisions have to agree: a
 * partner must get the partnership template AND the partner clause, and any
 * future call site that forgets one will be visibly wrong next to the other.
 */
export function renewalTemplateFor(
  stage: RenewalStage,
  program: MembershipProgram
): "renewal_reminder" | "grace_weekly_reminder" | "membership_locked"
  | "partnership_renewal_reminder" | "partnership_grace_reminder" | "partnership_suspended" {
  if (program === "partner") {
    return stage === "reminder"
      ? "partnership_renewal_reminder"
      : stage === "grace"
        ? "partnership_grace_reminder"
        : "partnership_suspended";
  }
  return stage === "reminder"
    ? "renewal_reminder"
    : stage === "grace"
      ? "grace_weekly_reminder"
      : "membership_locked";
}


/**
 * Everyone who has unsubscribed from everything.
 *
 * Renewal notices are transactional and legitimately bypass the suppression
 * list — a member who owes money is told they owe money regardless of their
 * marketing preferences. But the VALUE CLAUSE is not transactional. It is the
 * persuasion, and someone who has just hit unsubscribe has said plainly that
 * they do not want to be persuaded.
 *
 * So the two are split: the invoice notice still goes, the pitch does not. That
 * is the honest reading of both the obligation and the request, and it avoids
 * the situation this was written for — four vendor partners unsubscribed on
 * 2026-08-22, days after a reminder, with seven more sends still queued.
 */
export async function loadGloballySuppressedEmails(): Promise<Set<string>> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();
  const { data } = await db
    .from("comms_suppressions")
    .select("email")
    .eq("category", "all");
  return new Set((data ?? []).map((r) => (r.email as string).trim().toLowerCase()));
}
