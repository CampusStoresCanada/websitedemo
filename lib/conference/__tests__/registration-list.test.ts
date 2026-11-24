import { describe, expect, it } from "vitest";
import { summarizeSide, type RegistrationListSeat } from "../registration-list";

const seat = (over: Partial<RegistrationListSeat>): RegistrationListSeat => ({
  seatId: Math.random().toString(36),
  organizationId: "org-a",
  organizationName: "Acorn College",
  isTestOrg: false,
  side: "delegate",
  registrationName: "Full Conference Registration",
  funded: false,
  holderPersonId: null,
  holderName: null,
  declined: false,
  seatedAt: null,
  ...over,
});

describe("summarizeSide", () => {
  const seats = [
    seat({ holderPersonId: "p1", holderName: "Zed Young" }),
    seat({ holderPersonId: "p2", holderName: "Amy Auld" }),
    seat({}),
    seat({ declined: true }),
    seat({ organizationId: "org-b", organizationName: "Birch U", registrationName: "Wednesday Day Pass", holderPersonId: "p3", holderName: "Bo Birch" }),
    seat({ organizationId: "org-t", organizationName: "Desk Test", isTestOrg: true, holderPersonId: "p4", holderName: "Test Person" }),
    seat({ side: "exhibitor", organizationId: "org-x", organizationName: "Xylo Inc", registrationName: "Exhibitor Staff Registration" }),
  ];

  it("lists one side's named people by organization then name", () => {
    const d = summarizeSide(seats, "delegate");
    expect(d.people.map((p) => p.holderName)).toEqual(["Amy Auld", "Zed Young", "Bo Birch", "Test Person"]);
  });

  it("leaves a declined seat out of the unnamed seats and the organization's total", () => {
    const d = summarizeSide(seats, "delegate");
    expect(d.unnamed).toHaveLength(1);
    const acorn = d.organizations.find((o) => o.organizationId === "org-a");
    expect(acorn).toMatchObject({ seats: 3, named: 2, people: ["Amy Auld", "Zed Young"] });
    expect(acorn?.registrations).toEqual([{ name: "Full Conference Registration", seats: 3 }]);
  });

  it("lists a test organization and keeps it out of the counts", () => {
    const d = summarizeSide(seats, "delegate");
    expect(d.organizations.map((o) => o.organizationName)).toContain("Desk Test");
    expect(d.counts).toEqual({ people: 3, unnamed: 1, organizations: 2, testSeats: 1 });
  });

  it("an organization with nobody named is still an exhibiting organization", () => {
    const x = summarizeSide(seats, "exhibitor");
    expect(x.counts).toMatchObject({ people: 0, unnamed: 1, organizations: 1 });
    expect(x.organizations[0]).toMatchObject({ organizationName: "Xylo Inc", named: 0, seats: 1 });
  });
});
