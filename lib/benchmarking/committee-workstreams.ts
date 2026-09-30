import { CAPABILITIES } from "@/lib/auth/capability-names";

/**
 * The committee's work, described for the people doing it.
 *
 * Each workstream is one capability plus everything a volunteer needs to act
 * on it without a phone call: what it is, why it matters, roughly how long,
 * when it happens, and how they will know they are done.
 */
export interface Workstream {
  capability: string;
  title: string;
  /** One line, for a list. */
  summary: string;
  /** What the person actually does, in their words not ours. */
  whatYouDo: string;
  /** Why it matters — volunteers give more when they know the stakes. */
  whyItMatters: string;
  timeCommitment: string;
  window: string;
  /** Where the work happens. */
  href: string;
  /** How "done" is measured, shown against live numbers. */
  doneWhen: string;
}

export const WORKSTREAMS: Workstream[] = [
  {
    capability: CAPABILITIES.BENCHMARKING_CONTENT_REVIEW,
    title: "Question review",
    summary:
      "Check the questions that caused trouble last year, and write the examples.",
    whatYouDo:
      "Work through twelve questions. For each, say whether the wording holds up, and if you can, write a worked example — “for us this is $X, which includes A and B but not C.” Made-up numbers are fine; it is the shape of the answer that matters. Everyone reviewing looks at the same twelve, which is how a question that reads two ways gets caught. If several of you land on the same problem, we will get the reviewers together to settle it; otherwise there is no meeting to attend.",
    whyItMatters:
      "A definition can be read two ways. An example from someone doing your job cannot. Last year several stores reported combined sales where we expected a split, and nothing in the response told us which — every institution had to be sorted out by hand.",
    // The call is not promised. It happens only if the reviews disagree, and
    // a firm "plus one 90-minute call" turns a 30-minute ask into a two-hour
    // one in the reader's head — which is how you lose a volunteer who had
    // the half hour to spare.
    timeCommitment: "About 30 minutes",
    window: "September, before the survey opens",
    href: "/benchmarking/review",
    doneWhen: "All twelve questions have a verdict from at least two reviewers",
  },
  {
    capability: CAPABILITIES.BENCHMARKING_QA_VERIFY,
    title: "Interpretation",
    summary: "Decide whether flagged numbers are real, a typo, or unusable.",
    whatYouDo:
      "As submissions arrive, the system flags anything unusual — a figure that jumped sharply, a margin outside the plausible range. You look at each one and pick: accept, follow up, or exclude. The store's own explanation is already attached, so most answer themselves.",
    whyItMatters:
      "When a store's numbers carry a note in a report the whole membership reads, that judgment should come from an elected peer rather than the office. It protects the data and it protects CSC.",
    timeCommitment: "45-minute briefing, then 2–3 hours spread out",
    window: "November and December, once collection closes",
    href: "/benchmarking/admin/flags",
    doneWhen: "Every flagged value has been resolved",
  },
  {
    capability: CAPABILITIES.BENCHMARKING_RECIPIENT_CONFIRM,
    title: "Recipient confirmation",
    summary: "Confirm who actually runs each store in your region.",
    whatYouDo:
      "You get a list of stores in your region with who we think runs each one. Confirm, correct, or say you don't know. “I don't know” is a completely acceptable answer and much better than a guess.",
    whyItMatters:
      "A survey that lands in the wrong inbox is a survey that doesn't get filled in. The stores we hear least from are the ones we know least about — so this is the difference between 37 responses and 52.",
    timeCommitment: "About 30 minutes for 8–12 stores",
    window: "October, during collection",
    href: "/benchmarking/recipients",
    doneWhen: "Every active member store has a confirmed respondent",
  },
  /*
    ⛔ This entry is the whole appointment mechanism, not a description of it.

    The capability, the role mapping, the survey unlock, the invitation guard
    and the wipe all existed and were all tested, and none of it was reachable:
    CommitteeConsole appoints by mapping this array, and app/benchmarking/page
    builds a volunteer's own task list by filtering it. Missing from here meant
    the lead had no control to appoint a beta tester, and anyone appointed by
    hand arrived at a page with nothing on it.

    Worse, it fails CLOSED and silently: orgsWithABetaTester blocks the going
    first invitation for every store with nobody appointed, so an unappointable
    capability meant a beta send that refused all of them.

    Beta testers are member stores rather than committee volunteers, which is a
    real difference and still not a reason for a second system. Appointment,
    notification and the task panel are identical, so it belongs in the one
    array. opensBenchmarkingAdmin deliberately does NOT include this capability:
    a tester gets the survey door, never the back office.
  */
  {
    capability: CAPABILITIES.BENCHMARKING_BETA_TESTER,
    title: "Beta testing",
    summary: "Fill in the survey before anyone else, and try to break it.",
    whatYouDo:
      "You get into the survey while it is still closed to everyone else, and you fill it in for your own store. It is your real submission: what you enter is what you have filed, so you will not be asked to do it twice. Anything that confuses you, flag it with the button in the bottom corner instead of guessing, and it comes straight to the committee lead. If you want to start again, there is a wipe at the foot of the form that clears your answers and leaves your store's locations, dates, people and logo where they are.",
    whyItMatters:
      "A question that reads two ways costs every store that answers it, and the cheapest moment to find one is before the survey opens. You are also the proof that the form holds up against a real set of books rather than test figures.",
    timeCommitment: "As long as your own survey takes, plus the breaking",
    window: "Early October, before the survey opens to everyone",
    href: "/benchmarking/survey",
    doneWhen: "Your submission is filed and anything unclear has been flagged",
  },
];

export function workstreamFor(capability: string): Workstream | undefined {
  return WORKSTREAMS.find((w) => w.capability === capability);
}
