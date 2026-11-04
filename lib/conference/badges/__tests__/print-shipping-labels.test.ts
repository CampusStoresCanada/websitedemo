import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Shipping labels share the badge printer (Steve, 2026-11-04: one printer,
 * swap rolls). They go only to a station that says it can print them, and a
 * refused one goes back to WAITING for the next "Print the shipping labels",
 * never round the queue every few seconds while the badge roll is in.
 */

vi.mock("server-only", () => ({}));

type Job = { id: string; person_id: string; status: string; updated_at: string; pipeline_type: string; metadata: Record<string, unknown> };
let jobs: Job[] = [];
let pipelinesAsked: string[] = [];
const updates: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      let patch: Record<string, unknown> | null = null;
      const filters: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ["select", "order", "limit"]) b[m] = () => b;
      b.in = (k: string, v: string[]) => {
        if (k === "pipeline_type") pipelinesAsked = v;
        return b;
      };
      b.eq = (k: string, v: unknown) => {
        filters[k] = v;
        return b;
      };
      b.update = (p: Record<string, unknown>) => {
        patch = p;
        updates.push(p);
        return b;
      };
      b.insert = () => Promise.resolve({ error: null });
      b.maybeSingle = () => {
        if (table === "badge_print_jobs" && patch?.status === "rendering") {
          return Promise.resolve({ data: { id: filters.id }, error: null });
        }
        if (table === "badge_print_jobs" && !patch) {
          const job = jobs.find((j) => j.id === filters.id);
          return Promise.resolve({ data: job ? { pipeline_type: job.pipeline_type } : null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: table === "badge_print_jobs" ? jobs.filter((j) => pipelinesAsked.includes(j.pipeline_type)) : [],
          error: null,
        }).then(resolve);
      return b;
    },
  }),
}));

const { claimNextJob, finishJob } = await import("../print-station-server");

const station = { id: "station-a", conferenceId: "conf-1", label: "Desk", createdBy: null };

beforeEach(() => {
  updates.length = 0;
  pipelinesAsked = [];
  jobs = [
    {
      id: "labels",
      person_id: "p1",
      status: "sent_to_printer",
      updated_at: "2027-02-02T10:00:00Z",
      pipeline_type: "shipping_label",
      metadata: { shipment_id: "s1", label: "CSC27-ABCDE · Pat · 2 boxes", boxes: 2 },
    },
  ];
});

describe("handing out shipping labels", () => {
  it("only to a station that says it prints them", async () => {
    expect(await claimNextJob(station, { acceptsDocuments: true })).toBeNull();
    expect(pipelinesAsked).not.toContain("shipping_label");

    const job = await claimNextJob(station, { acceptsDocuments: true, acceptsShippingLabels: true });
    expect(job).toEqual({ jobId: "labels", kind: "shipping_label", title: "CSC27-ABCDE · Pat · 2 boxes", boxes: 2 });
  });
});

describe("a refused print", () => {
  it("sends a shipping label back to waiting for the roll swap", async () => {
    await finishJob(station, "labels", "p1", { ok: false, retry: true, error: "Replace media error" });
    expect(updates.at(-1)?.status).toBe("queued");
  });

  it("still puts a sticker back on the queue, as before", async () => {
    jobs.push({ ...jobs[0], id: "sticker", pipeline_type: "onsite_reprint" });
    await finishJob(station, "sticker", "p1", { ok: false, retry: true, error: "Replace media error" });
    expect(updates.at(-1)?.status).toBe("sent_to_printer");
  });

  it("marks a printed shipping label printed", async () => {
    await finishJob(station, "labels", "p1", { ok: true, retry: false });
    expect(updates.at(-1)?.status).toBe("printed");
  });
});
