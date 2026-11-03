import { describe, expect, it } from "vitest";
import { cancollReportCsv, dayInZone, registrationsToInvoice, type CancollRegistration } from "../cancoll-report";

/**
 * The CANCOLL registration report (MOU Schedule C) and which registrations an
 * invoice bills (Schedule A: the first covers registrations confirmed on or
 * before November 30, in the conference's own zone).
 */

const row = (over: Partial<CancollRegistration>): CancollRegistration => ({
  seatId: "s1",
  organizationId: "o1",
  institution: "Keyano College",
  delegateName: "Pat Buyer",
  positionTitle: "Store Manager",
  confirmedAt: "2026-11-14T18:00:00Z",
  invoiceId: null,
  invoiceNumber: null,
  refund: null,
  ...over,
});

const TORONTO = "America/Toronto";
// The end of November 30 in Toronto, exclusive.
const DEC_1 = "2026-12-01T05:00:00.000Z";

describe("registrationsToInvoice", () => {
  it("bills what was confirmed by the end of November 30 in Toronto, and nothing already invoiced", () => {
    const rows = [
      row({ seatId: "early" }),
      // 11:30 pm Nov 30 in Toronto is already December 1 in UTC.
      row({ seatId: "late-evening", confirmedAt: "2026-12-01T04:30:00Z" }),
      row({ seatId: "december", confirmedAt: "2026-12-01T05:00:00Z" }),
      row({ seatId: "billed", invoiceId: "inv-1" }),
    ];
    expect(registrationsToInvoice(rows, DEC_1).map((r) => r.seatId)).toEqual(["early", "late-evening"]);
  });
});

describe("cancollReportCsv", () => {
  it("lists Schedule C's fields, dates in the conference's zone, and ends with the running total", () => {
    const csv = cancollReportCsv(
      [
        row({ confirmedAt: "2026-12-01T04:30:00Z", invoiceNumber: "CSC-0042" }),
        row({
          seatId: "s2",
          institution: "UVic",
          delegateName: "Sam",
          positionTitle: null,
          confirmedAt: "2027-01-05T15:00:00Z",
          refund: { cents: 33787, at: "2027-01-05T15:00:00Z" },
        }),
      ],
      { unitCents: 29900, timeZone: TORONTO }
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe(
      '"Institution","Delegate name","Position title","Registration confirmed","Amount invoiced","Invoice","Refund issued","Refund date"'
    );
    expect(lines[1]).toBe('"Keyano College","Pat Buyer","Store Manager","2026-11-30","299.00","CSC-0042","",""');
    expect(lines[2]).toBe('"UVic","Sam","","2027-01-05","299.00","","337.87","2027-01-05"');
    expect(lines[3]).toBe('"Running total: 2 Supported Registrations","","","","598.00","","",""');
  });

  it("says a refund owed but not issued through Stripe is issued by hand", () => {
    const csv = cancollReportCsv([row({ refund: { cents: null, at: "2027-01-05T15:00:00Z" } })], {
      unitCents: 29900,
      timeZone: TORONTO,
    });
    expect(csv.split("\n")[1]).toContain('"Owed, issued by hand","2027-01-05"');
  });

  it("defuses a cell that a spreadsheet would read as a formula", () => {
    const csv = cancollReportCsv([row({ institution: "=HYPERLINK(1)" })], { unitCents: 29900, timeZone: TORONTO });
    expect(csv.split("\n")[1].startsWith(`"'=HYPERLINK(1)"`)).toBe(true);
  });

  it("dates by the conference's calendar, not UTC", () => {
    expect(dayInZone("2026-12-01T04:30:00Z", TORONTO)).toBe("2026-11-30");
  });
});
