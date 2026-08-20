/**
 * Known-bad snapshot of GRANT-vs-RLS-policy drift, taken 2026-08-20.
 *
 * The `db_access_drift()` RPC reports the live state; this file records what we
 * already knew about at the time so the alert fires on NEW drift only. Without
 * a baseline the rule would open ~70 alerts on its first run, get ignored
 * within a week, and be worth nothing when it finally had something real to say.
 *
 * Adding an entry here means "we know, and we've decided not to fix it yet."
 * Removing one means the underlying disagreement is gone. Neither should happen
 * casually — see [[feedback_rls_grants_silent_write_failures]] for why these
 * two failure modes are so hard to spot from the app side.
 */

/** Tables the anon key can write to: anon write GRANT + an unconditional policy.
 *  The anon key ships in the browser bundle, so this means the public internet.
 *  These are open doors we deliberately deferred rather than fixed. */
export const BASELINE_ANON_WRITABLE: readonly string[] = [
  // Empty, and worth keeping that way. The three that were here — shipments,
  // survey_invitations, survey_responses — were closed by 20260820203850:
  // retired token-link features whose policies were all `using (true)`, with
  // read exposure worse than the writes. Anything appearing here again is a
  // table the public internet can write to, and should be treated as an
  // incident rather than a baseline entry.
];

/** Tables where `authenticated` holds a write GRANT with no matching RLS policy.
 *  Writes through the session client match zero rows and report success. Every
 *  one of these is a loaded gun for the next person who writes a server action
 *  without reaching for createAdminClient(). */
export const BASELINE_SILENT_NOOP: Readonly<Record<string, string>> = {
  contacts: "INSERT UPDATE DELETE",
  organizations: "INSERT UPDATE DELETE",
  // shipments left this list via 20260820203850 — revoking its `authenticated`
  // grants removed the GRANT half of the disagreement outright.
  qbo_conference_receipt_queue: "INSERT UPDATE",
  qbo_conference_refund_queue: "INSERT UPDATE",
  qbo_membership_refund_queue: "INSERT UPDATE",
  qbo_misc_receipt_queue: "INSERT UPDATE",
};

/**
 * The public schema's default privileges, as of 2026-08-20.
 *
 * Supabase ships `anon` and `authenticated` in this list. They are absent here,
 * and no migration in this repo changes it — so it was altered outside the
 * migration path. That is the root cause of the ~67 dead policies: every table
 * created since is born with no grants for `authenticated`, so any RLS policy
 * written for that role has never been evaluated.
 *
 * We watch this rather than "fix" it. Restoring the stock default would hand
 * `authenticated` blanket DML on every future table, and several existing
 * policies are `using (true)` — that would open them to any logged-in user.
 * The current value is the safer one; it just needs to be a deliberate choice
 * rather than a forgotten one.
 */
export const BASELINE_DEFAULT_ACL: readonly string[] = [
  "{service_role=arwdDxtm/postgres}",
  "{service_role=rwU/postgres}",
  "{service_role=X/postgres}",
];

export type DbAccessDriftReport = {
  anon_writable: string[];
  silent_noop: Record<string, string>;
  dead_policy: Record<string, string>;
  default_acl: string[];
};

export type DbAccessDriftFinding =
  | { kind: "anon_writable"; table: string; commands: null }
  | { kind: "silent_noop"; table: string; commands: string }
  | { kind: "default_acl"; table: null; commands: null };

/**
 * Diff a live report against the baseline. Pure — no DB, no clock — so the
 * comparison itself is testable without a database.
 *
 * Deliberately NOT reported: new `dead_policy` tables. This project adds tables
 * often, the house pattern is to write through createAdminClient(), and the
 * altered default ACL means every new table lands here automatically. Alerting
 * on all of them would bury the two findings that actually matter. They stay in
 * the RPC output for anyone reading it directly.
 */
export function diffDbAccessDrift(report: DbAccessDriftReport): DbAccessDriftFinding[] {
  const findings: DbAccessDriftFinding[] = [];

  const knownAnon = new Set(BASELINE_ANON_WRITABLE);
  for (const table of report.anon_writable ?? []) {
    if (!knownAnon.has(table)) {
      findings.push({ kind: "anon_writable", table, commands: null });
    }
  }

  for (const [table, commands] of Object.entries(report.silent_noop ?? {})) {
    const known = BASELINE_SILENT_NOOP[table];
    // A table already in the baseline still counts as new drift if it has
    // gained a command since — a qbo queue going from "INSERT UPDATE" to
    // "INSERT UPDATE DELETE" means a fresh write path just started vanishing.
    if (known === undefined || commands !== known) {
      findings.push({ kind: "silent_noop", table, commands });
    }
  }

  const liveAcl = [...(report.default_acl ?? [])].sort();
  const baseAcl = [...BASELINE_DEFAULT_ACL].sort();
  if (liveAcl.length !== baseAcl.length || liveAcl.some((v, i) => v !== baseAcl[i])) {
    findings.push({ kind: "default_acl", table: null, commands: null });
  }

  return findings;
}
