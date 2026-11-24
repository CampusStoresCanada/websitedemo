import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  countRegistrations,
  registrationsCsv,
  viewRegistrations,
  type RegistrationListSeat,
} from "../registration-list-view";

let n = 0;
const seat = (over: Partial<RegistrationListSeat>): RegistrationListSeat => ({
  seatId: `seat-${(n += 1)}`,
  organizationId: "org-a",
  organizationName: "Acorn College",
  badge: "delegate",
  registrationName: "Full Conference Registration",
  holderPersonId: null,
  holderName: null,
  email: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  ...over,
});

const seats = [
  seat({ holderPersonId: "p1", holderName: "Zed Young", email: "zed@acorn.example" }),
  seat({ holderPersonId: "p2", holderName: "Amy Auld", emergencyContactName: "Pat Auld", emergencyContactPhone: "555-0100" }),
  seat({}),
  seat({ organizationId: "org-x", organizationName: "Xylo Inc", badge: "exhibitor", registrationName: "Exhibitor Staff Registration", holderPersonId: "p3", holderName: "Bo Birch" }),
  seat({ organizationId: "org-x", organizationName: "Xylo Inc", badge: "exhibitor", registrationName: "Exhibitor Staff Registration" }),
  seat({ organizationId: "org-c", organizationName: "CSC", badge: "staff", registrationName: "Staff Registration", holderPersonId: "p4", holderName: "Cy Staff" }),
];
const byOrg = { key: "organization" as const, descending: false };
const names = (rows: RegistrationListSeat[]) => rows.map((r) => r.holderName);

describe("viewRegistrations", () => {
  it("shows named people by default, by organization then name", () => {
    expect(names(viewRegistrations(seats, { query: "", filters: DEFAULT_FILTERS, sort: byOrg }))).toEqual([
      "Amy Auld",
      "Zed Young",
      "Cy Staff",
      "Bo Birch",
    ]);
  });

  it("filters by badge, registration type and named or not", () => {
    const view = (filters: Partial<typeof DEFAULT_FILTERS>) =>
      viewRegistrations(seats, { query: "", filters: { ...DEFAULT_FILTERS, ...filters }, sort: byOrg });
    expect(names(view({ badge: "exhibitor" }))).toEqual(["Bo Birch"]);
    expect(view({ badge: "exhibitor", named: "all" })).toHaveLength(2);
    expect(names(view({ registration: "Staff Registration" }))).toEqual(["Cy Staff"]);
    expect(view({ named: "unnamed" })).toHaveLength(2);
  });

  it("sorts Z to A, and keeps unnamed seats last when sorting by name", () => {
    const all = { ...DEFAULT_FILTERS, named: "all" as const };
    expect(names(viewRegistrations(seats, { query: "", filters: all, sort: { key: "name", descending: true } }))).toEqual([
      "Zed Young",
      "Cy Staff",
      "Bo Birch",
      "Amy Auld",
      null,
      null,
    ]);
  });

  it("a search looks through every registration, whatever the filters say", () => {
    const hidden = { badge: "staff" as const, registration: "Staff Registration", named: "unnamed" as const };
    expect(names(viewRegistrations(seats, { query: "zed@", filters: hidden, sort: byOrg }))).toEqual(["Zed Young"]);
    expect(names(viewRegistrations(seats, { query: "pat auld", filters: hidden, sort: byOrg }))).toEqual(["Amy Auld"]);
    expect(viewRegistrations(seats, { query: "xylo", filters: hidden, sort: byOrg })).toHaveLength(2);
  });
});

describe("countRegistrations", () => {
  it("counts named people, organizations and unnamed seats per badge", () => {
    const counts = countRegistrations(seats);
    expect(counts.all).toEqual({ people: 4, organizations: 3, unnamed: 2 });
    expect(counts.delegate).toEqual({ people: 2, organizations: 1, unnamed: 1 });
    expect(counts.exhibitor).toEqual({ people: 1, organizations: 1, unnamed: 1 });
    expect(counts.staff).toEqual({ people: 1, organizations: 1, unnamed: 0 });
  });
});

describe("registrationsCsv", () => {
  it("writes one line per seat under the header, quoting and defusing formulas", () => {
    const csv = registrationsCsv([seat({ holderPersonId: "p9", holderName: '=Sam "S" Lee', organizationName: "A, B" })]);
    const [header, line] = csv.split("\n");
    expect(header).toBe('"Name","Organization","Registration type","Badge","Email","Emergency contact","Emergency contact phone"');
    expect(line).toBe('"\'=Sam ""S"" Lee","A, B","Full Conference Registration","Delegate","","",""');
  });
});
