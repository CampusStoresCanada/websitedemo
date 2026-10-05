import { describe, it, expect } from "vitest";

import { buildFlagDm } from "../flag-message";

/*
  What a flag notification has to carry.

  ⛔ The regression this exists for: the DM quoted OUR OWN page text back at the
  committee and said somebody objected to it, with no name and no message. Every
  flag ever raised went out that way. Nothing failed — the DM sent, delivery
  succeeded, and the content was simply unanswerable, so each one ended with
  "go and look at the admin panel" and the conversation stopped there.

  Karin's real flag in September read "Jess isn't at UofT anymore, should update
  the admin to be April". What went out was the email address she had clicked.
*/

const base = {
  priorityLabel: "🟡 Normal priority",
  who: "Karin Stonehouse",
  note: "Jess isn't at UofT anymore, should update the admin to be April",
  elementContent: "jscott@uoftbookstore.com",
  survey: false,
  issuesUrl: "https://www.campusstores.ca/benchmarking/admin/issues",
  reviewLink: "https://www.campusstores.ca/org/university-of-toronto?flag=abc",
};

describe("the message a flag sends", () => {
  it("carries what the member actually wrote", () => {
    expect(buildFlagDm(base)).toContain(
      "Jess isn't at UofT anymore, should update the admin to be April",
    );
  });

  it("names them, because an anonymous complaint cannot be answered", () => {
    expect(buildFlagDm(base)).toContain("Karin Stonehouse");
    expect(buildFlagDm({ ...base, who: "A CSC member" })).toContain("A CSC member");
  });

  it("keeps the page text, but as context rather than as the message", () => {
    const dm = buildFlagDm(base);
    expect(dm).toContain("They were on:");
    expect(dm.indexOf(base.note)).toBeLessThan(dm.indexOf("They were on:"));
  });

  it("says nothing at all when there is no note, rather than an empty quote", () => {
    const dm = buildFlagDm({ ...base, note: null });
    expect(dm).not.toContain('""');
    expect(dm).toContain("Karin Stonehouse");
  });

  it("collapses the layout whitespace page text arrives with", () => {
    const dm = buildFlagDm({
      ...base,
      elementContent: "Store Name\n      The name your store trades under,\n  if it differs",
    });
    expect(dm).toContain("Store Name The name your store trades under, if it differs");
    expect(dm).not.toContain("\n      ");
  });

  it("sends a survey flag to the queue, and anything else to the page it is about", () => {
    expect(buildFlagDm({ ...base, survey: true })).toContain(base.issuesUrl);
    expect(buildFlagDm(base)).toContain(base.reviewLink);
  });
});
