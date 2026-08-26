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
      "Work through twelve questions. For each, say whether the wording holds up, and if you can, write a worked example — “for us this is $X, which includes A and B but not C.” Made-up numbers are fine; it is the shape of the answer that matters.",
    whyItMatters:
      "A definition can be read two ways. An example from someone doing your job cannot. Last year several stores reported combined sales where we expected a split, and nothing in the response told us which — every institution had to be sorted out by hand.",
    timeCommitment: "About 30 minutes, plus one 90-minute call",
    window: "September, call in the week of the 29th",
    href: "/benchmarking/review",
    doneWhen: "All twelve questions have a verdict from at least two reviewers",
  },
  {
    capability: CAPABILITIES.BENCHMARKING_QA_VERIFY,
    title: "QA verification",
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
];

export function workstreamFor(capability: string): Workstream | undefined {
  return WORKSTREAMS.find((w) => w.capability === capability);
}
