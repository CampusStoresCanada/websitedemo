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

  /**
   * Comments come from the cache `circle-comments.mts` just built, NOT from one
   * API call per post.
   *
   * ⛔ Both scripts fetched the same comments, minutes apart, in the same nightly.
   * This one walked 787 posts at one `listComments` call each; the other pulls all
   * 3,033 comments from the global `/comments` endpoint in ~31 paginated calls and
   * caches them with postId, spaceName, userId and userName already on every
   * record. Everything needed here was already on disk.
   *
   * ⚠️ The redundancy was mine: 58ac3d0 added listComments without checking that
   * circle-comments.mts already had the data. ~800 Circle calls a night, every
   * night — the largest of the three standing Circle costs, ahead of badge polling
   * and the RSVP cron. Reading the cache takes the nightly from ~850 to ~50.
   *
   * ⚠️ The nightly runs circle-comments.mts FIRST so this cache is today's. If it
   * is absent we fall back to fetching per post rather than quietly embedding a
   * corpus with no replies — half of every thread missing would read as a quiet
   * community rather than a broken fetch.
   */
  const COMMENT_CACHE = ".cache/circle-comments.json";
  type CachedComment = { id: number; postId: number | null; body: string; userId: number | null };
  const commentsByPost = new Map<number, CachedComment[]>();
  if (!existsSync(COMMENT_CACHE)) {
    // ⛔ REFUSE, rather than fall back to one API call per post.
    //
    // A fallback here is how the leak survives its own fix. The expensive path
    // would still exist, would fire whenever .cache was wiped or on any fresh
    // clone, and would do it silently — which is exactly how ~11,000 calls went
    // unnoticed for a week. A path nothing takes is still a path something can
    // take.
    //
    // ⚠️ Nor may this proceed with no comments at all. They are 2,868 of 3,656
    // documents and they carry the answers — who a member was pointed at, which
    // partner volunteered. Embedding the questions without the replies would read
    // as a quiet community rather than a broken fetch, and nothing downstream
    // could tell the difference.
    //
    // The nightly builds this cache immediately before calling us, so this is a
    // real failure, not an inconvenience.
    console.error(`No ${COMMENT_CACHE}. Run this first:\n  npx tsx scripts/circle-comments.mts`);
    process.exit(1);
  }
  for (const c of JSON.parse(readFileSync(COMMENT_CACHE, "utf8")) as CachedComment[]) {
    if (c.postId == null) continue;
    const list = commentsByPost.get(c.postId);
    if (list) list.push(c); else commentsByPost.set(c.postId, [c]);
  }

  const spaces = await circle.listSpaces();
  console.log(
    `fetching posts from ${spaces.length} spaces — comments: ` +
      `${commentsByPost.size} posts from cache (no per-post calls)`
  );

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
      //
      // ⛔ From the cache, and ONLY from the cache. There is deliberately no
      // per-post API path left in this file to fall back to.
      const replies = commentsByPost.get(p.id) ?? [];
      for (const cm of replies) {
        const body = postBodyText(cm.body as Parameters<typeof postBodyText>[0]).slice(0, 2000);
        if (body.length > 20) {
          // ⚠️ `userId` on the cached record — NOT `user_id`, the API's spelling.
          // Reading the wrong one compiles and attributes every reply to nobody.
          // The per-post path did exactly that: all 2,868 comments were anonymous
          // in the corpus until this changed, so replies carried no supply signal.
          docs.push({ kind: "comment", id: cm.id, postId: p.id, space: space.name,
                      author: cm.userId == null ? null : byUserId.get(cm.userId) ?? null,
                      text: body });
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
