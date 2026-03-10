import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAuthenticated } from "@/lib/auth/guards";
import { getPublicConference } from "@/lib/actions/conference";
import { getMyRegistration } from "@/lib/actions/conference-registration";
import { getActiveLegalDocuments, getMyLegalAcceptances } from "@/lib/actions/conference-legal";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRetentionConsentConfig } from "@/lib/policy/engine";
import PartnerRegistrationForm from "./PartnerRegistrationForm";
import DelegateRegistrationForm from "./DelegateRegistrationForm";
import RegistrationOptionForm from "./RegistrationOptionForm";

export const metadata = { title: "Conference Registration" };

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string; edition: string }>;
  searchParams: Promise<{ role?: string; org?: string }>;
}) {
  const { year, edition } = await params;
  const query = await searchParams;
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  // Load conference
  const confResult = await getPublicConference(parseInt(year), edition);
  if (!confResult.success || !confResult.data) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Conference Not Found</h1>
        <p className="text-gray-500">This conference is not available for registration.</p>
      </div>
    );
  }

  const conference = confResult.data;

  if (conference.status !== "registration_open") {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">{conference.name}</h1>
        <p className="text-gray-500">Registration is not currently open for this conference.</p>
      </div>
    );
  }

  // Get user's org membership to determine registration type
  // Use user's own supabase client for queries scoped to the authenticated user
  const userClient = auth.ctx.supabase;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: userOrgs } = (await (userClient as any)
    .from("user_organizations")
    .select("organization_id, role, organizations(id, name, type)")
    .eq("user_id", auth.ctx.userId)
    .eq("status", "active")) as { data: any[] | null };

  if (!userOrgs || userOrgs.length === 0) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">{conference.name}</h1>
        <p className="text-gray-500">
          You must be a member of an organization to register for the conference.
        </p>
      </div>
    );
  }

  const memberships = userOrgs.map((uo: any) =>
    (uo as { organizations: { id: string; name: string; type: string } }).organizations
  );
  const delegateOrgs = memberships.filter((org) => org.type !== "vendor_partner");
  const exhibitorOrgsForRole = memberships.filter((org) => org.type === "vendor_partner");
  const hasDelegate = delegateOrgs.length > 0;
  const hasExhibitor = exhibitorOrgsForRole.length > 0;

  const roleParam = query.role;
  const requestedRole =
    roleParam === "delegate" || roleParam === "exhibitor" ? roleParam : null;

  let registrationType: "delegate" | "exhibitor" | null = null;
  if (requestedRole === "delegate" && hasDelegate) registrationType = "delegate";
  if (requestedRole === "exhibitor" && hasExhibitor) registrationType = "exhibitor";
  if (!registrationType && hasDelegate && !hasExhibitor) registrationType = "delegate";
  if (!registrationType && hasExhibitor && !hasDelegate) registrationType = "exhibitor";

  if (!registrationType) {
    return (
      <div className="max-w-3xl mx-auto py-8 px-4">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{conference.name}</h1>
        <p className="text-sm text-gray-500 mb-6">Choose which registration to complete.</p>
        <div className="space-y-4">
          {hasDelegate && (
            <div className="rounded-lg border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-800 mb-2">Delegate Registration</h2>
              <p className="text-sm text-gray-500 mb-3">Register as a member delegate.</p>
              <Link
                href={`/conference/${year}/${edition}/register?role=delegate&org=${delegateOrgs[0].id}`}
                className="inline-flex px-3 py-1.5 text-sm font-medium text-white bg-[#D60001] rounded-md hover:bg-[#b50001]"
              >
                Start Delegate
              </Link>
            </div>
          )}
          {hasExhibitor && (
            <div className="rounded-lg border border-gray-200 p-4">
              <h2 className="text-sm font-semibold text-gray-800 mb-2">Partner / Exhibitor Registration</h2>
              <p className="text-sm text-gray-500 mb-3">Register as a vendor partner exhibitor.</p>
              <Link
                href={`/conference/${year}/${edition}/register?role=exhibitor&org=${exhibitorOrgsForRole[0].id}`}
                className="inline-flex px-3 py-1.5 text-sm font-medium text-white bg-[#D60001] rounded-md hover:bg-[#b50001]"
              >
                Start Exhibitor
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  const allowedOrgs = registrationType === "delegate" ? delegateOrgs : exhibitorOrgsForRole;
  const selectedOrgId = query.org && allowedOrgs.some((org) => org.id === query.org)
    ? query.org
    : allowedOrgs[0].id;
  const org = allowedOrgs.find((item) => item.id === selectedOrgId) ?? allowedOrgs[0];

  // Load existing draft registration if any
  const regResult = await getMyRegistration(conference.id, registrationType as "delegate" | "exhibitor");
  const existingRegistration = regResult.success ? regResult.data : null;

  // Load legal documents + acceptances
  const legalResult = await getActiveLegalDocuments(conference.id);
  const legalDocs = legalResult.success ? legalResult.data ?? [] : [];

  const acceptancesResult = await getMyLegalAcceptances(conference.id);
  const acceptances = acceptancesResult.success ? acceptancesResult.data ?? [] : [];

  // Load exhibitor orgs for delegate preferences
  // Admin client needed for cross-user queries (all exhibitor registrations, org people)
  const adminClient = createAdminClient();
  let exhibitorOrgs: { id: string; name: string }[] = [];
  if (registrationType === "delegate") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: regs } = (await (adminClient as any)
      .from("conference_registrations")
      .select("organization_id, organizations(id, name)")
      .eq("conference_id", conference.id)
      .eq("registration_type", "exhibitor")
      .in("status", ["submitted", "confirmed"])) as { data: any[] | null };

    if (regs) {
      exhibitorOrgs = regs.map((r) => {
        const regOrg = r as unknown as { organizations: { id: string; name: string } };
        return { id: regOrg.organizations.id, name: regOrg.organizations.name };
      });
    }
  }

  // Pull known people contacts for the selected org.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: peopleRows } = (await (adminClient as any)
    .from("people")
    .select("id, first_name, last_name, primary_email, title, work_phone, mobile_phone")
    .eq("organization_id", org.id)
    .order("first_name", { ascending: true })
    .order("last_name", { ascending: true })) as { data: any[] | null };

  const knownPeople = (peopleRows ?? []).map((person) => ({
    id: person.id,
    name: `${person.first_name} ${person.last_name}`.trim(),
    email: person.primary_email,
    title: person.title,
    work_phone: person.work_phone,
    mobile_phone: person.mobile_phone,
  }));

  // Default delegate identification from "known people" profile when linked.
  let mePerson: {
    name: string;
    email: string;
    title: string | null;
    work_phone: string | null;
    mobile_phone: string | null;
  } | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: userRow } = (await (adminClient as any)
    .from("users")
    .select("person_id")
    .eq("id", auth.ctx.userId)
    .maybeSingle()) as { data: any };
  if (userRow?.person_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: person } = (await (adminClient as any)
      .from("people")
      .select("first_name, last_name, primary_email, title, work_phone, mobile_phone")
      .eq("id", userRow.person_id)
      .maybeSingle()) as { data: any };
    if (person) {
      mePerson = {
        name: `${person.first_name} ${person.last_name}`.trim(),
        email: person.primary_email,
        title: person.title,
        work_phone: person.work_phone,
        mobile_phone: person.mobile_phone,
      };
    }
  }

  const commonProps = {
    conference,
    orgId: org.id,
    orgName: org.name,
    existingRegistration,
    legalDocs,
    acceptances,
  };
  const retentionConsentConfig = await getRetentionConsentConfig().catch(() => ({
    travel_data_required: true,
    dietary_accessibility_required: false,
    travel_delete_rule: "march_1_conference_year_utc",
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: registrationOpsModule } = (await (adminClient as any)
    .from("conference_schedule_modules")
    .select("config_json")
    .eq("conference_id", conference.id)
    .eq("module_key", "registration_ops")
    .maybeSingle()) as { data: any };
  const registrationOptionsRaw =
    (registrationOpsModule?.config_json as Record<string, unknown> | null)?.registration_options ??
    null;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">{conference.name}</h1>
      <p className="text-sm text-gray-500 mb-8">
        {registrationType === "exhibitor" ? "Partner/Exhibitor" : "Delegate"} Registration
      </p>

      {hasDelegate && hasExhibitor && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
          <span className="text-gray-600 mr-3">Switch role:</span>
          <Link
            href={`/conference/${year}/${edition}/register?role=delegate&org=${delegateOrgs[0].id}`}
            className={`mr-3 ${registrationType === "delegate" ? "font-semibold text-[#D60001]" : "text-gray-600 hover:text-gray-800"}`}
          >
            Delegate
          </Link>
          <Link
            href={`/conference/${year}/${edition}/register?role=exhibitor&org=${exhibitorOrgsForRole[0].id}`}
            className={registrationType === "exhibitor" ? "font-semibold text-[#D60001]" : "text-gray-600 hover:text-gray-800"}
          >
            Exhibitor
          </Link>
        </div>
      )}

      {registrationOptionsRaw ? (
        <RegistrationOptionForm
          {...commonProps}
          registrationType={registrationType}
          optionsRaw={registrationOptionsRaw}
          mePerson={
            mePerson ?? {
              name: "",
              email: auth.ctx.userEmail ?? "",
              title: null,
              work_phone: null,
              mobile_phone: null,
            }
          }
        />
      ) : registrationType === "exhibitor" ? (
        <PartnerRegistrationForm
          {...commonProps}
          knownPeople={knownPeople}
          badgeOrgOptions={memberships.map((m) => ({ id: m.id, name: m.name }))}
        />
      ) : (
        <DelegateRegistrationForm
          {...commonProps}
          exhibitorOrgs={exhibitorOrgs}
          travelConsentRequired={retentionConsentConfig.travel_data_required}
          mePerson={mePerson ?? {
            name: "",
            email: auth.ctx.userEmail ?? "",
            title: null,
            work_phone: null,
            mobile_phone: null,
          }}
        />
      )}
    </div>
  );
}
