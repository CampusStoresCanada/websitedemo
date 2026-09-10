import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await db.from("app_settings").select("value").eq("key","qbo_refresh_token").single();
const cred = Buffer.from(`${process.env.QUICKBOOKS_CLIENT_ID}:${process.env.QUICKBOOKS_CLIENT_SECRET}`).toString("base64");
const r = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",{method:"POST",
  headers:{Authorization:`Basic ${cred}`,"Content-Type":"application/x-www-form-urlencoded",Accept:"application/json"},
  body:new URLSearchParams({grant_type:"refresh_token",refresh_token:data.value}).toString()});
const t = await r.json();
if (t.refresh_token && t.refresh_token !== data.value)
  await db.from("app_settings").upsert({key:"qbo_refresh_token",value:t.refresh_token},{onConflict:"key"});
const Q = async (q) => {
  const res = await fetch(`https://quickbooks.api.intuit.com/v3/company/${process.env.QUICKBOOKS_REALM_ID}/query?query=${encodeURIComponent(q)}&minorversion=65`,
    {headers:{Authorization:`Bearer ${t.access_token}`,Accept:"application/json"}});
  if(!res.ok) throw new Error(await res.text());
  return (await res.json()).QueryResponse ?? {};
};

const all = [];
for (let s=1;;s+=1000){ const p=(await Q(`SELECT * FROM Customer ORDERBY Id STARTPOSITION ${s} MAXRESULTS 1000`)).Customer??[]; all.push(...p); if(p.length<1000) break; }

const norm = (x)=>(x??"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase()
  .replace(/&/g," and ").replace(/['’`]/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
const SUF=new Set(["inc","ltd","limited","llc","corp","corporation","co","company","incorporated","canada","usa","america","bookstore","bookstores","store","stores","university","college"]);
const key = (x)=>norm(x).split(" ").filter(w=>w&&!SUF.has(w)).sort().join(" ");

console.log(`${all.length} QBO customers total\n`);

// 1) everything created in 2026, newest first
const created2026 = all.filter(c=>(c.MetaData?.CreateTime??"") >= "2026-01-01").sort((a,b)=>(a.MetaData.CreateTime<b.MetaData.CreateTime?1:-1));
console.log("=".repeat(104));
console.log(`CUSTOMERS CREATED IN 2026 — ${created2026.length}`);
console.log("=".repeat(104));
console.log("Created            Id    DisplayName                              CompanyName");
for (const c of created2026) console.log(
  `${c.MetaData.CreateTime.slice(0,16).replace("T"," ")}   ${String(c.Id).padEnd(5)} ${String(c.DisplayName??"—").slice(0,38).padEnd(39)} ${c.CompanyName??"(none)"}`);

// 2) duplicate clusters by name-core, flagging any cluster touched in 2026
const groups = new Map();
for (const c of all) {
  const k = key(c.DisplayName) || key(c.CompanyName);
  if (!k) continue;
  for (const kk of new Set([k, key(c.CompanyName)].filter(Boolean))) {
    if (!groups.has(kk)) groups.set(kk, []);
    if (!groups.get(kk).some(x=>x.Id===c.Id)) groups.get(kk).push(c);
  }
}
const dups = [...groups.entries()].filter(([,v])=>v.length>1);
console.log("\n" + "=".repeat(104));
console.log(`DUPLICATE NAME CLUSTERS — ${dups.length}`);
console.log("=".repeat(104));
for (const [k,v] of dups.sort((a,b)=>a[0].localeCompare(b[0]))) {
  const recent = v.some(c=>(c.MetaData?.CreateTime??"")>="2026-01-01");
  console.log(`\n"${k}"${recent?"   *** contains a 2026-created record ***":""}`);
  for (const c of v.sort((a,b)=>Number(a.Id)-Number(b.Id)))
    console.log(`   ${String(c.Id).padEnd(5)} created ${(c.MetaData?.CreateTime??"?").slice(0,10)}  active=${String(c.Active).padEnd(5)} bal=$${Number(c.Balance??0).toFixed(2).padStart(9)}  ${String(c.DisplayName??"—").slice(0,34).padEnd(35)} ${c.CompanyName??"(none)"}`);
}

// 3) are any 2026-created records ones our DB does NOT point at?
const { data: orgs } = await db.from("organizations").select("name, quickbooks_customer_id").not("quickbooks_customer_id","is",null);
const linked = new Set((orgs??[]).map(o=>String(o.quickbooks_customer_id)));
console.log("\n" + "=".repeat(104));
console.log("2026-CREATED RECORDS NOT LINKED TO ANY ORG IN OUR DB");
console.log("=".repeat(104));
for (const c of created2026) if (!linked.has(String(c.Id)))
  console.log(`   ${String(c.Id).padEnd(5)} ${(c.MetaData.CreateTime).slice(0,10)}  ${String(c.DisplayName??"—").slice(0,38).padEnd(39)} ${c.CompanyName??"(none)"}`);
