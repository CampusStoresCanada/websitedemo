import { describe, it, expect } from "vitest";
import { buildBoardRecapPost, renderRecapLine } from "@/lib/ghosts/board-recap-post";

type Node = Record<string, any>;

const base = {
  meetingDateLong: "Thursday, August 27, 2026",
  decided: [] as string[],
  outstanding: [] as string[],
  nextMeeting: [] as string[],
  minutesAreDraft: true,
};

const nodes = (post: ReturnType<typeof buildBoardRecapPost>): Node[] =>
  post.tiptap_body.body.content as Node[];

const headings = (post: ReturnType<typeof buildBoardRecapPost>) =>
  nodes(post).filter((n) => n.type === "heading").map((n) => n.content[0].text);

describe("buildBoardRecapPost", () => {
  it("titles the post with the meeting date", () => {
    const post = buildBoardRecapPost({ ...base, decided: ["A thing."] });
    expect(post.title).toBe("Board meeting recap — Thursday, August 27, 2026");
  });

  it("wraps the doc in the nested shape Circle requires", () => {
    // A bare { type: "doc", content } is accepted with HTTP 200 and stored
    // EMPTY — verified 2026-08-27. This assertion is the guard against that.
    const post = buildBoardRecapPost({ ...base, decided: ["A thing."] });
    expect(post.tiptap_body).toHaveProperty("body.type", "doc");
    expect(Array.isArray(post.tiptap_body.body.content)).toBe(true);
  });

  it("builds bullets as bulletList > listItem > paragraph", () => {
    // The exact structure the Board Stuff space accepted and rendered as
    // <ul><li><p>…</p></li></ul> on 2026-08-27.
    const post = buildBoardRecapPost({ ...base, decided: ["One.", "Two."] });
    const list = nodes(post).find((n) => n.type === "bulletList")!;
    expect(list).toBeDefined();
    expect(list.content).toHaveLength(2);
    expect(list.content[0].type).toBe("listItem");
    expect(list.content[0].content[0].type).toBe("paragraph");
    expect(list.content[0].content[0].content[0].text).toBe("One.");
  });

  it("renders all three sections when all three have lines", () => {
    const post = buildBoardRecapPost({
      ...base,
      decided: ["D."],
      outstanding: ["O."],
      nextMeeting: ["N."],
    });
    expect(headings(post)).toEqual(["Decided", "Still outstanding", "Agenda for next meeting"]);
  });

  // An empty "Still outstanding" heading asserts that nothing is outstanding,
  // which is a different claim from "the minutes tagged nothing".
  it("omits a section that has no lines", () => {
    const post = buildBoardRecapPost({ ...base, decided: ["Only this."] });
    expect(headings(post)).toEqual(["Decided"]);
  });

  it("renders no headings or rule when nothing was tagged", () => {
    const post = buildBoardRecapPost(base);
    expect(headings(post)).toEqual([]);
    expect(nodes(post).some((n) => n.type === "horizontalRule")).toBe(false);
  });

  it("states up front that draft minutes are provisional", () => {
    const post = buildBoardRecapPost({ ...base, decided: ["A."], minutesAreDraft: true });
    const flat = JSON.stringify(post.tiptap_body);
    expect(flat).toContain("still in draft");
  });

  it("says nothing about draft status once minutes are approved", () => {
    const post = buildBoardRecapPost({ ...base, decided: ["A."], minutesAreDraft: false });
    expect(JSON.stringify(post.tiptap_body)).not.toContain("still in draft");
  });

  it("leads with the button, before the draft note", () => {
    // The button is the first thing in the post: the title already names the
    // meeting, so a prose introduction is a line every reader skips.
    const post = buildBoardRecapPost({
      ...base,
      decided: ["A."],
      eventUrl: "https://www.campusstores.ca/events/csc-board-meeting-2026-08-27",
    });
    const types = nodes(post).map((n) => n.type);
    expect(types[0]).toBe("cta");
    expect(types.indexOf("cta")).toBeLessThan(types.indexOf("paragraph"));
  });

  it("carries no prose introduction", () => {
    const post = buildBoardRecapPost({ ...base, decided: ["A."] });
    expect(JSON.stringify(post.tiptap_body)).not.toContain("Here's where things landed");
  });

  it("renders a button only when an event URL is supplied", () => {
    const without = buildBoardRecapPost({ ...base, decided: ["A."] });
    expect(nodes(without).some((n) => n.type === "cta")).toBe(false);

    const withUrl = buildBoardRecapPost({
      ...base,
      decided: ["A."],
      eventUrl: "https://memberspace.campusstores.ca/c/board-stuff",
    });
    const cta = nodes(withUrl).find((n) => n.type === "cta")!;
    expect(cta.attrs.url).toBe("https://memberspace.campusstores.ca/c/board-stuff");
  });
});

describe("renderRecapLine", () => {
  it("returns a single text node for a plain line", () => {
    const out = renderRecapLine("Nothing special here.") as Node[];
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Nothing special here.");
    expect(out[0].marks).toBeUndefined();
  });

  it("promotes a bare URL to a link, shown without the scheme", () => {
    const out = renderRecapLine("See https://campusstores.ca/box for detail.") as Node[];
    const linkNode = out.find((n) => n.marks?.[0]?.type === "link")!;
    expect(linkNode.text).toBe("campusstores.ca/box");
    expect(linkNode.marks[0].attrs.href).toBe("https://campusstores.ca/box");
    expect(out.map((n) => n.text).join("")).toContain("See ");
  });

  it("renders a markdown link with its label", () => {
    const out = renderRecapLine("Read the [pricing sheet](https://campusstores.ca/p) first.") as Node[];
    const linkNode = out.find((n) => n.marks?.[0]?.type === "link")!;
    expect(linkNode.text).toBe("pricing sheet");
    expect(linkNode.marks[0].attrs.href).toBe("https://campusstores.ca/p");
    // The brackets must not survive into the rendered bullet.
    expect(out.map((n) => n.text).join("")).not.toContain("[");
  });

  // A mention node needs a Circle member id nothing here has, and an invented
  // node is exactly what Circle accepts with a 200 and silently discards.
  it("renders *emphasis* as an italic mark", () => {
    const out = renderRecapLine("*Big Ideas Day* pricing framework set.") as Node[];
    expect(out[0].text).toBe("Big Ideas Day");
    expect(out[0].marks[0].type).toBe("italic");
    expect(out[1].text).toContain("pricing framework set.");
    // The asterisks must not survive into the bullet.
    expect(out.map((n) => n.text).join("")).not.toContain("*");
  });

  it("combines emphasis and a link in one line", () => {
    const out = renderRecapLine(
      "*Benchmarking survey* opens October 8: [Here's the description](https://docs.google.com/d/1)"
    ) as Node[];
    expect(out.find((n) => n.marks?.[0]?.type === "italic")!.text).toBe("Benchmarking survey");
    const linkNode = out.find((n) => n.marks?.[0]?.type === "link")!;
    expect(linkNode.text).toBe("Here's the description");
    expect(linkNode.marks[0].attrs.href).toBe("https://docs.google.com/d/1");
  });

  it("leaves a lone asterisk alone", () => {
    const out = renderRecapLine("Budget * 2 was discussed.") as Node[];
    expect(out.map((n) => n.text).join("")).toBe("Budget * 2 was discussed.");
    expect(out.every((n) => !n.marks)).toBe(true);
  });

  it("leaves an @mention as plain text rather than inventing a mention node", () => {
    const out = renderRecapLine("Venue comparison. @Carolyn Potter") as Node[];
    expect(out.every((n) => n.type === "text")).toBe(true);
    expect(out.map((n) => n.text).join("")).toContain("@Carolyn Potter");
  });
});
