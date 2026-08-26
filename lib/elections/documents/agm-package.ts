/**
 * The members' AGM package: what goes in it, and what is still missing.
 *
 * By-Law Part VII and the AGM script between them settle the contents. The
 * script already tells the chair "a copy of the statements is available in your
 * AGM package" — this is the thing that has to make that sentence true.
 *
 * The interesting output is NOT the assembled document. Most items are
 * generated from data we already hold and are never the hold-up; the package is
 * blocked by the one or two things a human has to produce — the reviewed
 * financial statements from the public accountant, last year's minutes being
 * approved, the treasurer's narrative. So this reports each item's state and
 * says plainly what is outstanding and who it is waiting on.
 *
 * Pure. Callers supply the facts; nothing here reads the database or the clock.
 */

export type PackageItemState =
  /** Generated from data we hold. Nothing to wait for. */
  | "generated"
  /** A file or content that exists. */
  | "supplied"
  /** Required and not here yet. */
  | "missing"
  /** Not required for this meeting. */
  | "not_applicable";

export interface PackageItem {
  key: string;
  title: string;
  state: PackageItemState;
  /** Why it is in the package — the by-law or practice that puts it there. */
  because: string;
  /** Who has to act, when something is missing. */
  waitingOn: string | null;
  /** Where it comes from, when it exists. */
  source: string | null;
}

export interface AgmPackageInput {
  cycleYear: number;
  agmDate: string;
  /** Fiscal year end the statements cover. */
  fiscalYearEnd: string;
  publicAccountant: string;
  /** Notice of meeting has been sent. */
  noticeSentAt: string | null;
  /** The meeting's agenda content, if written. */
  hasAgenda: boolean;
  /** Minutes of the PREVIOUS AGM, which this meeting approves. */
  priorAgmDate: string | null;
  hasPriorMinutes: boolean;
  /** A board_documents row of type `financials` on this meeting. */
  financialStatementsFilename: string | null;
  /** The nominating committee's report can be generated once nominations close. */
  nominationsClosed: boolean;
  candidateCount: number;
  /** Acclaimed slates have no ballot, so no candidate statements to circulate. */
  outcome: "acclaimed" | "balloted" | null;
  /** Proxy form is a Part VII S7 obligation with its own 30-day deadline. */
  proxyFormSentAt: string | null;
}

export interface AgmPackage {
  title: string;
  items: PackageItem[];
  /** Items in state "missing". */
  outstanding: PackageItem[];
  /** True when nothing required is missing. */
  complete: boolean;
  /** One sentence for the top of the admin screen. */
  summary: string;
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

export function buildAgmPackage(input: AgmPackageInput): AgmPackage {
  const items: PackageItem[] = [];

  items.push({
    key: "notice",
    title: "Notice of the annual general meeting",
    state: input.noticeSentAt ? "supplied" : "missing",
    because: "By-Law Part VII S4(b) — electronic notice, 21 to 35 days before the meeting.",
    waitingOn: input.noticeSentAt ? null : "the Executive Director, from the election screen",
    source: input.noticeSentAt ? `Sent ${longDate(input.noticeSentAt)}` : null,
  });

  items.push({
    key: "agenda",
    title: "Agenda",
    state: input.hasAgenda ? "supplied" : "missing",
    because: "Members are entitled to know what business the meeting will transact.",
    waitingOn: input.hasAgenda ? null : "the President, on the meeting record",
    source: input.hasAgenda ? "The meeting's agenda" : null,
  });

  // The meeting approves last year's minutes, so they have to be circulated with
  // the package rather than read aloud on the day.
  if (input.priorAgmDate) {
    items.push({
      key: "prior_minutes",
      title: `Minutes of the ${longDate(input.priorAgmDate)} annual general meeting`,
      state: input.hasPriorMinutes ? "supplied" : "missing",
      because: "This meeting is asked to approve them, so members must have read them first.",
      waitingOn: input.hasPriorMinutes ? null : "the Executive Director",
      source: input.hasPriorMinutes ? "The prior AGM's minutes" : null,
    });
  } else {
    items.push({
      key: "prior_minutes",
      title: "Minutes of the previous annual general meeting",
      state: "not_applicable",
      because: "No earlier AGM is on record for this association.",
      waitingOn: null,
      source: null,
    });
  }

  // The one item nothing here can produce. It comes from outside.
  items.push({
    key: "financials",
    title: `Reviewed financial statements, year ended ${longDate(input.fiscalYearEnd)}`,
    state: input.financialStatementsFilename ? "supplied" : "missing",
    because: `${input.publicAccountant} completes the review; the meeting receives and approves the statements.`,
    waitingOn: input.financialStatementsFilename
      ? null
      : `${input.publicAccountant}, then upload here`,
    source: input.financialStatementsFilename,
  });

  items.push({
    key: "nominating_report",
    title: "Report of the nominating committee",
    state: input.nominationsClosed ? "generated" : "missing",
    because: "By-Law Part V — the committee reports the slate it puts to the members.",
    waitingOn: input.nominationsClosed ? null : "nominations to close",
    source: input.nominationsClosed ? "Generated from the validated nominations" : null,
  });

  // Bios exist to inform a vote. An acclaimed slate has no vote, so circulating
  // candidate statements would be asking members to weigh a decision they are
  // not being given.
  if (input.outcome === "acclaimed") {
    items.push({
      key: "candidate_statements",
      title: "Candidate biographies and statements",
      state: "not_applicable",
      because: "The slate is acclaimed, so there is no ballot for these to inform.",
      waitingOn: null,
      source: null,
    });
  } else {
    items.push({
      key: "candidate_statements",
      title: "Candidate biographies and statements",
      state: input.candidateCount > 0 ? "generated" : "missing",
      because: "Members vote on the strength of these, so they travel with the package.",
      waitingOn: input.candidateCount > 0 ? null : "nominees to accept and supply a statement",
      source:
        input.candidateCount > 0
          ? `${input.candidateCount} candidate${input.candidateCount === 1 ? "" : "s"}`
          : null,
    });
  }

  items.push({
    key: "proxy_form",
    title: "Proxy form",
    state: input.proxyFormSentAt ? "supplied" : "missing",
    because:
      "By-Law Part VII S7(b) — members eligible to vote must have the form 30 days before the meeting.",
    waitingOn: input.proxyFormSentAt ? null : "the Executive Director, from the election screen",
    source: input.proxyFormSentAt ? `Sent ${longDate(input.proxyFormSentAt)}` : null,
  });

  const outstanding = items.filter((i) => i.state === "missing");
  const complete = outstanding.length === 0;

  const summary = complete
    ? `The ${input.cycleYear} AGM package is complete and can go to members.`
    : `${outstanding.length} item${outstanding.length === 1 ? "" : "s"} outstanding before the ${input.cycleYear} AGM package can go to members: ${outstanding
        .map((i) => i.title)
        .join("; ")}.`;

  return {
    title: `${input.cycleYear} Annual General Meeting — members' package`,
    items,
    outstanding,
    complete,
    summary,
  };
}
