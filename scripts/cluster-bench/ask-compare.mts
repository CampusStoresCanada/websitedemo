import { readFileSync } from "node:fs";
import { matchPartnersToAsk, type PartnerAsk } from "@/lib/comms/partner-asks";

const corpus = JSON.parse(readFileSync(".cache/circle-corpus.json", "utf8")) as
  { kind: string; text: string; postId?: number; space?: string | null }[];
const ask = corpus.find((d) => String(d.postId) === "35635841")!;
console.log(`ASK: ${ask.text.slice(0, 160).replace(/\s+/g, " ")}\n`);

const shaped: PartnerAsk = {
  id: 35635841, title: ask.text.split(". ")[0], url: "", excerpt: ask.text.slice(0, 500),
  askerName: "", askerEmail: null, askerOrg: null,
} as PartnerAsk;

const old = await matchPartnersToAsk(shaped);
console.log("OLD word-matching scorer, top 6:");
for (const c of old.slice(0, 6)) {
  console.log(`  ${String(c.score).padStart(3)}  ${c.orgName}`);
}
if (old.length === 0) console.log("  (none)");
