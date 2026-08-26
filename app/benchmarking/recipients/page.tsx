import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { listDirectoryContacts } from "@/lib/contacts/directory";
import RecipientQueue from "@/components/benchmarking/recipients/RecipientQueue";
import SendPanel from "@/components/benchmarking/recipients/SendPanel";
import RegionAssignment from "@/components/benchmarking/recipients/RegionAssignment";

export const metadata = {
  title: "Recipient Confirmation | Campus Stores Canada",
  description: "Confirm who should receive the benchmarking survey.",
};

/**
 * Rep patches, not comparison groups.
 *
 * The comparison view keeps Quebec separate because a province is a regulatory
 * jurisdiction and that is a real peer group. A rep patch is a workload, and
 * two stores is not one — so Quebec rides with Atlantic here and only here.
 * See lib/benchmarking/comparison.ts for the other map.
 */
const REGION_OF: Record<string, string> = {
  "Newfoundland and Labrador": "Atlantic & Quebec",
  "Nova Scotia": "Atlantic & Quebec",
  "New Brunswick": "Atlantic & Quebec",
  "Prince Edward Island": "Atlantic & Quebec",
  Quebec: "Atlantic & Quebec",
  Ontario: "Ontario",
  Manitoba: "Prairies",
  Saskatchewan: "Prairies",
  Alberta: "Prairies",
  "British Columbia": "West",
  Yukon: "West",
  "Northwest Territories": "West",
  Nunavut: "West",
};

export default async function RecipientsPage() {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const { supabase, userId, globalRole, capabilities } = auth.ctx;
  const admin = isGlobalAdmin(globalRole);
  const isRep = capabilities.includes("benchmarking.recipient_confirm");
  if (!isRep && !admin) redirect("/benchmarking");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: surveys } = (await (supabase as any)
    .from("benchmarking_surveys")
    .select("id, title, fiscal_year, status")
    .order("fiscal_year", { ascending: false })
    .limit(1)) as { data: any[] | null };
  const survey = surveys?.[0] ?? null;

  if (!survey) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-sm text-gray-500">No survey set up yet.</p>
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("benchmarking_recipients")
    .select("*")
    .eq("survey_id", survey.id);
  // Reps see their own region; the office sees everything.
  if (!admin) query = query.eq("assigned_to", userId);
  const { data: rows } = (await query) as { data: any[] | null };

  const recipients = rows ?? [];
  const orgIds = recipients.map((r) => r.organization_id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgs } = (await (supabase as any)
    .from("organizations")
    .select("id, name, province, slug")
    .in(
      "id",
      orgIds.length ? orgIds : ["00000000-0000-0000-0000-000000000000"],
    )) as {
    data: any[] | null;
  };
  const orgById = new Map((orgs ?? []).map((o) => [o.id, o]));

  // Access was already decided above (rep or admin). Contacts read on the
  // session client would return only your own org's rows, silently, and the
  // page would tell a rep "nobody on file" for all 52 stores.
  const contacts = await listDirectoryContacts<{
    id: string;
    organization_id: string | null;
    name: string | null;
    role_title: string | null;
    work_email: string | null;
    email: string | null;
    is_primary: boolean | null;
  }>({
    organizationIds: orgIds,
    fields:
      "id, organization_id, name, role_title, work_email, email, is_primary",
  });

  const contactsByOrg = new Map<string, typeof contacts>();
  for (const c of contacts) {
    if (!c.organization_id) continue;
    const list = contactsByOrg.get(c.organization_id) ?? [];
    list.push(c);
    contactsByOrg.set(c.organization_id, list);
  }

  // Who took part last year — the signal that decides queue order.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prior } = (await (supabase as any)
    .from("benchmarking")
    .select("organization_id")
    .eq("fiscal_year", survey.fiscal_year - 1)) as { data: any[] | null };
  const participated = new Set((prior ?? []).map((b) => b.organization_id));

  const items = recipients.map((r) => {
    const org = orgById.get(r.organization_id);
    const list = (contactsByOrg.get(r.organization_id) ?? []).sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary),
    );
    return {
      id: r.id as string,
      // The recipient row id and the organization id are different things and
      // both are needed: the queue acts on the row, region assignment matches
      // on the org.
      orgId: r.organization_id as string,
      status: r.status as string,
      note: (r.note as string) ?? null,
      contactId: (r.contact_id as string) ?? null,
      orgName: org?.name ?? "Unknown store",
      province: org?.province ?? "",
      region: REGION_OF[org?.province ?? ""] ?? "Unknown",
      participatedLastYear: participated.has(r.organization_id),
      contacts: list.map((c) => ({
        id: c.id as string,
        name: (c.name as string) ?? "Unnamed",
        roleTitle: (c.role_title as string) ?? null,
        email: (c.work_email as string) ?? (c.email as string) ?? null,
        isPrimary: c.is_primary === true,
      })),
    };
  });

  // The stores we know least about, first.
  items.sort((a, b) => {
    const rank = (x: typeof a) =>
      x.status !== "unconfirmed" && x.status !== "escalated"
        ? 3
        : x.contacts.length === 0
          ? 0
          : x.participatedLastYear
            ? 2
            : 1;
    const d = rank(a) - rank(b);
    return d !== 0 ? d : a.orgName.localeCompare(b.orgName);
  });

  // Who can hold a region, and what each region currently looks like. Only
  // people who actually carry the capability are offerable — otherwise the
  // dropdown invites you to assign someone whose queue will refuse them.
  const adminDb = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: repRows }, { data: assignedRows }] = (await Promise.all([
    (adminDb as any)
      .from("capability_contributions")
      .select("subject_id, display_name")
      .eq("capability", "benchmarking.recipient_confirm")
      .eq("is_active", true),
    (adminDb as any)
      .from("benchmarking_recipients")
      .select("organization_id, assigned_to")
      .eq("survey_id", survey.id)
      .not("assigned_to", "is", null),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ])) as { data: any[] | null }[];

  const reps = [
    ...new Map(
      (repRows ?? []).map((r: any) => [
        r.subject_id as string,
        { id: r.subject_id as string, name: (r.display_name as string) ?? "Unknown" },
      ]),
    ).values(),
  ];

  const assignedByOrg = new Map(
    (assignedRows ?? []).map((r: any) => [r.organization_id as string, r.assigned_to as string]),
  );
  const repNameById = new Map(reps.map((r) => [r.id, r.name]));

  const regionRows = ["Atlantic", "Quebec", "Ontario", "Prairies", "West"].map((region) => {
    const inRegion = items.filter((i) => i.region === region);
    const repId = inRegion.map((i) => assignedByOrg.get(i.orgId)).find(Boolean) ?? null;
    return {
      region,
      storeCount: inRegion.length,
      repId,
      repName: repId ? repNameById.get(repId) ?? null : null,
    };
  });

  return (
    <>
      <RecipientQueue
        surveyTitle={survey.title}
        fiscalYear={survey.fiscal_year}
        isAdmin={admin}
        items={items}
      />
      {/*
        Admin only, and below the queue on purpose. Confirming who the right
        person is comes first; sending is what you do once that work is done.
      */}
      {admin && (
        <div className="mx-auto mt-8 max-w-5xl space-y-8 px-4 pb-12">
          {/* Regions before sending: an unassigned region means a rep who sees
              an empty queue and concludes there is nothing to do. */}
          <RegionAssignment
            surveyId={survey.id}
            regions={regionRows}
            people={reps}
          />
          <SendPanel surveyId={survey.id} surveyStatus={survey.status} />
        </div>
      )}
    </>
  );
}
