/**
 * Telling the membership who was elected.
 *
 * The wording here is doing real work, because By-Law Part V S3 splits the act
 * in a way it would be easy to get wrong:
 *
 *   (d) At the AGM, the Chair of the Nominating Committee ANNOUNCES the ballot
 *       results, or the acclaimed candidates.
 *   (e) At the AGM, the members SHALL THEN ELECT the directors who had the most
 *       votes, or the acclaimed directors.
 *
 * So the ballot does not elect anybody. It produces a result, which is announced
 * to the meeting, and the meeting elects. A message saying "X has been elected"
 * sent after the count but before the AGM would be false — the members had not
 * yet done the electing. Everything below is written in the past tense of a
 * meeting that has happened, and the sending path refuses to run before it has.
 *
 * Vote counts are deliberately absent. The by-law asks the Chair to announce the
 * results at the meeting; it does not ask the association to publish a ranking
 * afterwards, and a table of totals mailed to every member store is a different
 * act with a different effect on the people who came last. Turnout is included,
 * because it describes the membership rather than ranking the candidates.
 *
 * Pure. Callers supply the facts.
 */

export interface AnnouncedDirector {
  name: string;
  institution: string;
}

export interface ResultsAnnouncementInput {
  cycleYear: number;
  agmDate: string;
  outcome: "acclaimed" | "balloted";
  /** Directors the members elected at the meeting. */
  elected: AnnouncedDirector[];
  /** Directors with a year left to run. */
  continuing: AnnouncedDirector[];
  /** Completing a term and NOT standing again. Never those seeking re-election. */
  departing: AnnouncedDirector[];
  /** Ballots returned, for turnout. Null when acclaimed. */
  ballotsReturned: number | null;
  /** Institutions entitled to vote, for turnout. */
  electorateSize: number | null;
  /** The AGM at which these terms end — the second AGM following. */
  termEndsYear: number;
}

export interface ResultsAnnouncement {
  subject: string;
  /** Paragraphs of HTML, already escaped. */
  paragraphs: string[];
  html: string;
  /** Things a person should add before this goes out, if any. */
  outstanding: string[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function nameList(people: AnnouncedDirector[]): string {
  return people
    .map((p) => `<strong>${escapeHtml(p.name)}</strong> (${escapeHtml(p.institution)})`)
    .join("; ");
}

export function buildResultsAnnouncement(
  input: ResultsAnnouncementInput
): ResultsAnnouncement {
  const paragraphs: string[] = [];
  const outstanding: string[] = [];
  const meetingOn = longDate(input.agmDate);

  // Past tense throughout, and the members are the actor. Not "the ballot
  // elected", not "the results are in" — S3(e) makes the meeting the thing that
  // elects, and the sentence should say who did it.
  if (input.outcome === "acclaimed") {
    paragraphs.push(
      `At the annual general meeting on ${meetingOn}, the members elected the ` +
        `${input.cycleYear} Board of Directors by acclamation. The same number of nominees ` +
        `stood as there were seats, so no ballot was required.`
    );
  } else {
    paragraphs.push(
      `At the annual general meeting on ${meetingOn}, the Chair of the Nominating Committee ` +
        `announced the result of the ballot, and the members elected the ${input.cycleYear} ` +
        `Board of Directors.`
    );
  }

  if (input.elected.length > 0) {
    paragraphs.push(
      `<strong>Elected to the board:</strong> ${nameList(input.elected)}. ` +
        `Their two-year terms run to the annual general meeting in ${input.termEndsYear}.`
    );
  } else {
    outstanding.push("Nobody is recorded as elected — do not send this.");
  }

  if (input.continuing.length > 0) {
    paragraphs.push(
      `<strong>Continuing on the board</strong>, with a year left to serve: ` +
        `${nameList(input.continuing)}.`
    );
  }

  // Only people who completed a term and did not stand again. Getting this wrong
  // thanks a director for their service in the same message that announces their
  // re-election, so the caller is responsible for excluding anyone on the slate.
  if (input.departing.length > 0) {
    paragraphs.push(
      `The association thanks ${nameList(input.departing)}, whose service on the board ` +
        `concluded at this meeting.`
    );
  }

  if (
    input.outcome === "balloted" &&
    input.ballotsReturned !== null &&
    input.electorateSize !== null &&
    input.electorateSize > 0
  ) {
    const pct = Math.round((input.ballotsReturned / input.electorateSize) * 100);
    paragraphs.push(
      `${input.ballotsReturned} of ${input.electorateSize} member institutions returned a ` +
        `ballot — a turnout of ${pct}%.`
    );
  }

  paragraphs.push(
    `Our thanks to everyone who stood for election. Putting your name forward is a ` +
      `contribution to the association whatever the outcome.`
  );

  const subject =
    input.outcome === "acclaimed"
      ? `Your ${input.cycleYear} CSC Board, elected by acclamation`
      : `Your ${input.cycleYear} CSC Board`;

  return {
    subject,
    paragraphs,
    html: paragraphs.map((p) => `<p>${p}</p>`).join("\n"),
    outstanding,
  };
}
