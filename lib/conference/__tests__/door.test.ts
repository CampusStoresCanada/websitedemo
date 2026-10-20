import { describe, expect, it } from "vitest";
import {
  doorChoiceStillValid,
  doorChoiceUntil,
  doorEventsOpenNow,
  parseDoorChoice,
  serializeDoorChoice,
  type DoorEvent,
} from "../door";

const TZ = "America/Toronto";
// Toronto in February is UTC-5.
const at = (wall: string) => new Date(`${wall}-05:00`);

const meetAndGreet: DoorEvent = {
  id: "mg",
  name: "Meet & Greet Reception",
  date: "2027-02-01",
  startTime: "17:30",
  endTime: "21:00",
  capped: true,
};
const offsite: DoorEvent = { id: "off", name: "Wednesday Offsite", date: "2027-02-03", startTime: "17:30", endTime: "22:00", capped: true };
const keynote: DoorEvent = { id: "key", name: "Keynote", date: "2027-02-04", startTime: "08:30", endTime: "09:30", capped: false };
const events = [meetAndGreet, offsite, keynote];

describe("which events the desk offers", () => {
  it("offers a capped event from an hour before it starts to an hour after it ends", () => {
    expect(doorEventsOpenNow(events, at("2027-02-01T16:29:00"), TZ)).toEqual([]);
    expect(doorEventsOpenNow(events, at("2027-02-01T16:30:00"), TZ).map((e) => e.id)).toEqual(["mg"]);
    expect(doorEventsOpenNow(events, at("2027-02-01T22:00:00"), TZ).map((e) => e.id)).toEqual(["mg"]);
    expect(doorEventsOpenNow(events, at("2027-02-01T22:01:00"), TZ)).toEqual([]);
  });

  it("never offers an uncapped event on its own — the Keynote is not a door", () => {
    expect(doorEventsOpenNow(events, at("2027-02-04T08:45:00"), TZ)).toEqual([]);
  });

  it("lists every capped event whose window is open, earliest first", () => {
    const tradeShow: DoorEvent = { id: "ts", name: "Tuesday Evening Trade Show", date: "2027-02-02", startTime: "18:00", endTime: "20:00", capped: true };
    const reception: DoorEvent = { id: "rx", name: "Reception", date: "2027-02-02", startTime: "17:15", endTime: "18:00", capped: true };
    expect(doorEventsOpenNow([tradeShow, reception], at("2027-02-02T17:45:00"), TZ).map((e) => e.id)).toEqual(["rx", "ts"]);
  });

  it("handles an evening that runs past midnight", () => {
    const late: DoorEvent = { id: "late", name: "Late", date: "2027-02-03", startTime: "21:00", endTime: "01:00", capped: true };
    expect(doorEventsOpenNow([late], at("2027-02-04T01:30:00"), TZ).map((e) => e.id)).toEqual(["late"]);
  });
});

describe("how long a device remembers its pick", () => {
  it("picked during the window: until the window closes", () => {
    expect(doorChoiceUntil(meetAndGreet, at("2027-02-01T18:00:00"), TZ)).toBe(new Date(at("2027-02-01T22:00:00")).toISOString());
  });

  it("picked by hand afterwards (reconciling): two hours from now", () => {
    const now = at("2027-02-02T09:00:00");
    expect(doorChoiceUntil(meetAndGreet, now, TZ)).toBe(new Date(now.getTime() + 2 * 3600_000).toISOString());
  });

  it("lapses once its time is up, so it cannot leak into the next morning", () => {
    const choice = { entityId: "mg", until: new Date(at("2027-02-01T22:00:00")).toISOString() };
    expect(doorChoiceStillValid(choice, events, at("2027-02-01T21:59:00"))).toBe(true);
    expect(doorChoiceStillValid(choice, events, at("2027-02-02T08:00:00"))).toBe(false);
  });

  it("forgets a pick for an event this conference no longer has", () => {
    expect(doorChoiceStillValid({ entityId: "gone", until: "2099-01-01T00:00:00Z" }, events, at("2027-02-01T18:00:00"))).toBe(false);
  });

  it("round-trips through the cookie, and ignores junk", () => {
    const choice = { entityId: "mg", until: "2027-02-02T03:00:00.000Z" };
    expect(parseDoorChoice(serializeDoorChoice(choice))).toEqual(choice);
    expect(parseDoorChoice("not json")).toBeNull();
    expect(parseDoorChoice(null)).toBeNull();
  });
});
