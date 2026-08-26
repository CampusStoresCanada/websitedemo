import { describe, expect, it } from "vitest";
import { parseServiceDetails } from "../service-details";

describe("service details", () => {
  it("orders deadlines soonest first", () => {
    const d = parseServiceDetails("Stronco", {
      show_code: "533166583",
      deadlines: [
        { label: "Last advance receipt", date: "2027-01-27" },
        { label: "Pre-show discount ends", date: "2027-01-10" },
        { label: "Advance shipments open", date: "2026-12-30" },
      ],
    });
    expect(d?.deadlines.map((x) => x.label)).toEqual([
      "Advance shipments open",
      "Pre-show discount ends",
      "Last advance receipt",
    ]);
  });

  it("drops a deadline missing its date rather than rendering an undefined one", () => {
    // "goes to press on NaN undefined" shipped to a real inbox once already.
    const d = parseServiceDetails("X", {
      show_code: "1",
      deadlines: [{ label: "No date here" }, { label: "Real", date: "2027-01-01" }],
    });
    expect(d?.deadlines).toHaveLength(1);
  });

  it("returns null when there is nothing worth showing", () => {
    expect(parseServiceDetails("Empty", { what: "Just a description" })).toBeNull();
    expect(parseServiceDetails("Empty", null)).toBeNull();
  });

  it("treats blank strings as absent", () => {
    const d = parseServiceDetails("X", { show_code: "   ", action_url: "https://x.test" });
    expect(d?.showCode).toBeNull();
    expect(d?.actionUrl).toBe("https://x.test");
  });
});

describe("a missing form is a visible gap, not a silent one", () => {
  it("flags a service that says to submit a form but supplies none", () => {
    // Encore: "complete their order form and email it to…" with no form on
    // file. The first version of this filled the hole with an invented URL to
    // the supplier's homepage, labelled "order form".
    const d = parseServiceDetails("Encore", {
      submit_by: "email",
      contact_email: "someone@example.test",
    });
    expect(d?.formMissing).toBe(true);
  });

  it("does not flag one that links out to place the order", () => {
    const d = parseServiceDetails("Stronco", {
      submit_by: "web",
      action_url: "https://example.test/order",
    });
    expect(d?.formMissing).toBe(false);
  });

  it("does not flag one whose form is attached as a document", () => {
    const d = parseServiceDetails("Encore", {
      submit_by: "email",
      documents: [{ label: "Order form", url: "https://example.test/form.pdf" }],
    });
    expect(d?.formMissing).toBe(false);
    expect(d?.documents).toHaveLength(1);
  });

  it("drops a document missing its url rather than rendering a dead link", () => {
    const d = parseServiceDetails("X", {
      show_code: "1",
      documents: [{ label: "No url" }, { label: "Real", url: "https://example.test/a.pdf" }],
    });
    expect(d?.documents).toEqual([{ label: "Real", url: "https://example.test/a.pdf" }]);
  });
});
