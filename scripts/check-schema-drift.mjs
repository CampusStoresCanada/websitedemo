#!/usr/bin/env node
/**
 * Fails when a Supabase `.select()` names a column the table does not have.
 *
 * Why this exists: the v3 cutover dropped eight columns from
 * `conference_people`, and `lib/actions/conference-badges.ts` kept selecting
 * them. Postgres rejects the whole statement on the first missing column, but
 * the caller read the result as `.data ?? []` with no error check — so a hard
 * query failure surfaced as "0 people, 0 issues, preflight passed" on every
 * badge run. Nothing in tsc, eslint or the test suite catches that: select
 * strings are opaque to the type system.
 *
 * Reads the generated `lib/database.types.ts` rather than the live database, so
 * it needs no credentials and runs in CI. That does mean it is only as current
 * as the last types regen — run it after every regen.
 *
 * Deliberately conservative. It skips anything it cannot read with certainty
 * (embedded relations, computed select strings) because a false positive that
 * blocks a build is worse than a missed one: nobody trusts a noisy gate.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SKIP = ["node_modules", ".next", ".git", ".claude", "database.types"];

/** table -> Set(columns), parsed out of the generated Row blocks. */
function loadSchema() {
  const src = readFileSync(join(ROOT, "lib/database.types.ts"), "utf8");
  const schema = new Map();
  // `      <table>: {\n        Row: {\n ... }` — indentation is stable in generated output.
  const re = /^ {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/gm;
  let m;
  while ((m = re.exec(src))) {
    const cols = new Set();
    for (const line of m[2].split("\n")) {
      const c = line.match(/^ {10}(\w+)\??:/);
      if (c) cols.add(c[1]);
    }
    if (cols.size) schema.set(m[1], cols);
  }
  return schema;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.some((s) => name.includes(s))) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** Split on commas that are not inside an embedded-relation paren group. */
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function columnsOf(sel) {
  const cols = [];
  for (const tok of splitTop(sel)) {
    let t = tok.trim().replace(/\s+/g, " ");
    // `*` is fine; a paren means an embedded relation, whose columns belong to
    // another table entirely.
    if (!t || t === "*" || t.includes("(")) continue;
    if (t.includes("->")) t = t.split("->")[0].trim(); // jsonb path
    if (t.includes(":")) t = t.split(":", 2)[1].trim(); // alias:real_column
    t = t.split(".")[0].trim();
    if (/^[a-z_][a-z0-9_]*$/.test(t)) cols.push(t);
  }
  return cols;
}

const schema = loadSchema();
if (!schema.size) {
  console.error("Could not parse any tables out of lib/database.types.ts — has the generator's output shape changed?");
  process.exit(2);
}

const findings = [];
for (const file of walk(ROOT)) {
  const src = readFileSync(file, "utf8");
  const consts = new Map(
    [...src.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*[`"']([^`"']*)[`"']/g)].map((m) => [m[1], m[2]])
  );
  for (const m of src.matchAll(/\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)/g)) {
    const table = m[1];
    const cols = schema.get(table);
    if (!cols) continue; // a view or RPC-backed name we cannot verify
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 1500);
    const sm = tail.match(/\.select\(\s*(?:[`"']([^`"']*)[`"']|([A-Z][A-Z0-9_]*))/);
    if (!sm) continue;
    // If a write call comes first, that `.select()` belongs to a later
    // statement, not this `.from()`. Missing this is what made an early
    // version of this check report 76 hits, of which 71 were noise.
    const other = tail.match(/\.(insert|update|delete|upsert)\(/);
    if (other && other.index < sm.index) continue;
    const sel = sm[1] !== undefined ? sm[1] : consts.get(sm[2]);
    if (sel === undefined) continue;
    const bad = [...new Set(columnsOf(sel).filter((c) => !cols.has(c)))];
    if (bad.length) {
      const line = src.slice(0, m.index).split("\n").length;
      findings.push({ table, file: file.replace(ROOT + "/", ""), line, bad });
    }
  }
}

if (!findings.length) {
  console.log(`schema drift: none (${schema.size} tables checked)`);
  process.exit(0);
}
console.error(`schema drift: ${findings.length} select(s) disagree with lib/database.types.ts\n`);
for (const f of findings.sort((a, b) => a.table.localeCompare(b.table))) {
  console.error(`  ${f.table}  ${f.file}:${f.line}`);
  console.error(`      not in types: ${f.bad.join(", ")}\n`);
}
console.error(
  "Each of these is one of two things, and they need opposite fixes:\n" +
    "  1. The select is wrong — the column was dropped. Fix the query.\n" +
    "  2. The types are stale — the column exists live but predates the last\n" +
    "     regen. Regenerate lib/database.types.ts.\n" +
    "Check the live column list before assuming which; guessing here is how a\n" +
    "correct query gets 'fixed' into a broken one."
);
process.exit(1);
