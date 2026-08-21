/**
 * The Nominating Committee Report.
 *
 * Modelled on the report CSC actually issues (2026 edition, dated 15 September
 * 2025). Every fact in it is already in the system — who continues, whose term
 * ends, who has been nominated, how many seats remain, when nominations close —
 * so the whole document assembles, and the committee edits prose rather than
 * retyping a roster and getting a region wrong.
 *
 * Pure: takes facts, returns sections and HTML. The gathering lives in the
 * service; keeping this pure is what lets the wording be tested against the
 * real 2026 report without a database.
 *
 * Two things deliberately NOT generated:
 *  - The tribute to a retiring director. That is written about a person by
 *    someone who served with them, and a generated one would be worse than none.
 *  - The committee's balance criteria, which are quoted verbatim from the
 *    association's own report. They read as settled language, not something to
 *    be reworded annually by a machine.
 */

export interface ReportDirector {
  name: string;
  institution: string;
  region: "Eastern Region" | "Western Region" | "Region not recorded";
}

export interface ReportCandidate extends ReportDirector {
  /** True where the candidate currently sits and is standing again. */
  isIncumbent: boolean;
  /** Set where a candidate stands for something other than a full term. */
  termNote?: string | null;
}

export interface NominatingCommitteeReportInput {
  cycleYear: number;
  /** Date on the report itself. */
  reportDate: string;
  boardMinSeats: number;
  boardMaxSeats: number;
  seatsAvailable: number;
  nominationsCloseOn: string;
  nominationFormName: string;
  continuing: ReportDirector[];
  completing: ReportDirector[];
  candidates: ReportCandidate[];
  officerTitles: string[];
}

export interface ReportSection {
  heading: string | null;
  paragraphs: string[];
  roster?: ReportDirector[];
}

export interface NominatingCommitteeReport {
  title: string;
  meta: { label: string; value: string }[];
  sections: ReportSection[];
  /** Seats with no candidate standing. Stated plainly — it has happened. */
  vacancies: number;
  html: string;
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

function count(n: number): string {
  const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return words[n] ?? String(n);
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Alphabetical by last name, as the report states its own ordering to be. */
export function sortByLastName<T extends { name: string }>(people: T[]): T[] {
  const last = (n: string) => n.trim().split(/\s+/).slice(-1)[0]?.toLowerCase() ?? "";
  return [...people].sort((a, b) => last(a.name).localeCompare(last(b.name)));
}

export function buildNominatingCommitteeReport(
  input: NominatingCommitteeReportInput
): NominatingCommitteeReport {
  const nextYear = input.cycleYear + 1;
  const candidates = sortByLastName(input.candidates);
  const vacancies = Math.max(0, input.seatsAvailable - candidates.length);

  const sections: ReportSection[] = [
    {
      heading: null,
      paragraphs: [
        `As per the provisions of the CSC bylaws, the Board has established a slate of nominees for the vacant Director positions. The Board consists of a minimum of ${input.boardMinSeats} and a maximum of ${input.boardMaxSeats} Directors.`,
        "When seeking nominees, we try to balance the Board with representation from small, medium, and large schools, University and College representation, and provide a mix of Managers, Text Buyers, GM Buyers and when possible a Director who has the Bookstore under their portfolio.",
      ],
    },
    {
      heading: null,
      paragraphs: [
        `During ${input.cycleYear}-${nextYear}, the following Director${input.continuing.length === 1 ? "" : "s"} will serve the second year of a 2-year term on the Board:`,
      ],
      roster: input.continuing,
    },
    {
      heading: null,
      paragraphs: [
        `There ${input.completing.length === 1 ? "is one Director" : `are ${count(input.completing.length)} Directors`} completing ${input.completing.length === 1 ? "their term" : "their terms"} this year. ${input.completing.length === 1 ? "That Director is" : "Those Directors are"}:`,
      ],
      roster: input.completing,
    },
    {
      heading: null,
      paragraphs: [
        candidates.length === 0
          ? "No candidates have come forward to stand for election at this time."
          : `The following ${count(candidates.length)} candidate${candidates.length === 1 ? "" : "s"} (in alphabetical order by last name) ${candidates.length === 1 ? "is" : "are"} hereby presented to stand for ${candidates.every((c) => c.isIncumbent) ? "re-election" : "election"} to the CSC Board of Directors for a 2-year term (unless otherwise noted).`,
      ],
      roster: candidates,
    },
  ];

  if (vacancies > 0) {
    sections.push({
      heading: null,
      paragraphs: [
        `${count(vacancies).charAt(0).toUpperCase() + count(vacancies).slice(1)} vacant Director position${vacancies === 1 ? "" : "s"} remain${vacancies === 1 ? "s" : ""} open.`,
      ],
    });
  }

  sections.push(
    {
      heading: null,
      paragraphs: [
        `Additional nominations should be submitted using the ${input.nominationFormName}. Nominations should be submitted no later than ${longDate(input.nominationsCloseOn)}.`,
        "Should there be more candidates than available Director positions, a ballot will be undertaken in accordance with the by-laws. The results of the election will be announced at the Annual General Meeting and the Directors will take office at the conclusion of that meeting.",
      ],
    },
    {
      heading: null,
      paragraphs: [
        "In accordance with the bylaws, the following officers will be chosen by the Board of Directors each year:",
        input.officerTitles.join(" · "),
      ],
    }
  );

  const meta = [
    { label: "Date", value: longDate(input.reportDate) },
    { label: "To", value: "All CSC Members" },
    { label: "From", value: `The ${input.cycleYear} Nominating Committee` },
  ];

  const rosterHtml = (roster: ReportDirector[]) =>
    roster.length === 0
      ? ""
      : `<table style="border-collapse:collapse;margin:8px 0 16px">${roster
          .map(
            (d) =>
              `<tr><td style="padding:2px 24px 2px 0">${escapeHtml(d.name)}</td>` +
              `<td style="padding:2px 24px 2px 0">${escapeHtml(d.institution)}</td>` +
              `<td style="padding:2px 0">${escapeHtml(d.region)}</td></tr>`
          )
          .join("")}</table>`;

  const html =
    `<h1>Nominating Committee Report</h1>` +
    `<table style="border-collapse:collapse;margin-bottom:16px">${meta
      .map(
        (m) =>
          `<tr><td style="padding:2px 16px 2px 0"><strong>${escapeHtml(m.label)}:</strong></td>` +
          `<td style="padding:2px 0">${escapeHtml(m.value)}</td></tr>`
      )
      .join("")}</table>` +
    sections
      .map(
        (s) =>
          (s.heading ? `<h2>${escapeHtml(s.heading)}</h2>` : "") +
          s.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
          (s.roster ? rosterHtml(s.roster) : "")
      )
      .join("") +
    `<p>Respectfully Submitted,<br/>${input.cycleYear} Nominating Committee</p>`;

  return { title: "Nominating Committee Report", meta, sections, vacancies, html };
}
