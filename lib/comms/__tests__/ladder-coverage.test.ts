import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

/**
 * The ladder is only real if every messaging sender declares where it sits.
 * A sender that forgets claims nothing, so onboarding will happily write to
 * someone it just mailed — the exact failure this was built to stop.
 */
const MESSAGING_SENDERS: Record<string, string> = {
  "lib/renewal/jobs.ts": "lapse",
  "lib/conference/checklist-engine.ts": "deadline",
  "lib/elections/notify.ts": "deadline",
  "lib/benchmarking/notify.ts": "deadline",
  "lib/rfps/notify.ts": "event",
  "lib/onboarding/nudge-job.ts": "onboarding",
};

/**
 * ⛔ These must NEVER declare a priority. Everything here is earned by the
 * person's own action, and arbitrating a password reset or a receipt is a bug.
 */
const SYSTEM_SENDERS = [
  "lib/actions/user-management.ts",
  "lib/actions/event-tickets.ts",
  "lib/actions/event-registration.ts",
  "lib/identity/org-login.ts",
  "lib/stripe/webhook-processing.ts",
  "lib/stripe/billing.ts",
  "lib/actions/applications.ts",
  "lib/actions/admin-transfer.ts",
];

describe("every messaging sender declares its rung", () => {
  it.each(Object.entries(MESSAGING_SENDERS))("%s declares %s", (file, rung) => {
    const src = read(file);
    expect(src).toContain("MESSAGING_PRIORITY");
    expect(src).toContain(`MESSAGING_PRIORITY.${rung}`);
  });
});

describe("system mail stays off the ladder", () => {
  it.each(SYSTEM_SENDERS)("%s declares no priority", (file) => {
    expect(read(file)).not.toContain("MESSAGING_PRIORITY");
  });
});

describe("the ladder is threaded, not re-decided per sender", () => {
  it("campaigns default to campaign priority rather than nothing", () => {
    expect(read("lib/comms/send.ts")).toContain("options.priority ?? MESSAGING_PRIORITY.campaign");
  });

  it("transactional sends default to OFF the ladder", () => {
    expect(read("lib/comms/send.ts")).toContain("options.priority ?? null");
  });
});
