import { readFileSync, writeFileSync } from "node:fs";
const data = readFileSync(".cache/clusters.json", "utf8").replace(/</g, "\\u003c");
const tpl = readFileSync("scripts/cluster-bench/label-template.html", "utf8");
const out = tpl.replace("__CLUSTER_DATA__", () => data);
writeFileSync(process.argv[2], out);
console.log("built", process.argv[2], "—", (out.length / 1024).toFixed(0), "KB");
