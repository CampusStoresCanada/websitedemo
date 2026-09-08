import { describe, it, expect, vi } from "vitest";
import { withTimeout } from "../with-timeout";

describe("withTimeout", () => {
  it("returns the value when the work finishes in time", async () => {
    await expect(withTimeout(async () => "ok", 200, "fast")).resolves.toBe("ok");
  });

  it("rejects with a labelled error when it does not", async () => {
    await expect(
      withTimeout(() => new Promise((r) => setTimeout(() => r("late"), 200)), 30, "slow")
    ).rejects.toThrow("slow timed out after 30ms");
  });

  it("⛔ ABORTS the work it stops waiting for", async () => {
    // The whole point. The old Promise.race version passed every other test here
    // and still leaked four in-flight Supabase queries per timed-out attempt.
    let aborted = false;
    const p = withTimeout(
      (signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
      20,
      "cancels"
    );
    await expect(p).rejects.toThrow(/timed out/);
    expect(aborted).toBe(true);
  });

  it("hands the same signal to the work, so a caller can pass it onward", async () => {
    let seen: AbortSignal | null = null;
    await withTimeout(async (signal) => { seen = signal; return 1; }, 200, "x");
    expect(seen).toBeInstanceOf(AbortSignal);
    expect((seen as unknown as AbortSignal).aborted).toBe(false);
  });

  it("⚠️ still times out when the work IGNORES the signal", async () => {
    // supabase-js auth methods take no abort signal. Aborting must never be the
    // only mechanism, or fixing the leak would trade it for a hang.
    await expect(
      withTimeout(() => new Promise(() => {}), 20, "stubborn")
    ).rejects.toThrow("stubborn timed out after 20ms");
  });

  it("clears its timer on success, so a resolved call leaves nothing pending", async () => {
    const clear = vi.spyOn(globalThis, "clearTimeout");
    await withTimeout(async () => "done", 500, "tidy");
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });

  it("does not abort work that finished in time", async () => {
    let aborted = false;
    await withTimeout(async (signal) => {
      signal.addEventListener("abort", () => { aborted = true; });
      return "done";
    }, 200, "quick");
    // Give any stray timer a chance to fire before asserting it did not.
    await new Promise((r) => setTimeout(r, 250));
    expect(aborted).toBe(false);
  });
});
