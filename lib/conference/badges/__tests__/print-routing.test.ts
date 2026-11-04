import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ⛔ Each desk can keep its own printer (Stephen, 2026-10-22). A job routed to
 * a station (metadata.print_station_id) is claimed by that station only; an
 * unrouted job by whichever station gets it first, which with one printer is
 * today's behaviour unchanged.
 */

vi.mock("server-only", () => ({}));

type Job = { id: string; person_id: string; status: string; updated_at: string; metadata: Record<string, unknown> | null };
let jobs: Job[] = [];
const claimed: string[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      let patch: Record<string, unknown> | null = null;
      const filters: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ["select", "in", "order", "limit"]) b[m] = () => b;
      b.eq = (k: string, v: unknown) => {
        filters[k] = v;
        return b;
      };
      b.update = (p: Record<string, unknown>) => {
        patch = p;
        return b;
      };
      b.insert = () => Promise.resolve({ error: null });
      b.maybeSingle = () => {
        if (table === "badge_print_jobs" && patch?.status === "rendering") {
          claimed.push(String(filters.id));
          return Promise.resolve({ data: { id: filters.id }, error: null });
        }
        return Promise.resolve({ data: table === "conference_people" ? { display_name: "Dana" } : null, error: null });
      };
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === "badge_print_jobs" ? jobs : [], error: null }).then(resolve);
      return b;
    },
  }),
}));

const { claimNextJob } = await import("../print-station-server");

const station = (id: string) => ({ id, conferenceId: "conf-1", label: id, createdBy: null });
const plan = { reprint_plan: { stock: "company_blank", transport: "ql_label", delta: ["name"] } };

beforeEach(() => {
  claimed.length = 0;
  jobs = [
    { id: "for-b", person_id: "p1", status: "sent_to_printer", updated_at: "2027-02-01T10:00:00Z", metadata: { ...plan, print_station_id: "station-b" } },
    { id: "for-anyone", person_id: "p2", status: "sent_to_printer", updated_at: "2027-02-01T10:01:00Z", metadata: plan },
  ];
});

describe("routing a reprint to a desk's printer", () => {
  it("another desk's job is skipped; an unrouted one is taken", async () => {
    const job = await claimNextJob(station("station-a"));
    expect(job?.jobId).toBe("for-anyone");
    expect(claimed).toEqual(["for-anyone"]);
  });

  it("the job routed to this station is its to print", async () => {
    const job = await claimNextJob(station("station-b"));
    expect(job?.jobId).toBe("for-b");
  });
});
