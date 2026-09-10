import { readFileSync } from "node:fs";
import { resolveDocument } from "@/lib/signals/resolve";
const docs = JSON.parse(readFileSync(".cache/circle-corpus.json","utf8")) as {kind:string;text:string}[];
let tagged=0; const termCount=new Map<string,number>();
for (const d of docs) {
  const t = resolveDocument(d.text).terms;
  if (t.length) tagged++;
  for (const x of t) termCount.set(x,(termCount.get(x)??0)+1);
}
console.log(`corpus              ${docs.length}`);
console.log(`rules tag a term    ${tagged} (${(tagged/docs.length*100).toFixed(0)}%)`);
console.log(`rules say nothing   ${docs.length-tagged} (${((docs.length-tagged)/docs.length*100).toFixed(0)}%)`);
console.log(`distinct terms used ${termCount.size}`);
console.log([...termCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([t,n])=>`   ${t}: ${n}`).join("\n"));
