// Wait for the election clock's 16:15Z firing to certify board-2027, then print
// what it did. Exits as soon as the state changes, or after 25 minutes.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const t = readFileSync("/Users/Work/Documents/csc-website/websitedemo/.env.local","utf8");
const env = Object.fromEntries(t.split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#"))
  .map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });

const deadline = Date.now() + 25*60*1000;
while (Date.now() < deadline) {
  const { data: e } = await db.from("elections").select("id,status,outcome").eq("slug","board-2027").maybeSingle();
  if (e && e.status !== "nominations_closed") {
    const { data: terms } = await db.from("governance_role_assignments")
      .select("term_start,term_end,counts_toward_cap,contacts(first_name,last_name)")
      .eq("elected_at_election_id", e.id);
    const { data: audit } = await db.from("audit_log")
      .select("action,actor_type,actor_id,created_at")
      .like("action","election_clockwork_%").order("created_at",{ascending:false}).limit(3);
    console.log(`CLOCK FIRED — board-2027 is now "${e.status}"`);
    console.log(`terms written: ${terms?.length ?? 0}`);
    for (const r of terms ?? []) {
      const c = r.contacts;
      console.log(`  ${c?.first_name} ${c?.last_name}  ${r.term_start} -> ${r.term_end} cap=${r.counts_toward_cap}`);
    }
    for (const a of audit ?? []) console.log(`  audit: ${a.action} actor=${a.actor_type} id=${a.actor_id ?? "NULL"} @ ${a.created_at}`);
    process.exit(0);
  }
  await new Promise(r=>setTimeout(r, 30000));
}
console.log("TIMED OUT — board-2027 still nominations_closed after 25 minutes; the cron did not fire or it failed.");
