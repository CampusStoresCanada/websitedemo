import { readFileSync, writeFileSync } from "node:fs";
import { kmeans, centroid, representatives } from "@/lib/signals/embedding";
import { resolveDocument } from "@/lib/signals/resolve";

type Doc = { id: string; kind: string; text: string; author?: string|null; space?: string|null; postId?: string|number|null; vector: number[] };
const docs = JSON.parse(readFileSync(".cache/circle-corpus.json","utf8")) as Doc[];
const vectors = docs.map(d => d.vector);
const clusters = kmeans(vectors, 24);

const out = clusters.map((c, n) => {
  const mid = centroid(vectors, c.members);
  const reps = representatives(c, vectors, mid, 8);
  const terms = new Map<string, number>();
  const spaces = new Map<string, number>();
  for (const i of c.members) {
    for (const t of resolveDocument(docs[i].text).terms) terms.set(t, (terms.get(t) ?? 0) + 1);
    const s = docs[i].space; if (s) spaces.set(s, (spaces.get(s) ?? 0) + 1);
  }
  const top = <T,>(m: Map<string, number>) => [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4);
  return {
    n: n + 1,
    size: c.members.length,
    replies: c.members.filter(i => docs[i].kind === "comment").length,
    cohesion: Number(c.cohesion.toFixed(3)),
    rules: top(terms).map(([term, docs2]) => ({ term, pct: Math.round(docs2 / c.members.length * 100) })),
    spaces: top(spaces).map(([name, n2]) => ({ name, n: n2 })),
    reps: reps.map(i => ({ kind: docs[i].kind, author: docs[i].author ?? null, text: docs[i].text.replace(/\s+/g," ").slice(0, 420) })),
  };
});
writeFileSync(".cache/clusters.json", JSON.stringify({ docs: docs.length, posts: docs.filter(d=>d.kind==="post").length, clusters: out }, null, 1));
console.log(`wrote .cache/clusters.json — ${out.length} clusters`);
console.log(out.filter(c=>c.rules.length===0||c.rules[0].pct<5).map(c=>`  cluster ${c.n} (${c.size}) — no rule term above 5%`).join("\n"));
