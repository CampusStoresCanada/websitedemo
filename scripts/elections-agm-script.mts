#!/usr/bin/env npx tsx
/** Render the AGM script from live data. Read-only; prints, does not upload. */
import { readFileSync, writeFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
process.env.ELECTIONS_SUPPRESS_EMAIL = "1";

const { getAgmScript } = await import("../lib/elections/service");
const s = (await getAgmScript(process.argv[2] ?? "board-2027", { pollster: "Stephen" }))!;
writeFileSync("/tmp/agm-script.md", s.markdown);
console.log(`${s.title} — ${s.blocks.length} blocks, ${s.outstanding.length} sections outstanding`);
console.log(`outstanding: ${s.outstanding.join(" | ")}\n`);
console.log(s.markdown.slice(0, 1800));
console.log("\n… full script written to /tmp/agm-script.md");
