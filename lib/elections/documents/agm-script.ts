/**
 * The AGM script.
 *
 * Modelled on the script CSC actually runs (2026 edition). The point of
 * generating it is not to write the meeting — it is to stop four people
 * retyping a roster, six timezone conversions, and four identical motion blocks
 * every January, and getting one of them wrong under time pressure.
 *
 * WHAT IS GENERATED: the frame. Dates and times across the country, the agenda,
 * who speaks, the motion choreography, the oath, the installation, the roster of
 * elected and continuing directors, the meeting mechanics.
 *
 * WHAT IS LEFT AS A PLACEHOLDER, deliberately: the President's Report, the
 * financial narrative, the tribute to a departing director, and the land
 * acknowledgement. Those are written by a person about people, and a generated
 * version would be both obvious and worse. They use the association's own
 * <<< ... >>> convention so they read as stage directions rather than as gaps
 * somebody forgot to fill.
 *
 * Pure. The Drive upload lives elsewhere.
 */

export interface ScriptPerson {
  name: string;
  institution: string;
}

export interface AgmScriptInput {
  cycleYear: number;
  agmDate: string;
  /** Local start times, in the association's usual order. */
  times: { label: string; start: string; end: string }[];
  meetingUrl: string | null;
  priorAgmDate: string | null;
  chair: ScriptPerson & { role: string };
  treasurer: ScriptPerson | null;
  nominatingChair: ScriptPerson | null;
  executiveDirector: string;
  /** Whoever runs the polls. Named in the script because the chair cues them. */
  pollster: string | null;
  publicAccountant: string;
  fiscalYearEnd: string;
  elected: ScriptPerson[];
  continuing: ScriptPerson[];
  departing: ScriptPerson[];
  /** True where the seats were filled without a ballot. */
  acclaimed: boolean;
  officerMeetingNote: string | null;
}

export interface ScriptBlock {
  /** Numbered agenda item, where it is one. */
  number: number | null;
  heading: string;
  speaker: string | null;
  lines: string[];
  /** Content a person must supply before the meeting. */
  needsHuman?: string;
}

export interface AgmScript {
  title: string;
  blocks: ScriptBlock[];
  /** Everything still to be written, for the covering note. */
  outstanding: string[];
  markdown: string;
}

function longDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Dates that are periods rather than occasions — a fiscal year end has no weekday. */
function plainDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * The motion choreography, which is identical every time it appears and appears
 * four times. Generating it is most of the reason this file exists.
 */
function motionBlock(motion: string, reader: string, pollster: string | null): string[] {
  return [
    `May I have a motion ${motion}`,
    "__________________________ so moves",
    "May I have a Seconder?",
    "__________________________ seconds the Motion.",
    "Is there any Discussion?",
    "<<< Discussion >>>",
    pollster
      ? `${pollster} will now open the vote for this Motion. Again, only the designated primary member representative for your store should vote.`
      : "The vote will now be opened for this Motion. Again, only the designated primary member representative for your store should vote.",
    "<<< Wait 15 seconds for members to vote >>>",
    pollster ? `${pollster}, please close the vote and share the results.` : "Please close the vote and share the results.",
    `<<< ${reader} to read the results >>>`,
    "I declare the Motion carried.",
  ];
}

export function buildAgmScript(input: AgmScriptInput): AgmScript {
  const chair = input.chair.name.split(" ")[0];
  const treasurer = input.treasurer?.name.split(" ")[0] ?? "the Treasurer";
  const nomChair = input.nominatingChair?.name.split(" ")[0] ?? "the Past President";
  const ed = input.executiveDirector.split(" ")[0];
  const outstanding: string[] = [];
  const blocks: ScriptBlock[] = [];

  blocks.push({
    number: null,
    heading: "Introductions and pre-meeting housekeeping",
    speaker: input.chair.name,
    lines: [
      "Hello everyone,",
      `On behalf of CSC's Board of Directors, I would like to welcome you to our ${input.cycleYear} Annual General Meeting.`,
      `My name is ${input.chair.name}. I am from ${input.chair.institution}, and I currently serve as ${input.chair.role} of Campus Stores Canada. I will be chairing today's meeting.`,
      "Before we get started, I would like to acknowledge the lands on which I am situated.",
      `<<< LAND ACKNOWLEDGEMENT — ${input.chair.institution}'s own wording >>>`,
      "I have recognized the land that I am on but would also ask you to take a moment to reflect on the indigenous lands you are joining from.",
      "I have a few housekeeping items to run through before we call the meeting to order.",
      "Only the designated primary member from your store can vote during this meeting. Generally, that is the store manager or director.",
      "If you are not the designated primary member from your store, please don't vote.",
      "Each member store is entitled to one vote on matters brought before this meeting.",
      "When a Motion is put before the membership, we need one member to make the motion and another to second it. When making a motion or seconding it, please unmute yourself and state your name and institution.",
      `When we call for the vote on the Motion, a poll will be launched where you can vote yes, no, or abstain.${input.pollster ? ` ${input.pollster} will launch each poll when the vote is called.` : ""} We will give you about 15-20 seconds to vote.`,
      `Copies of the agenda and supporting documents were sent to all primary member contacts prior to the meeting. If you don't recall receiving a copy of the AGM package, please email ${ed} and he will send you a copy following the meeting.`,
      'If you have any questions or wish to make any comments during the meeting, please use the "Raise Hand" tool. When you speak, please announce your name and institution for those that may not know you.',
      "Does anyone have any questions now about the voting procedures and instructions for this meeting?",
      "<<< QUESTIONS >>>",
    ],
    needsHuman: "Land acknowledgement for the chair's institution",
  });
  outstanding.push(`Land acknowledgement in ${input.chair.institution}'s own wording`);

  blocks.push({
    number: 1,
    heading: "Call to Order",
    speaker: input.chair.name,
    lines: [
      `I will now formally call the ${input.cycleYear} Annual General Meeting of Campus Stores Canada to order. It is ____________.`,
      "Our Executive Director informs me that we have a quorum of eligible members present in person or by proxy, and therefore we have a legally constituted meeting in accordance with the bylaws of the organization.",
    ],
  });

  if (input.priorAgmDate) {
    blocks.push({
      number: 2,
      heading: "Receipt of Minutes",
      speaker: input.chair.name,
      lines: [
        `The first order of business is to receive the minutes of the annual general meeting held on ${longDate(input.priorAgmDate)}. These minutes are available in the meeting package.`,
        `<<< ${ed} to scroll through the minutes >>>`,
        ...motionBlock(
          `to receive and accept the minutes of the ${longDate(input.priorAgmDate)} Annual General Meeting?`,
          input.chair.name,
          input.pollster
        ),
      ],
    });
  }

  blocks.push({
    number: 3,
    heading: "President's Report",
    speaker: input.chair.name,
    lines: [
      "We will now move to the next item in the agenda and that's my President's Report.",
      "<<< INSERT PRESIDENT'S REPORT HERE >>>",
      "Does anyone have any questions?",
      "<<< Questions >>>",
      input.treasurer ? `I now invite our Treasurer, ${input.treasurer.name}, to present the Treasurer's Report. ${treasurer} …` : "",
    ].filter(Boolean),
    needsHuman: "President's Report",
  });
  outstanding.push("President's Report");

  blocks.push({
    number: 4,
    heading: "Treasurer's Report",
    speaker: input.treasurer?.name ?? "Treasurer",
    lines: [
      `Thank you ${chair} and hello everyone.`,
      `The association's public accountant, ${input.publicAccountant}, was appointed last year to complete the review of the financial statements for the year ended ${plainDate(input.fiscalYearEnd)}.`,
      "A copy of the statements is available in your AGM package.",
      `I will now call on ${input.executiveDirector} to go through the reviewed year-end financial statements.`,
      "",
      `— ${input.executiveDirector}:`,
      `Thank you ${treasurer}. I will share my screen so you can view the financial statements as I go through them.`,
      "<<< INSERT FINANCIAL REPORT NARRATIVE — statement of financial position, statement of operations, and the year's story >>>",
      "That concludes the financial report. Are there any questions?",
      "<<< Questions >>>",
      "",
      `— ${input.treasurer?.name ?? "Treasurer"}:`,
      ...motionBlock(
        `that the financial statements for the year ending ${plainDate(input.fiscalYearEnd)} be received and approved as presented.`,
        input.treasurer?.name ?? "the Treasurer",
        input.pollster
      ),
    ],
    needsHuman: "Financial report narrative",
  });
  outstanding.push(`Financial report narrative for the year ended ${plainDate(input.fiscalYearEnd)}`);

  blocks.push({
    number: 5,
    heading: "Appointment of Public Accountant",
    speaker: input.treasurer?.name ?? "Treasurer",
    lines: [
      "We now must appoint the public accountant who will review our financials for the coming year. Under the Canada Not-For-Profit Act, we are required to appoint a public accountant at each annual meeting to conduct a review engagement of CSC's finances.",
      "A review engagement is the process of engaging an independent public accountant to prepare financial statements on a review basis. The accountant will not express an opinion on the fairness of the financial statements but will provide a limited assurance that the financial information is plausible and conforms to generally accepted accounting principles.",
      `The CSC Board of Directors is proposing that members appoint ${input.publicAccountant} once again as CSC's public accountant.`,
      ...motionBlock(
        `to appoint ${input.publicAccountant} as CSC's public accountant to conduct a Review for the coming fiscal year.`,
        input.treasurer?.name ?? "the Treasurer",
        input.pollster
      ),
      `I will now turn things back to ${chair}.`,
    ],
  });

  const nominatingLines: string[] = [`Thank you ${chair}.`];
  if (input.departing.length) {
    nominatingLines.push(
      `Before I go into the Nominating Report, I want to take a moment to recognize ${input.departing.map((d) => `${d.name} of ${d.institution}`).join(", and ")}, who ${input.departing.length === 1 ? "is" : "are"} stepping down from the Board this year.`,
      "<<< INSERT TRIBUTE — years served, committees, what they brought to the table >>>"
    );
    outstanding.push(
      `Tribute for ${input.departing.map((d) => d.name).join(", ")} (departing)`
    );
  }
  nominatingLines.push(
    "As per the provisions of the CSC bylaws, the Board established a slate of nominees for the vacant Director positions.",
    "When seeking nominees, we try to balance the Board with representation from small, medium and large schools, Universities and Colleges, and we look for a mix of Managers, Text Buyers, GM Buyers and when possible a Director who has the Bookstore under their portfolio.",
    input.elected.length === 0
      ? "<<< RESULTS NOT YET KNOWN — this section fills in once the election is certified. Do not read it as written. >>>"
      : input.acclaimed
        ? "No additional nominations were received beyond the slate, so the following candidates are acclaimed."
        : "An election was held, and I would now like to give you the results and introduce your incoming Campus Stores Canada Board of Directors.",
    "As it's hard in this format to ask our Board members to stand up, I will ask the Board to wave their hands to identify themselves.",
    ...(input.elected.length === 0
      ? []
      : [
          `I'll start by introducing our ${input.elected.length} ${input.acclaimed ? "acclaimed" : "elected"} Board member${input.elected.length === 1 ? "" : "s"} (in order by last name).`,
          ...input.elected.map((p) => `   ${p.name}, ${p.institution}`),
          "Congratulations everyone!",
        ]),
    "Our continuing Board members are (in no particular order):",
    ...input.continuing.map((p) => `   ${p.name}, ${p.institution}`),
    `I will now pass things over to ${ed} who will install our Board of Directors.`
  );

  if (input.elected.length === 0) {
    outstanding.push("Election results (fills in once the election is certified)");
  }

  blocks.push({
    number: 6,
    heading: "Nominating Committee Report",
    speaker: input.nominatingChair?.name ?? "Past President",
    lines: nominatingLines,
    needsHuman: input.departing.length ? "Tribute for departing director(s)" : undefined,
  });

  blocks.push({
    number: null,
    heading: "Board of Directors Installation and Oath of Office",
    speaker: input.executiveDirector,
    lines: [
      `Thank you ${nomChair}, and congratulations to our Board. It is my pleasure and privilege to now officially install the Board of Directors of Campus Stores Canada.`,
      "These individuals have dedicated the coming year to work on behalf of the membership, your association, and on behalf of the general public to whom we all serve. The success of this association however, is not limited to the actions of the Board of Directors. While they pledge their commitment to the advancement of this association, they will require the support of the entire membership in order to fulfill the goals and objectives of CSC.",
      "I invite the newly elected CSC Board of Directors to take their oath of office. I will read it out, and Board members, say Yes when prompted.",
      "",
      "Do you, in the presence of those assembled here, promise to faithfully perform to the best of your ability, all of the duties and obligations pertaining to this office in which you now serve?",
      "And will you conform to, and carry out the Bylaws of Campus Stores Canada, and will you always place the interest of the association before your own?",
      "<< YES >>",
      "",
      "It's that simple. Everyone, please follow me in congratulating our Board of Directors.",
      "{Applause}",
      input.officerMeetingNote ??
        "Under the provisions of our bylaws, the Board of Directors elect the Officers of the Board. The Board will appoint the Officers at its next meeting, and members will be informed following that.",
      `I would like to turn things back over to ${chair} to help us wrap up.`,
    ],
  });

  blocks.push({
    number: 7,
    heading: "Other Business",
    speaker: input.chair.name,
    lines: [
      `Thank you ${ed}!`,
      "Our last agenda item is Other Business. Is there any other business that members would like to raise in this meeting? If so, please raise your virtual hand. When called upon, state your name and institution before asking your question or before making a comment.",
      "<<< Other Business / Q&A Session >>>",
    ],
  });

  blocks.push({
    number: 8,
    heading: "Adjournment",
    speaker: input.chair.name,
    lines: [
      "Everyone… this concludes our Annual General Meeting.",
      `May I have a motion to terminate the ${input.cycleYear} Annual General Meeting of Campus Stores Canada.`,
      "__________________________ so moves",
      "May I have a Seconder?",
      "__________________________ seconds the Motion.",
      "All in favour – just raise your hands.",
      "Anyone opposed?",
      "I declare the Motion carried.",
      "Thank you everyone. The meeting is adjourned.",
    ],
  });

  // Renumber by what is present. A script that jumps from 1 to 3 because there
  // was no prior meeting to receive minutes from reads as a mistake.
  let n = 0;
  for (const b of blocks) if (b.number !== null) b.number = ++n;

  const agenda = blocks
    .filter((b) => b.number !== null)
    .map((b) => `${b.number}. ${b.heading}`);

  const header = [
    `# Script — Annual General Meeting`,
    ``,
    `**${longDate(input.agmDate)}**`,
    ``,
    ...input.times.map((t) => `- ${t.label} — ${t.start} – ${t.end}`),
    input.meetingUrl ? `\nMeeting login: ${input.meetingUrl}` : "",
    ``,
    `Speaking: ${[input.chair.name, input.treasurer?.name, input.nominatingChair?.name, input.executiveDirector]
      .filter(Boolean)
      .join(", ")}${input.pollster ? ` · Polls: ${input.pollster}` : ""}`,
    ``,
    `## Agenda`,
    ``,
    ...agenda.map((a) => `${a}`),
    ``,
    `> ${outstanding.length} section${outstanding.length === 1 ? "" : "s"} still to be written before the meeting: ${outstanding.join("; ")}.`,
    ``,
  ].join("\n");

  const markdown =
    header +
    blocks
      .map((b) => {
        const title = b.number ? `## ${b.number}. ${b.heading}` : `## ${b.heading}`;
        const who = b.speaker ? ` — ${b.speaker}` : "";
        return `${title}${who}\n\n${b.lines.join("\n\n")}\n`;
      })
      .join("\n");

  return { title: `${input.cycleYear} AGM Script`, blocks, outstanding, markdown };
}
