import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { HotelRate } from "@/lib/conference/hotel";

// HotelMap is a "use client" Mapbox component — it pulls in a WebGL library and
// CSS that have nothing to do with what this file pins (the copy, the button,
// and the cutoff states). Stubbed so these stay pure render assertions.
vi.mock("../HotelMap", () => ({
  default: () => null,
}));

const { default: HotelInfo } = await import("../HotelInfo");

const RATES: HotelRate[] = [
  { id: "a", label: "Single occupancy", rate_cents: 18500, note: "plus tax" },
  { id: "b", label: "Double occupancy", rate_cents: 20500 },
];

const VENUE = "Hilton Toronto Airport Hotel and Suites, Toronto, ON";

/** Freeze "today" so cutoff-relative copy is deterministic. */
function atDate(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${iso}T12:00:00Z`));
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("HotelInfo", () => {
  it("renders nothing without a venue, rather than an empty card", () => {
    expect(renderToStaticMarkup(<HotelInfo venue="" rates={RATES} />)).toBe("");
  });

  it("keeps the check-back note while there is no booking link", () => {
    const html = renderToStaticMarkup(<HotelInfo venue={VENUE} rates={RATES} />);
    expect(html).toContain("The booking link will be live soon");
    expect(html).not.toContain("Book your room");
  });

  it("shows the rates whether or not a link exists", () => {
    const html = renderToStaticMarkup(<HotelInfo venue={VENUE} rates={RATES} />);
    expect(html).toContain("Single occupancy");
    expect(html).toContain("$185/night");
    expect(html).toContain("plus tax");
    expect(html).toContain("Double occupancy");
    expect(html).toContain("$205/night");
  });

  it("renders a booking button once the link is set", () => {
    const html = renderToStaticMarkup(
      <HotelInfo venue={VENUE} rates={RATES} bookingUrl="https://book.hilton.com/csc27" />
    );
    expect(html).toContain("Book your room");
    expect(html).toContain('href="https://book.hilton.com/csc27"');
    // Opening a third-party booking site in a new tab must not hand it a
    // window.opener handle back to us.
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain("will be live soon");
  });

  it("states the book-by date plainly when it is comfortably ahead", () => {
    atDate("2027-01-05");
    const html = renderToStaticMarkup(
      <HotelInfo
        venue={VENUE}
        rates={RATES}
        bookingUrl="https://book.hilton.com/csc27"
        bookingCutoff="2027-03-12"
      />
    );
    expect(html).toContain("Book by Friday, March 12, 2027");
    expect(html).not.toContain("days left");
  });

  it("counts down inside the last two weeks", () => {
    atDate("2027-03-05");
    const html = renderToStaticMarkup(
      <HotelInfo
        venue={VENUE}
        rates={RATES}
        bookingUrl="https://book.hilton.com/csc27"
        bookingCutoff="2027-03-12"
      />
    );
    expect(html).toContain("7 days left at this rate");
    expect(html).toContain("Book your room");
  });

  it("says day, not days, at one day out", () => {
    atDate("2027-03-11");
    const html = renderToStaticMarkup(
      <HotelInfo venue={VENUE} bookingUrl="https://book.hilton.com/csc27" bookingCutoff="2027-03-12" />
    );
    expect(html).toContain("1 day left at this rate");
    expect(html).not.toContain("1 days left");
  });

  it("still lets people book on the cutoff day itself", () => {
    atDate("2027-03-12");
    const html = renderToStaticMarkup(
      <HotelInfo venue={VENUE} bookingUrl="https://book.hilton.com/csc27" bookingCutoff="2027-03-12" />
    );
    expect(html).toContain("Book your room");
  });

  it("calls the cutoff day the last day, not zero days left", () => {
    atDate("2027-03-12");
    const html = renderToStaticMarkup(
      <HotelInfo venue={VENUE} bookingUrl="https://book.hilton.com/csc27" bookingCutoff="2027-03-12" />
    );
    expect(html).toContain("last day to book at this rate");
    expect(html).not.toContain("0 days left");
  });

  it("withdraws the button and explains once the block has closed", () => {
    atDate("2027-03-13");
    const html = renderToStaticMarkup(
      <HotelInfo
        venue={VENUE}
        rates={RATES}
        bookingUrl="https://book.hilton.com/csc27"
        bookingCutoff="2027-03-12"
      />
    );
    expect(html).not.toContain("Book your room");
    expect(html).toContain("Our room block has closed");
    // The rates stay visible — people still want to know what it was quoted at.
    expect(html).toContain("Single occupancy");
  });

  it("renders the venue with no rates at all", () => {
    const html = renderToStaticMarkup(<HotelInfo venue={VENUE} />);
    expect(html).toContain("Hilton Toronto Airport");
    expect(html).toContain("The booking link will be live soon");
  });
});

describe("HotelInfo note", () => {
  const NOTE =
    "Rates exclude HST. Parking is $20 per vehicle per day.\nTo book outside the block, contact carolyn@campusstores.ca.";

  it("renders the note under the rates", () => {
    const html = renderToStaticMarkup(<HotelInfo venue={VENUE} rates={RATES} note={NOTE} />);
    expect(html).toContain("Rates exclude HST");
    expect(html).toContain("Parking is $20 per vehicle per day");
  });

  it("makes the contact address a mailto link", () => {
    const html = renderToStaticMarkup(<HotelInfo venue={VENUE} note={NOTE} />);
    expect(html).toContain('href="mailto:carolyn@campusstores.ca"');
  });

  it("keeps the line break the admin typed", () => {
    const html = renderToStaticMarkup(<HotelInfo venue={VENUE} note={NOTE} />);
    expect(html).toContain("whitespace-pre-line");
  });

  it("escapes markup in the note instead of rendering it", () => {
    const html = renderToStaticMarkup(
      <HotelInfo venue={VENUE} note={"<img src=x onerror=alert(1)>"} />
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("renders nothing extra when there is no note", () => {
    const html = renderToStaticMarkup(<HotelInfo venue={VENUE} rates={RATES} />);
    expect(html).not.toContain("whitespace-pre-line");
  });

  it("still shows the note after the block has closed", () => {
    atDate("2027-03-13");
    const html = renderToStaticMarkup(
      <HotelInfo venue={VENUE} note={NOTE} bookingUrl="https://x.com" bookingCutoff="2027-03-12" />
    );
    expect(html).toContain("carolyn@campusstores.ca");
    expect(html).toContain("Our room block has closed");
  });
});

describe("HotelInfo for a viewer we know about", () => {
  const BOOKING_PROPS = {
    venue: VENUE,
    rates: RATES,
    bookingUrl: "https://book.hilton.com/csc27",
    bookingCutoff: "2027-03-12",
  };

  it("confirms the booking and shows the code back to them", () => {
    const html = renderToStaticMarkup(
      <HotelInfo {...BOOKING_PROPS} viewerBooking={{ state: "done", evidence: "ABC123" }} />
    );
    expect(html).toContain("You&#x27;re booked");
    expect(html).toContain("ABC123");
  });

  it("confirms a booking we have no code for", () => {
    const html = renderToStaticMarkup(
      <HotelInfo {...BOOKING_PROPS} viewerBooking={{ state: "done", evidence: null }} />
    );
    expect(html).toContain("You&#x27;re booked");
  });

  it("does not chase someone who has booked, even in the final fortnight", () => {
    atDate("2027-03-05");
    const html = renderToStaticMarkup(
      <HotelInfo {...BOOKING_PROPS} viewerBooking={{ state: "done", evidence: "ABC123" }} />
    );
    // The deadline is still stated, but as a fact rather than a warning.
    expect(html).toContain("Book by Friday, March 12, 2027");
    expect(html).not.toContain("days left at this rate");
    expect(html).not.toContain("#B45309");
  });

  it("does not chase someone staying elsewhere", () => {
    atDate("2027-03-05");
    const html = renderToStaticMarkup(
      <HotelInfo {...BOOKING_PROPS} viewerBooking={{ state: "not_applicable", evidence: null }} />
    );
    expect(html).toContain("staying elsewhere");
    expect(html).not.toContain("days left at this rate");
    expect(html).not.toContain("You&#x27;re booked");
  });

  it("demotes the button to a quiet link once they have dealt with it", () => {
    const html = renderToStaticMarkup(
      <HotelInfo {...BOOKING_PROPS} viewerBooking={{ state: "done", evidence: "ABC123" }} />
    );
    expect(html).toContain("Change your booking");
    expect(html).not.toContain("Book your room");
  });

  it("still chases someone who is genuinely outstanding", () => {
    atDate("2027-03-05");
    const html = renderToStaticMarkup(
      <HotelInfo {...BOOKING_PROPS} viewerBooking={{ state: "pending", evidence: null }} />
    );
    expect(html).toContain("7 days left at this rate");
    expect(html).toContain("Book your room");
  });

  it("treats an unknown viewer as unknown, never as outstanding-and-settled", () => {
    atDate("2027-03-05");
    const anon = renderToStaticMarkup(<HotelInfo {...BOOKING_PROPS} />);
    const pending = renderToStaticMarkup(
      <HotelInfo {...BOOKING_PROPS} viewerBooking={{ state: "pending", evidence: null }} />
    );
    // Anonymous gets exactly the generic card — no personal claim either way.
    expect(anon).toBe(pending);
    expect(anon).not.toContain("You&#x27;re booked");
    expect(anon).not.toContain("staying elsewhere");
  });
});
