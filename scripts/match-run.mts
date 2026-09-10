#!/usr/bin/env npx tsx
/**
 * The nightly match run. Intended to run on the M1 Mac Studio.
 *
 *   npx tsx scripts/match-run.mts --dry-run          # score, report, write nothing
 *   npx tsx scripts/match-run.mts                    # write a run, leave it unpromoted
 *   npx tsx scripts/match-run.mts --promote          # write and promote atomically
 *
 * All logic lives in lib/match/runner.ts. This file only fetches and writes, so
 * the part worth trusting is testable without a database and the part that
 * touches one is short enough to read in a sitting.
 *
 * ── Why psql and not a driver ───────────────────────────────────────────────
 *
 * `COPY … TO STDOUT` / `FROM STDIN` is the right instrument for bulk transfer,
 * and psql is already on the machine. Adding `pg` to the web app's dependency
 * tree for a job that never runs in the web app would be the wrong shape — and
 * this repo holds two dependency vulnerabilities on a deliberate hold, so it is
 * not the place to add surface casually.
 *
 * ── Credentials ─────────────────────────────────────────────────────────────
 *
 * ⛔ Never SUPABASE_SERVICE_ROLE_KEY. That bypasses RLS on every table to do a
 * job that needs four. Use the narrow role from supabase/local/drain-role.sql,
 * with its password in the Keychain rather than a dotfile:
 *
 *   export MATCH_DATABASE_URL="postgresql://csc_drain.kalosjtiwtnwsseitfys:$(security find-generic-password -s csc-match-engine -w)@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require"
 *
 * ── ⚠️ Use the POOLER, not the direct host ──────────────────────────────────
 *
 * `db.<ref>.supabase.co` is AAAA-only, and this machine has no globally routable
 * IPv6 address (its only inet6 is an fd09::/8 ULA). macOS getaddrinfo therefore
 * refuses the name outright — "nodename nor servname provided" — for every
 * address family, even though `host` resolves it happily. `host` queries DNS
 * directly; psql, nc and everything else go through getaddrinfo. Do not conclude
 * from a successful `host` lookup that a connection will work.
 *
 * The pooler has A records and works:
 *
 *   host  aws-1-us-east-2.pooler.supabase.com
 *   port  5432          ← session mode. 6543 is transaction mode and holds no
 *                         session state, so COPY is unreliable there.
 *   user  csc_drain.kalosjtiwtnwsseitfys   ← ⚠️ the pooler requires the project
 *                                            ref appended to the role name
 *
 *   export MATCH_DATABASE_URL="postgresql://csc_drain.kalosjtiwtnwsseitfys:$(security find-generic-password -s csc-match-engine -w)@aws-1-us-east-2.pooler.supabase.com:5432/postgres?sslmode=require"
 *
 * The region was found empirically: a wrong tenant answers "tenant/user not
 * found" while the right one answers "password authentication failed", so a
 * probe with a junk password identifies it without any real credential.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const { runMatch, describeRun } = await import("../lib/match/runner");
const { DEFAULT_MATCH_WEIGHTS } = await import("../lib/match/weights");
const { RESOLVER_VERSION } = await import("../lib/signals/resolve");
type MatchEdgeRow = import("../lib/match/runner").MatchEdgeRow;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const PROMOTE = args.has("--promote");

/**
 * Where the connection comes from, in order.
 *
 * ⚠️ The Keychain is read HERE, at run time — not baked into an exported
 * variable. `export MATCH_DATABASE_URL="…$(security find-generic-password …)…"`
 * expands once, so rotating the password leaves every already-open shell holding
 * a stale credential and failing with "password authentication failed" for no
 * visible reason. Reading it per run makes rotation take effect immediately and
 * makes that failure mode impossible.
 *
 * MATCH_DATABASE_URL still wins if set, for a different host or a one-off.
 */
const KEYCHAIN_SERVICE = process.env.MATCH_KEYCHAIN_SERVICE ?? "csc-match-engine";
const PG_HOSTNAME = process.env.MATCH_PGHOST ?? "aws-1-us-east-2.pooler.supabase.com";
const PG_USERNAME = process.env.MATCH_PGUSER ?? "csc_drain.kalosjtiwtnwsseitfys";

function credentialFromKeychain(): string | null {
  try {
    const pw = execFileSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!pw) return null;
    return `postgresql://${encodeURIComponent(PG_USERNAME)}:${encodeURIComponent(pw)}@${PG_HOSTNAME}:5432/postgres?sslmode=require`;
  } catch {
    // No Keychain item, or the user declined access. Not an error — the caller
    // falls back to read-only.
    return null;
  }
}

const DATABASE_URL = process.env.MATCH_DATABASE_URL ?? credentialFromKeychain();

// A dry run writes nothing, so it does not need the write credential. Without
// MATCH_DATABASE_URL it reads through supabase-js instead and refuses to do
// anything else — which means the scoring half can be exercised against real
// data before the drain role exists, and can never quietly acquire the ability
// to publish by falling back to a wider credential.
const READ_ONLY_FALLBACK = !DATABASE_URL;
if (READ_ONLY_FALLBACK && !DRY_RUN) {
  console.error(
    `No drain credential: MATCH_DATABASE_URL is unset and no Keychain item "${KEYCHAIN_SERVICE}" was readable.\n` +
      "Only --dry-run is available without one.\n\n" +
      "To publish, set the password on the narrow csc_drain role and store it:\n" +
      `  PW=$(openssl rand -hex 32)\n` +
      `  security add-generic-password -U -a csc-drain -s ${KEYCHAIN_SERVICE} -w "$PW"\n` +
      "  # then ALTER ROLE csc_drain WITH PASSWORD as the postgres user\n" +
      "⛔ Never the service role key — it bypasses RLS on every table."
  );
  process.exit(1);
}

/**
 * Connection details as ENVIRONMENT, never as argv.
 *
 * ⛔ An earlier version passed the connection string as a psql argument. Two
 * problems, both real: argv is visible to every process on the machine via `ps`,
 * and Node prints `spawnargs` in the error dump of a failed spawn — so the first
 * COPY failure printed the drain password to the terminal and into a transcript.
 * Environment variables appear in neither.
 */
const PG_ENV: NodeJS.ProcessEnv = (() => {
  if (!DATABASE_URL) return process.env;
  const u = new URL(DATABASE_URL);
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.replace(/^\//, "") || "postgres",
    PGSSLMODE: u.searchParams.get("sslmode") ?? "require",
  };
})();

/** Strip anything credential-shaped before an error reaches a log or a screen. */
function scrub(text: string): string {
  const pw = PG_ENV.PGPASSWORD;
  let out = text;
  if (pw) out = out.split(pw).join("«redacted»");
  return out.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "postgresql://«redacted»");
}

/**
 * Run SQL passed on STDIN.
 *
 * `-f -` rather than `-c` keeps large statements out of argv too, and means the
 * INSERT batches below are never visible in `ps`.
 */
function psql(sql: string): string {
  try {
    return execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-f", "-"], {
      input: sql,
      env: PG_ENV,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(scrub(err.stderr || err.message || "psql failed"));
  }
}

/** One JSON document per query, so nothing has to be CSV-parsed. */
function fetchJson<T>(sql: string): T[] {
  const out = psqlCapture(
    `select coalesce(json_agg(t), '[]'::json)::text from (${sql}) t`
  );
  return JSON.parse(out.trim() || "[]") as T[];
}

function psqlCapture(sql: string): string {
  try {
    return execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-t", "-A", "-f", "-"], {
      input: sql,
      env: PG_ENV,
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(scrub(err.stderr || err.message || "psql failed"));
  }
}

// ── Extract ─────────────────────────────────────────────────────────────────

console.log(
  `extracting${
    READ_ONLY_FALLBACK
      ? " (read-only, via supabase-js)"
      : ` (${PG_USERNAME}@${PG_HOSTNAME}${process.env.MATCH_DATABASE_URL ? ", from MATCH_DATABASE_URL" : ", credential from Keychain"})`
  }…`
);

const ORG_COLUMNS =
  "id, name, type, primary_category, certifications, is_cancoll_member, province, " +
  "company_description, website_summary, fte, institution_type, procurement_info, " +
  "archived_at, is_test";

async function readTable(table: string, columns: string): Promise<Record<string, unknown>[]> {
  if (!READ_ONLY_FALLBACK) return fetchJson(`select ${columns} from ${table}`);
  const { createAdminClient } = await import("../lib/supabase/admin");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createAdminClient() as any).from(table).select(columns);
  // The rollup tables do not exist until the migration lands; an empty signal
  // set is a valid run, so a missing table is not a failure here.
  if (error) return [];
  return (data ?? []) as Record<string, unknown>[];
}

const organizations = await readTable("organizations", ORG_COLUMNS);

// Rollups may not exist on a first run; an empty signal set is a valid run.
const termRollups = (
  await readTable(
    "signal_term_rollup",
    "organization_id, contact_id, term, term_source, stance, polarity, weight, event_count, actor_count, first_seen_at, last_seen_at"
  )
).map((r) => ({
  organizationId: r.organization_id as string,
  contactId: (r.contact_id as string | null) ?? null,
  term: r.term as string,
  termSource: r.term_source as never,
  stance: r.stance as never,
  polarity: r.polarity as never,
  weight: Number(r.weight),
  eventCount: Number(r.event_count),
  actorCount: Number(r.actor_count),
  firstSeenAt: r.first_seen_at ? new Date(r.first_seen_at as string) : null,
  lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at as string) : null,
}));

const affinityRollups = (
  await readTable(
    "signal_affinity_rollup",
    "organization_id, contact_id, object_org_id, stance, polarity, weight, event_count, actor_count, last_seen_at"
  )
).map((r) => ({
  organizationId: r.organization_id as string,
  contactId: (r.contact_id as string | null) ?? null,
  objectOrgId: r.object_org_id as string,
  stance: r.stance as never,
  polarity: r.polarity as never,
  weight: Number(r.weight),
  eventCount: Number(r.event_count),
  actorCount: Number(r.actor_count),
  lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at as string) : null,
}));

console.log(
  `  ${organizations.length} orgs · ${termRollups.length} term rollups · ${affinityRollups.length} affinity rollups`
);

// ── Score ───────────────────────────────────────────────────────────────────

const startedAt = new Date();
const { edges, summary } = runMatch({
  organizations: organizations as never,
  termRollups,
  affinityRollups,
  now: startedAt,
});

console.log("\n" + describeRun(summary));
console.log(`\n${edges.length} edges in ${Date.now() - startedAt.getTime()}ms`);

if (DRY_RUN) {
  console.log("\n--dry-run: nothing written.");
  process.exit(0);
}

// ── Publish ─────────────────────────────────────────────────────────────────
//
// One run row, then the edges by COPY, then an optional atomic promote. Source
// rows are never touched — this job only ever appends its own output.

const runId = psqlCapture(
  `insert into match_runs (status, weights, embedding_model, resolver_version, counts, notes)
   values ('running', $$${JSON.stringify(DEFAULT_MATCH_WEIGHTS)}$$::jsonb, null,
           $$${RESOLVER_VERSION}$$, $$${JSON.stringify(summary)}$$::jsonb, 'match-run.mts')
   returning id`
)
  .split("\n")
  .map((l) => l.trim())
  .find((l) => /^[0-9a-f-]{36}$/.test(l));

if (!runId) {
  console.error("could not read back the run id");
  process.exit(1);
}
console.log(`\nrun ${runId}`);

/**
 * Batched multi-row INSERT, not COPY.
 *
 * ⛔ `COPY FROM` is refused outright on a table with row-level security when the
 * connecting role is subject to RLS — "COPY FROM not supported with row-level
 * security". The alternatives are worse: granting BYPASSRLS to the drain would
 * recreate service_role under another name, and a SECURITY DEFINER wrapper is the
 * exfiltration pattern this design removed on purpose. So: INSERT, batched.
 *
 * 9,226 rows at 500 per statement is ~19 round trips and finishes in seconds —
 * COPY's speed advantage does not matter at this scale, and the RLS policy is
 * worth more than the milliseconds.
 */
const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

const EDGE_COLUMNS =
  "(run_id, direction, subject_org_id, subject_contact_id, candidate_org_id, candidate_contact_id, " +
  "total, score, confidence, rank, breakdown, reasons)";

function valuesFor(e: MatchEdgeRow): string {
  return (
    "(" +
    [
      q(runId!),
      q(e.direction),
      q(e.subjectOrgId),
      e.subjectContactId ? q(e.subjectContactId) : "null",
      q(e.candidateOrgId),
      e.candidateContactId ? q(e.candidateContactId) : "null",
      e.total,
      e.score,
      e.confidence,
      e.rank,
      // ⚠️ Doubling single quotes matters: taxonomy classes include
      // "Men's / Unisex", so an unescaped apostrophe would break the statement
      // and, worse, could end the string literal early.
      `${q(JSON.stringify(e.breakdown))}::jsonb`,
      `${q(JSON.stringify(e.reasons))}::jsonb`,
    ].join(",") +
    ")"
  );
}

const BATCH = 500;
let written = 0;
for (let i = 0; i < edges.length; i += BATCH) {
  const slice = edges.slice(i, i + BATCH);
  psql(`insert into match_edges ${EDGE_COLUMNS} values\n${slice.map(valuesFor).join(",\n")};`);
  written += slice.length;
  if (written % 2500 === 0 || written === edges.length) {
    console.log(`  ${written}/${edges.length}`);
  }
}

// The count is read back rather than assumed: a partial write that did not throw
// would otherwise be promoted as though it were whole.
const stored = Number(
  psqlCapture(`select count(*) from match_edges where run_id = ${q(runId)}`).trim()
);
if (stored !== edges.length) {
  psql(`update match_runs set status='failed', notes='wrote ${stored} of ${edges.length}' where id = ${q(runId)}`);
  console.error(`\nwrote ${stored} of ${edges.length} edges — run marked failed, nothing promoted`);
  process.exit(1);
}

psql(`update match_runs set status='complete', completed_at=now() where id = ${q(runId)}`);
console.log(`wrote ${stored} edges`);

if (!PROMOTE) {
  console.log(`\nnot promoted. To make it live:\n  npx tsx scripts/match-run.mts --promote`);
  process.exit(0);
}

// ⚠️ One transaction. A unique index enforces a single promoted run, so the old
// one must step down in the same batch that promotes the new one — otherwise the
// index rejects the write and the site keeps serving the old run, which is the
// safe failure but a confusing one.
psql(`
  begin;
  update match_runs set status='superseded' where status='promoted' and id <> ${q(runId)};
  update match_runs set status='promoted', promoted_at=now() where id = ${q(runId)};
  commit;
`);
console.log("promoted — this run is now the one the site reads.");
