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
