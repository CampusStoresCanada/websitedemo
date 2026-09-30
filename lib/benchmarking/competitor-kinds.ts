/**
 * What kind of thing a member store is up against.
 *
 * ⛔ Plain module, not "use server" — see lib/benchmarking/location-kinds.ts.
 *
 * Kept short on purpose. The useful question is not the name of the shop but
 * whether the competition is a national chain, another part of the same
 * institution, or a website — those three behave completely differently and a
 * store's margin shows it.
 */
export const COMPETITOR_KINDS: { value: string; label: string; help: string }[] = [
  {
    value: "chain_bookstore",
    label: "Chain bookstore",
    help: "A national or regional bookseller within walking distance.",
  },
  {
    value: "online_retailer",
    label: "Online retailer",
    help: "Amazon and the like. Name it if one dominates in your market.",
  },
  {
    value: "student_union",
    label: "Student union shop",
    help: "Run by the students' association, on your campus.",
  },
  {
    value: "campus_department",
    label: "Another campus department",
    help: "A faculty, athletics or residence outlet selling what you sell.",
  },
  {
    value: "publisher_direct",
    label: "Publisher selling direct",
    help: "A publisher or courseware platform selling to your students without you.",
  },
  {
    value: "local_independent",
    label: "Local independent",
    help: "An independent shop nearby — books, apparel, supplies, technology.",
  },
  {
    value: "other",
    label: "Something else",
    help: "Anything else taking the same spend.",
  },
];
