/**
 * The committee looking at where a nominee has got to.
 *
 * "View their page" linked straight at /elections/accept/<token>, which is the
 * NOMINEE's page — so an administrator who is neither the nominee nor an admin
 * of their institution hit "this nomination belongs to someone else". The link
 * was useless to the one group most likely to click it.
 *
 * The existing preview renders a STAND-IN, which is right before a cycle opens
 * and wrong for chasing a real person: it shows invented progress.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync("app/elections/accept/[token]/page.tsx", "utf8");
const admin = readFileSync("app/admin/elections/[slug]/page.tsx", "utf8");

describe("an admin reaches the real page", () => {
  it("separates a real-token view from the stand-in", () => {
    expect(page).toContain('const previewing = token === "preview" && adminPreview');
    expect(page).toContain('const viewingAsAdmin = token !== "preview" && adminPreview');
  });

  it("is let past the belongs-to-someone-else wall", () => {
    expect(page).toContain("if (!isNominee && !canGrantStorePermission && !viewingAsAdmin)");
  });

  it("is told whose page it is, and that nobody was notified", () => {
    expect(page).toContain("You are looking at {nomination.nomineeName}&apos;s own page.");
    expect(page).toContain("they have not been told you opened it");
  });
});

describe("and can change nothing", () => {
  it("routes every control through one switch", () => {
    expect(page).toContain("const canAct = windowOpen && !viewingAsAdmin;");
  });

  it("leaves no control still keyed to the old condition", () => {
    const body = page.slice(page.indexOf("const canAct ="));
    expect(body).not.toContain("disabled={!windowOpen}");
    expect(body).not.toContain("{windowOpen && (");
  });
});

describe("the link that sends them there", () => {
  it("carries the flag, or it lands on the wall again", () => {
    expect(admin).toContain("`/elections/accept/${n.acceptToken}?preview=1`");
  });

  it("says what it shows rather than offering a page they cannot use", () => {
    expect(admin).toContain("See where they are");
  });
});
