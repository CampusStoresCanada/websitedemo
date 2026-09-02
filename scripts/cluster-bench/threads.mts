/**
 * Cluster CONVERSATIONS, not sentences.
 *
 * The first pass embedded every post and every comment as its own document, and
 * the clusters came back wrong in a way that was obvious the moment a human read
 * them: replies grouped by TONE — gratitude, board procedure, chit-chat —
 * because "@Karin thank you!" carries no subject of its own. A reply only means
 * something next to the question it answers.
 *
 * ⛔ The fix is NOT to stamp each reply with its parent's title. That breaks the
 * substantive replies: all eleven vendor recommendations under an event
 * announcement would read as "event". The unit is the THREAD — one question and
 * its answers — and everyone who joins a thread carries its topic. That is also
 * the signal we actually want: participation IS interest.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { kmeans, centroid, representatives, normalize } from "@/lib/signals/embedding";
import { resolveDocument } from "@/lib/signals/resolve";

const OLLAMA = "http://localhost:11434";
const MODEL = "nomic-embed-text";
const CACHE = ".cache/circle-threads-v2.json";
const K = Number(process.argv[process.argv.indexOf("--clusters") + 1]) || 40;

type Doc = { id: string; kind: string; text: string; author?: string | null; postId?: string | number | null; space?: string | null; vector: number[] };
type Thread = { id: string; title: string; body: string; space: string | null; replies: { author: string | null; text: string }[]; people: string[]; text: string; vector?: number[] };

const docs = JSON.parse(readFileSync(".cache/circle-corpus.json", "utf8")) as Doc[];

// ── assemble threads ──────────────────────────────────────────────────────
const posts = docs.filter((d) => d.kind === "post");
const threads = new Map<string, Thread>();
for (const p of posts) {
  const key = String(p.postId ?? p.id);
  const [title, ...rest] = p.text.split(/\.\s/);
  threads.set(key, {
    id: key, title: title.trim(), body: rest.join(". ").trim(), space: p.space ?? null,
    replies: [], people: p.author ? [p.author] : [], text: "",
  });
}
for (const c of docs) {
  if (c.kind !== "comment") continue;
  const t = threads.get(String(c.postId));
  if (!t) continue;
  t.replies.push({ author: c.author ?? null, text: c.text });
  if (c.author && !t.people.includes(c.author)) t.people.push(c.author);
}

// The embedded text is the conversation, capped so one 26-reply thread does not
// drown its own question. The question leads: it is what the thread is ABOUT.
const CAP = 4000;
for (const t of threads.values()) {
  let s = t.title + ". " + t.body;
  for (const r of t.replies) {
    if (s.length > CAP) break;
    s += " " + r.text;
  }
  t.text = s.slice(0, CAP);
}
// ⛔ A broadcast is not a conversation.
//
// 26% of the corpus is CSC's own announcements — welcomes, new-partner posts,
// survey reminders, conference planning — plus posts nobody ever answered. They
// cluster beautifully and mean nothing: a pile of "Hello from MRU" carries no
// procurement signal, and asking a human to label it wastes the scarcest thing
// in this pipeline. Structural test, not keywords: who wrote it, and did anyone
// answer.
const CSC = "Campus Stores Canada";
const all = [...threads.values()];
const list = all.filter((t) => t.replies.length > 0 && !(t.people[0] ?? "").includes(CSC));
console.log(`${all.length} threads \u2192 ${list.length} kept ` +
  `(dropped ${all.filter((t) => t.replies.length === 0).length} unanswered, ` +
  `${all.filter((t) => (t.people[0] ?? "").includes(CSC)).length} CSC broadcasts)`);

// ── embed (cached: re-clustering is free, re-embedding is not) ────────────
async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  return (await res.json()).embeddings as number[][];
}

let vectors: number[][];
if (existsSync(CACHE) && !process.argv.includes("--reembed")) {
  vectors = JSON.parse(readFileSync(CACHE, "utf8"));
  console.log(`${vectors.length} vectors from cache`);
} else {
  vectors = [];
  for (let i = 0; i < list.length; i += 32) {
    const batch = list.slice(i, i + 32).map((t) => t.text);
    vectors.push(...(await embed(batch)).map(normalize));
    process.stdout.write(`\r  embedded ${vectors.length}/${list.length}`);
  }
  console.log();
  writeFileSync(CACHE, JSON.stringify(vectors));
}

// ── cluster + export ──────────────────────────────────────────────────────
const clusters = kmeans(vectors, K);
console.log(`${clusters.length} clusters\n`);

const out = clusters.map((c, n) => {
  const mid = centroid(vectors, c.members);
  const reps = representatives(c, vectors, mid, 7);
  const terms = new Map<string, number>();
  const spaces = new Map<string, number>();
  const people = new Set<string>();
  let replies = 0;
  for (const i of c.members) {
    const t = list[i];
    replies += t.replies.length;
    t.people.forEach((p) => people.add(p));
    for (const term of resolveDocument(t.text).terms) terms.set(term, (terms.get(term) ?? 0) + 1);
    if (t.space) spaces.set(t.space, (spaces.get(t.space) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return {
    n: n + 1, size: c.members.length, replies, people: people.size,
    cohesion: Number(c.cohesion.toFixed(3)),
    rules: top(terms).map(([term, n2]) => ({ term, pct: Math.round(n2 / c.members.length * 100) })),
    spaces: top(spaces).map(([name, n2]) => ({ name, n: n2 })),
    reps: reps.map((i) => {
      const t = list[i];
      return {
        title: t.title.slice(0, 150),
        body: (t.body || "").replace(/\s+/g, " ").slice(0, 200),
        replies: t.replies.length,
        people: t.people.length,
        snippets: t.replies.slice(0, 2).map((r) => r.text.replace(/\s+/g, " ").slice(0, 170)),
      };
    }),
  };
});

writeFileSync(".cache/clusters.json", JSON.stringify({
  unit: "thread", docs: list.length, posts: posts.length,
  comments: docs.length - posts.length, clusters: out,
}, null, 1));
console.log(`wrote .cache/clusters.json — ${out.length} clusters, ${list.length} threads`);
console.log(`median cluster ${out.map(c=>c.size).sort((a,b)=>a-b)[Math.floor(out.length/2)]} threads · smallest ${Math.min(...out.map(c=>c.size))} · largest ${Math.max(...out.map(c=>c.size))}`);
