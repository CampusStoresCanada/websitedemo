import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Every membership-wide send must be armed behind a confirmation.
 *
 * The guard is opt-in per action: ElectionTimeline renders a plain submit for
 * anything missing from `sendCounts`. That means losing an entry disarms the
 * send and breaks nothing visible — which is exactly what happened. The whole
 * prop was deleted while wiring an unrelated feature, every send silently went
 * back to one-press, and it took a full sweep to notice.
 *
 * This is a source-level check rather than a render test because the failure is
 * a missing key, not wrong behaviour: there is nothing to observe until someone
 * presses the button, by which point the email has gone.
 */
const PAGE = "app/admin/elections/[slug]/page.tsx";

/** Action keys that email the membership. Adding a send? Add it here too. */
const MEMBERSHIP_WIDE_SENDS = [
  "sendCall",
  "circulateBallots",
  "sendAgmNotice",
  "sendProxyForm",
  "sendAgmPackage",
  "notifyCandidates",
];

/**
 * Sends that do NOT live on the cycle screen.
 *
 * The announcement is triggered from the audit screen, so the sweep that
 * covered the timeline walked straight past it — it emailed every eligible
 * institution on a single press for as long as the guard has existed. Any send
 * on a page of its own has to be listed here or it gets the same blind spot.
 */
const SENDS_ON_OTHER_PAGES = [
  { page: "app/admin/elections/[slug]/audit/page.tsx", what: "the result announcement" },
];

describe("membership-wide sends are confirmed before they fire", () => {
  const source = readFileSync(PAGE, "utf8");

  it("passes sendCounts to the timeline at all", () => {
    expect(source).toContain("sendCounts={{");
  });

  for (const key of MEMBERSHIP_WIDE_SENDS) {
    it(`arms ${key} behind a confirmation`, () => {
      const block = source.slice(source.indexOf("sendCounts={{"), source.indexOf("actions={{"));
      expect(block).toContain(`${key}:`);
    });
  }

  it("still hands every one of them a real action", () => {
    const actions = source.slice(source.indexOf("actions={{"));
    for (const key of MEMBERSHIP_WIDE_SENDS) {
      expect(actions).toContain(`${key}`);
    }
  });
});

describe("sends that live off the cycle screen are confirmed too", () => {
  for (const { page, what } of SENDS_ON_OTHER_PAGES) {
    it(`arms ${what}`, () => {
      const source = readFileSync(page, "utf8");
      expect(source).toContain("ConfirmSubmitButton");
      // A bare submit next to a send is the shape of the original defect.
      expect(source).not.toMatch(/<button\s+type="submit"[^>]*>\s*Send to \{/);
    });
  }
});

describe("the candidates hear before the membership does", () => {
  it("offers the confirmation the announcement gate can be satisfied with", () => {
    const source = readFileSync("app/admin/elections/[slug]/audit/page.tsx", "utf8");
    expect(source).toContain("confirmCandidatesTold");
  });

  it("refuses to announce until candidates are told or the chair says so", () => {
    const service = readFileSync("lib/elections/service.ts", "utf8");
    expect(service).toContain("!cfg.candidateResultsSentAt && !opts.confirmedCandidatesTold");
  });
});
