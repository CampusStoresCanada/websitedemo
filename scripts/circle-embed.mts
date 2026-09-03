#!/usr/bin/env npx tsx
/**
 * Embed the community's own words and cluster them, so a human can label the
 * clusters instead of anyone writing another word list.
 *
 *   npx tsx scripts/circle-embed.mts --fetch        # pull posts + comments, embed, cache
 *   npx tsx scripts/circle-embed.mts --clusters 24  # re-cluster from cache (no refetch)
 *
 * ⛔ Writes nothing to the database. The cache is a local JSON file so that
 * re-clustering — which a human will want to do several times while labelling —
 * never re-embeds and never re-fetches.
 *
 * Embedding runs on a local ollama (nomic-embed-text, 768 dims) — no API, no
 * per-token cost, and the corpus never leaves the machine.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { getCircleClient } = await import("../lib/circle/client");
const { createAdminClient } = await import("../lib/supabase/admin");
const { postBodyText } = await import("../lib/signals/circle-backfill");
const { kmeans, centroid, representatives, normalize } = await import("../lib/signals/embedding");
const { resolveDocument } = await import("../lib/signals/resolve");

const args = process.argv.slice(2);
const FETCH = args.includes("--fetch");
// Refresh the corpus and stop. The clustering below is a labelling aid for a
// human at a screen; the nightly only needs the cache rewritten, and running
// kmeans over 8,900 documents to throw the answer away is pure waste.
const FETCH_ONLY = args.includes("--fetch-only");
const kIdx = args.indexOf("--clusters");
const K = kIdx >= 0 ? Number(args[kIdx + 1]) : 20;

const CACHE = new URL("../.cache/circle-corpus.json", import.meta.url).pathname;
const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const MODEL = process.env.EMBED_MODEL ?? "nomic-embed-text";

interface Doc {
  kind: "post" | "comment";
  id: number;
  postId: number;
  space: string;
  author: string | null;
  text: string;
  vector?: number[];
}

async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  return (await res.json()).embeddings as number[][];
}

let docs: Doc[] = [];

if (FETCH || FETCH_ONLY || !existsSync(CACHE)) {
  const circle = getCircleClient();
  if (!circle) {
    console.error("No Circle client — CIRCLE_API_KEY not set.");
    process.exit(1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = createAdminClient() as any;

  const { data: maps } = await q
    .from("circle_member_mapping")
    .select("circle_member_id, contacts(name, organizations(name))")
    .not("contact_id", "is", null);
  const byMemberId = new Map<number, string>();
  for (const m of maps ?? []) {
    const ct = (m as { contacts?: { name: string; organizations?: { name: string } } }).contacts;
    if (ct) byMemberId.set(Number((m as { circle_member_id: number }).circle_member_id),
      `${ct.name} · ${ct.organizations?.name ?? "?"}`);
  }
  const emailMap = await circle.buildEmailMap();
  const byUserId = new Map<number, string>();
  for (const mem of emailMap.values() as Iterable<{ id: number; user_id?: number }>) {
    const who = byMemberId.get(mem.id);
    if (who && mem.user_id != null) byUserId.set(mem.user_id, who);
  }

  const spaces = await circle.listSpaces();
  console.log(`fetching posts and comments from ${spaces.length} spaces…`);

  for (const space of spaces) {
    const posts: Awaited<ReturnType<typeof circle.listPosts>> = [];
    for (let page = 1; page <= 20; page++) {
      const batch = await circle.listPosts(space.id, { per_page: 100, page });
      if (batch.length === 0) break;
      posts.push(...batch);
      if (batch.length < 100) break;
    }
    if (posts.length === 0) continue;

    for (const p of posts) {
      const text = [p.name, postBodyText(p.body)].filter(Boolean).join(". ").slice(0, 2000);
      if (text.length > 20) {
        docs.push({ kind: "post", id: p.id, postId: p.id, space: space.name,
                    author: byUserId.get(p.user_id) ?? null, text });
      }
      // ⛔ The replies are the half that was never fetched, and they carry the
      // answers — who a member was pointed at, and which partner volunteered.
      for (const cm of await circle.listComments(p.id)) {
        const body = postBodyText(cm.body).slice(0, 2000);
        if (body.length > 20) {
          docs.push({ kind: "comment", id: cm.id, postId: p.id, space: space.name,
                      author: byUserId.get(cm.user_id) ?? null, text: body });
        }
      }
    }
    process.stdout.write(`  ${space.name}: ${docs.length} docs\r`);
  }
  console.log(`\n${docs.length} documents`);

  console.log(`embedding on ${MODEL} (local)…`);
  const BATCH = 32;
  for (let i = 0; i < docs.length; i += BATCH) {
    const slice = docs.slice(i, i + BATCH);
    const vectors = await embed(slice.map((d) => d.text));
    slice.forEach((d, j) => { d.vector = normalize(vectors[j]); });
    process.stdout.write(`  ${Math.min(i + BATCH, docs.length)}/${docs.length}\r`);
  }
  console.log();

  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(docs));
  console.log(`cached → ${CACHE}\n`);
  if (FETCH_ONLY) process.exit(0);
} else {
  docs = JSON.parse(readFileSync(CACHE, "utf8")) as Doc[];
  console.log(`${docs.length} documents from cache\n`);
}

const vectors = docs.map((d) => d.vector!).filter(Boolean);
const clusters = kmeans(vectors, K);

console.log(`${clusters.length} clusters over ${vectors.length} documents\n`);
console.log("Label each cluster. Clusters that match NO taxonomy term are the");
console.log("evidence for categories that should exist.\n");

for (const [n, c] of clusters.entries()) {
  const mid = centroid(vectors, c.members);
  const reps = representatives(c, vectors, mid, 5);

  // What today's rule-based resolver would have said, for comparison only.
  const guessed = new Map<string, number>();
  for (const i of c.members) {
    for (const t of resolveDocument(docs[i].text).terms) guessed.set(t, (guessed.get(t) ?? 0) + 1);
  }
  const top = [...guessed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([t, n2]) => `${t} ${Math.round((100 * n2) / c.members.length)}%`);

  const comments = c.members.filter((i) => docs[i].kind === "comment").length;
  console.log(`── cluster ${String(n + 1).padStart(2)} · ${c.members.length} docs ` +
    `(${comments} replies) · cohesion ${c.cohesion.toFixed(2)}`);
  if (top.length) console.log(`   rules would say: ${top.join(" · ")}`);
  for (const i of reps) {
    const d = docs[i];
    console.log(`   ${d.kind === "post" ? "▸" : " ↳"} ${d.text.replace(/\s+/g, " ").slice(0, 96)}`);
  }
  console.log();
}
