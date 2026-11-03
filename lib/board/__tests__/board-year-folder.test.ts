import { describe, it, expect } from "vitest";
import { boardYearFolder, minutesTitle } from "@/lib/board/docx-export";

// AGM dates as recorded in board_meetings (meeting_type = 'agm').
const AGMS = ["2025-01-20", "2026-01-15", "2027-01-21"];

describe("boardYearFolder", () => {
  it("files a meeting under the board year of the latest AGM on or before it", () => {
    expect(boardYearFolder("2026-09-24", AGMS)).toBe("2026-27");
    expect(boardYearFolder("2026-02-24", AGMS)).toBe("2026-27");
    expect(boardYearFolder("2025-01-27", AGMS)).toBe("2025-26");
  });

  it("starts the new year on the AGM day itself", () => {
    expect(boardYearFolder("2027-01-21", AGMS)).toBe("2027-28");
    expect(boardYearFolder("2027-01-20", AGMS)).toBe("2026-27");
  });

  it("falls back to a February 1 boundary before any recorded AGM", () => {
    expect(boardYearFolder("2024-01-30", AGMS)).toBe("2023-24");
    expect(boardYearFolder("2024-02-01", AGMS)).toBe("2024-25");
  });

  it("pads the second year across a century turn", () => {
    expect(boardYearFolder("2099-06-01", ["2099-01-15"])).toBe("2099-00");
  });
});

describe("minutesTitle", () => {
  it("matches the archive's existing file names", () => {
    expect(minutesTitle("2026-09-24")).toBe("Minutes - CSC Board Minutes - 2026-09-24");
  });
});
