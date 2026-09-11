/**
 * Why people stand for the CSC board, and what it costs them.
 *
 * Taken from CSC's own "Benefits of Becoming a Board Member" (2019), which had
 * sat in the AGM folder for seven years without ever reaching a member. The
 * elections module was built from By-Law No. 1 — every gate and refusal traces
 * to a clause in Part V or VII — and the by-law describes a procedure, not a
 * reason to take part. So the software could run a faultless election that
 * never told anyone why they might want to be in it.
 *
 * Kept as data rather than markup so the nomination page, the call email and
 * anything later all say the same thing. The wording is CSC's, condensed for
 * the web; it is not rewritten, because the case for serving is theirs to make.
 *
 * ⚠️ The considerations are not padding and should not be quietly dropped to
 * make the pitch cleaner. The source document raises time and responsibility
 * itself, and a recruitment page that only lists upsides reads as a sales page
 * — which is precisely what stops the cautious, capable people this is meant
 * to reach.
 */

export interface BoardServicePoint {
  label: string;
  detail: string;
}

export const BOARD_SERVICE_BENEFITS: BoardServicePoint[] = [
  {
    label: "Connections",
    detail:
      "Working with other board members, sitting on committees and representing the association opens you up to a whole new network of contacts.",
  },
  {
    label: "Credibility",
    detail:
      "A position on the board is a public endorsement of your value — an affiliation you can be proud to share.",
  },
  {
    label: "Recognition",
    detail: "Recognition for you, for your store, and for your institution.",
  },
  {
    label: "Build your skill set",
    detail:
      "You will hone the skills you already have and build new ones worth adding to your CV.",
  },
  {
    label: "Exposure",
    detail:
      "You will see things happening across the campus store industry that you would otherwise know nothing about.",
  },
  {
    label: "Context",
    detail:
      "A new level of appreciation for the different groups and people who make this industry strong.",
  },
  {
    label: "Impact",
    detail:
      "You will help make a difference in a lot of campus stores — not just your own — and quite possibly in a lot of individual lives, like the students we all serve.",
  },
  {
    label: "It feels good",
    detail: "There is nothing better than feeling good about work you have accomplished.",
  },
];

export const BOARD_SERVICE_CONSIDERATIONS: BoardServicePoint[] = [
  {
    label: "Time",
    detail:
      "Serving involves a real time commitment, and how much depends on the position you hold. Know what you are willing to give before you take a role on.",
  },
  {
    label: "Responsibility",
    detail:
      "You will guide the strategic direction of the association and take part in the decisions that determine whether it succeeds — reviewing financial statements, building relationships, and finding ways to sustain and grow it.",
  },
];

/** What the source document tells an undecided reader to do next. */
export const BOARD_SERVICE_NEXT_STEP =
  "If you are interested, talk to a current board member or contact the CSC office to find out what level of time commitment to expect and which roles are open.";
