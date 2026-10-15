/**
 * Resolve the hand-built Big Ideas Day invite list against LIVE org status.
 *
 *   npx tsx scripts/resolve-big-ideas-invite-list.mts [path/to/list.csv]
 *
 * Writes nothing. Prints which variant each contact should receive, and what
 * it could not decide.
 *
 * ⛔ Never freeze this. Status moves in minutes: University of Guelph went
 * locked -> reactivated on 2026-10-06, and four locked members became three
 * the same evening. A list baked on Monday sends a rejoin pitch to somebody
 * who rejoined on Tuesday. Run this the morning of the send and build from
 * what it returns.
 *
 * ⛔ Never fuzzy-match a company to an organization. "Carleton Technologies
 * (Bookware 3000)" and "Bookware" are the same firm; "Jones & Bartlett
 * (Northrose, Canada)" and "Jones & Bartlett Learning" may be two. A wrong
 * match puts a current partner in the reconnect email, which tells someone who
 * pays us that we have forgotten they exist. Unmatched rows are reported, not
 * guessed.
 */
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* env may already be set */
}

const { createAdminClient } = await import("../lib/supabase/admin");

const CSV =
  process.argv[2] ??
  "/Users/Work/Documents/Claude/Projects/Campus Stores Conference/big-ideas-day-invite-list.csv";
const CONF = "7e650b08-51d1-4573-a332-7d6b6fbc50bd";

/**
 * Company name in the CSV -> organizations.name. Hand-written on purpose: each
 * line is a human saying "these two strings are the same firm". Add to it
 * rather than making the matcher cleverer.
 */
const ALIASES: Record<string, string> = {
  "Carleton Technologies (Bookware 3000)": "Bookware",
};

type Row = { Company: string; Contact: string; Title: string; Email: string; Source: string; Category: string };

function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...rest] = rows.filter((r) => r.some((c) => c.trim()));
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])) as Row);
}

const rows = parseCsv(readFileSync(CSV, "utf8"));
const db = createAdminClient();

// ── Live org status ──────────────────────────────────────────────
const { data: orgs } = await db
  .from("organizations")
  .select("id, name, type, membership_status")
  .is("archived_at", null)
  .or("is_test.is.null,is_test.eq.false");

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const byNorm = new Map((orgs ?? []).map((o) => [norm(o.name), o]));

// ── Who holds a booth that grants Big Ideas Day (any booth does) ──
const { data: balances } = await db
  .from("entity_balances")
  .select("organization_id, conference_entities!inner(kind)")
  .eq("conference_id", CONF)
  .gt("quantity", 0);
const holdsBooth = new Set(
  (balances ?? [])
    .filter((b) => {
      const e = Array.isArray(b.conference_entities) ? b.conference_entities[0] : b.conference_entities;
      return e?.kind === "booth";
    })
    .map((b) => b.organization_id)
);

const ACTIVE = new Set(["active", "reactivated"]);

type Verdict =
  | "BIG IDEAS · BOOTH HOLDER"
  | "BIG IDEAS · OPS"
  | "BIG IDEAS · PUBLISHER"
  | "BIG IDEAS RECONNECT · TECH"
  | "BIG IDEAS RECONNECT · PUBLISHER";

/**
 * The salutation, resolved per contact rather than left to {{first_name}}.
 *
 * ⛔ 11 rows on this list are shared inboxes with no human behind them
 * (info@, CAPTeam@, partnerships@). {{first_name}} falls back to the email
 * handle, so those would read "Hi CAPTeam,". A bare "Hi," is what a person
 * writing to a shared inbox would actually type.
 */
function greetingFor(contact: string): string {
  const first = contact.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : "Hi,";
}

const counts = new Map<string, number>();
const unmatched: Row[] = [];
const greetings = new Map<string, string>();
const noName: Row[] = [];
const resolved: Array<Row & { verdict: Verdict; org: string | null; status: string }> = [];

for (const r of rows) {
  if (!r.Email) continue;
  if (!r.Contact) noName.push(r);

  const lookup = ALIASES[r.Company] ?? r.Company;
  const org = byNorm.get(norm(lookup));
  const isPublisher = r.Category.toLowerCase().startsWith("publisher");

  if (!org) {
    unmatched.push(r);
    const v: Verdict = isPublisher ? "BIG IDEAS RECONNECT · PUBLISHER" : "BIG IDEAS RECONNECT · TECH";
    resolved.push({ ...r, verdict: v, org: null, status: "no org record" });
    greetings.set(r.Email, greetingFor(r.Contact));
    counts.set(v, (counts.get(v) ?? 0) + 1);
    continue;
  }

  const partnerNow = org.type === "Vendor Partner" && ACTIVE.has(org.membership_status ?? "");
  let v: Verdict;
  if (partnerNow && holdsBooth.has(org.id)) v = "BIG IDEAS · BOOTH HOLDER";
  else if (partnerNow) v = isPublisher ? "BIG IDEAS · PUBLISHER" : "BIG IDEAS · OPS";
  else v = isPublisher ? "BIG IDEAS RECONNECT · PUBLISHER" : "BIG IDEAS RECONNECT · TECH";

  resolved.push({ ...r, verdict: v, org: org.name, status: org.membership_status ?? "?" });
  greetings.set(r.Email, greetingFor(r.Contact));
  counts.set(v, (counts.get(v) ?? 0) + 1);
}

console.log(`resolved ${resolved.length} contacts, ${new Set(rows.map((r) => r.Company)).size} companies\n`);
for (const [v, n] of [...counts].sort()) console.log(`  ${String(n).padStart(3)}  ${v}`);

console.log(`\nCURRENT PARTNERS on the list (they get the partner version, not the reconnect):`);
const partners = resolved.filter((r) => r.verdict.startsWith("BIG IDEAS ·"));
for (const [org, items] of Object.entries(
  partners.reduce<Record<string, typeof partners>>((a, r) => ((a[r.org!] ??= []).push(r), a), {})
)) {
  console.log(`  ${org} (${items[0].status}) — ${items.length} contacts → ${items[0].verdict}`);
}

console.log(`\n⚠️  NO ORG RECORD — treated as reconnect. Confirm none is a current partner under another name:`);
for (const c of [...new Set(unmatched.map((u) => u.Company))]) console.log(`     ${c}`);

console.log(`\nSHARED INBOXES — greeting resolves to a bare "Hi," not the email handle:`);
for (const r of noName) console.log(`     ${greetings.get(r.Email)!.padEnd(6)} ${r.Email.padEnd(40)} ${r.Company}`);
