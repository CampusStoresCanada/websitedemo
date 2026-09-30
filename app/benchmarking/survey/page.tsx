import { redirect } from "next/navigation";
import BenchmarkingSurveyForm from "@/components/benchmarking/BenchmarkingSurveyForm";
import SurveyIntro from "@/components/benchmarking/SurveyIntro";
import { formatDeadline } from "@/lib/benchmarking/deadline";
import { getFieldConfig } from "@/lib/benchmarking/default-field-config";
import { isGlobalAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { resolveSurveyAccess } from "@/lib/benchmarking/survey-access";
import { createAdminClient } from "@/lib/supabase/admin";
import DisclosureChoice from "@/components/benchmarking/DisclosureChoice";
import RespondentNotes from "@/components/benchmarking/RespondentNotes";
import AdminOrgSwitcher from "@/components/conference/AdminOrgSwitcher";
import { resolveActingOrg } from "@/lib/benchmarking/acting-org";
import { hasCapability } from "@/lib/auth/capabilities";
import { CAPABILITIES } from "@/lib/auth/capability-names";

export const metadata = {
  title: "Benchmarking Survey | Campus Stores Canada",
  description: "Complete your annual benchmarking survey.",
};

export default async function BenchmarkingSurveyPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; org?: string; preview?: string }>;
}) {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    redirect("/login");
  }
  const { supabase, userId, globalRole } = auth.ctx;

  // Read once, up here: `?org=` decides WHICH store this page is about, so it
  // has to be known before the org is resolved rather than at render time.
  const params = await searchParams;
  const skipIntro = params?.start === "1";
  const requestedOrgId = params?.org ?? null;
  // Arrived via "Walk the survey" — pinned to the test store, see resolveActingOrg.
  const isPreview = params?.preview === "1";

  // 2. Get user profile and org
  const isAdmin = isGlobalAdmin(globalRole);

  // 3. Find user's member org where they're org_admin
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: userOrgs } = (await (supabase as any)
    .from("user_organizations")
    .select(
      `
      organization_id,
      role,
      organization:organizations(id, name, slug, type, province)
    `,
    )
    .eq("user_id", userId)
    .eq("status", "active")) as { data: any[] | null };

  // Ordering, the ?org= pin and the admin roster all live in resolveActingOrg()
  // now — the worksheet and /benchmarking/compare answer the same question and
  // had each grown their own copy of this, with the same bug in all three.
  type SurveyOrg = {
    id: string;
    name: string;
    slug: string;
    type: string;
    province: string;
  };


  // Service role from here on. Access is settled above, and both the roster
  // read and the draft row need to see past RLS.
  const db = createAdminClient();

  // 4. Check active survey
  //
  // .single() threw on zero open surveys — the ordinary state between cycles —
  // and again if two were ever open at once, which would take the page down
  // rather than degrade. Take the newest open one and let the landing page
  // explain when there is none.
  // Take the newest survey whatever its state, then ask whether THIS store may
  // file right now. Beta means live for a named few; admins can always look
  // without that counting as opening the doors.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: surveys } = (await (supabase as any)
    .from("benchmarking_surveys")
    .select("*")
    .in("status", ["beta", "open"])
    .order("fiscal_year", { ascending: false })
    .limit(1)) as { data: any[] | null };

  let activeSurvey = surveys?.[0] ?? null;

  // Nothing live — an admin can still preview the newest survey of any status.
  if (!activeSurvey && isAdmin) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: latest } = (await (supabase as any)
      .from("benchmarking_surveys")
      .select("*")
      .order("fiscal_year", { ascending: false })
      .limit(1)) as { data: any[] | null };
    activeSurvey = latest?.[0] ?? null;
  }

  if (!activeSurvey) {
    redirect("/benchmarking");
  }

  /*
    Why a global admin could not open this page at all.

    The filter above reads `org.type === "Member" && (role === "org_admin" ||
    isAdmin)`. `isAdmin` relaxes WHICH ROLE is needed at a member store; it does
    nothing about the requirement to be attached to one. Every CSC staffer is
    linked to the Staff org, so the list came back empty and the guard below
    bounced them to the landing page — the admin_preview branch in
    resolveSurveyAccess() was unreachable for exactly the people it was for.

    The fix is not to guess a store for them. Landing an admin on whichever row
    the database returned first is the same bug the sort() above exists to
    prevent, one level up. So: `?org=` names the store, and the roster is
    offered when it is absent — the pattern /org/billing and the conference cart
    already use.
  */
  const acting = await resolveActingOrg({
    userOrgs: userOrgs ?? [],
    isAdmin,
    viewerProfileId: userId,
    requestedOrgId,
    surveyId: activeSurvey.id,
    pinToTestStore: isPreview,
  });

  const adminOrgOptions = acting.adminOrgOptions;
  const organization = acting.organization as SurveyOrg | null;

  // An admin acting as a store they do not belong to is LOOKING, not filing.
  // It governs whether this page may create a row — see the draft step below.
  const isActingAsOther = acting.isActingAsOther;

  if (!organization) {
    // An admin with no store of their own gets the roster rather than a bounce.
    if (isAdmin && adminOrgOptions.length > 0) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-10">
          <h1 className="text-2xl font-bold text-gray-900">Benchmarking survey</h1>
          <p className="mt-2 text-sm text-gray-600">
            You are not attached to a member store, so pick the one whose survey you
            want to open. Choosing a store shows you exactly what its staff see.
          </p>
          <div className="mt-5">
            <AdminOrgSwitcher
              orgs={adminOrgOptions}
              selectedOrgId={null}
              basePath="/benchmarking/survey"
              label="open the survey as"
            />
          </div>
        </div>
      );
    }
    redirect("/benchmarking");
  }


  /*
    Appointed beta testers file for real before the doors open. The appointment
    is on the PERSON, so it is read here rather than inferred from the store.
  */
  const isBetaTester = await hasCapability(
    userId,
    CAPABILITIES.BENCHMARKING_BETA_TESTER,
  );

  const access = await resolveSurveyAccess({
    surveyId: activeSurvey.id,
    surveyStatus: activeSurvey.status,
    organizationId: organization.id,
    isAdmin,
    isBetaTester,
  });

  if (!access.canFile) {
    redirect("/benchmarking");
  }

  // 5. Fetch or create the draft row for this org + fiscal year.
  //
  // Service role, not the session client. `authenticated` holds SELECT on
  // benchmarking and nothing else — the INSERT and UPDATE policies exist but
  // carry no matching GRANT, so an insert through the session client returns
  // 42501 and this page silently redirects the store back to the landing page.
  // That is every store's first action on opening day, so the whole survey was
  // unreachable for all 52.
  //
  // Safe because access is already decided above: resolveSurveyAccess() has
  // said this org may file, and the row created is scoped to that org.
  // (`db` is created during org resolution, which also needs the service role.)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { data: currentRow } = (await (db as any)
    .from("benchmarking")
    .select("*")
    .eq("organization_id", organization.id)
    .eq("fiscal_year", activeSurvey.fiscal_year)
    // No row yet is the normal state for anyone opening this for the first
    // time. .single() treats that as an error, which then gets swallowed by
    // the destructure — so real failures hide among the noise.
    .maybeSingle()) as { data: any };

  /*
    Staff acting as a store get the REAL page — intro, form, every control.

    This was a read-only preview that returned before `?start=1` was read, so
    "Start the survey" looped back to the title page and the questions were
    unreachable. A super admin who cannot open the thing is not a safer super
    admin, just a blind one.

    ⚠️ It therefore creates the store's draft row, same as any respondent, which
    stamps respondent_user_id and puts them in the drafts count on
    /benchmarking/admin. That is a visible artifact of looking; the banner below
    says whose record you are in.
  */
  if (!currentRow) {
    // Create a new draft row
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newRow, error: insertError } = (await (db as any)
      .from("benchmarking")
      .insert({
        organization_id: organization.id,
        fiscal_year: activeSurvey.fiscal_year,
        status: "draft",
        respondent_user_id: userId,
      })
      .select("*")
      .single()) as { data: any; error: any };

    if (insertError) {
      // Loud, not silent. A bounce to the landing page with no explanation is
      // indistinguishable from "the survey is not open", which is what hid
      // the missing GRANT in the first place.
      console.error("[benchmarking/survey] could not create draft row:", insertError);
      throw new Error(
        "Could not start your survey. This has been logged — please contact CSC.",
      );
    }

    currentRow = newRow;
  }

  // The config that renders the form, and that the intro measures its counts from.
  const fieldConfig = getFieldConfig(activeSurvey);

  // The store's known people, for the "who is filling this in" picker.
  const { loadStoreContacts } = await import("@/lib/actions/benchmarking-respondent");
  const { contacts: storeContacts } = await loadStoreContacts(organization.id);

  const { loadLocations } = await import("@/lib/actions/benchmarking-locations");
  const locations = await loadLocations(currentRow!.id);

  // Section 1 answers that live on the organisation, not the submission.
  const { loadCategories } = await import("@/lib/actions/benchmarking-categories");
  const [gmCategories, cmCategories] = await Promise.all([
    loadCategories(currentRow!.id, "general_merchandise"),
    loadCategories(currentRow!.id, "course_materials"),
  ]);

  const { loadKeyDates, loadProfileKeyDateSuggestions } = await import(
    "@/lib/actions/benchmarking-profile"
  );
  const [keyDates, profileKeyDates] = await Promise.all([
    loadKeyDates(organization.id),
    loadProfileKeyDateSuggestions(organization.id),
  ]);

  // §4, §6 and §7 — the rows a store adds itself, rather than a fixed field.
  const { loadOtherIncome, loadOtherExpenses, loadStaff } = await import(
    "@/lib/actions/benchmarking-financials"
  );
  const { loadCompetitors } = await import("@/lib/actions/benchmarking-competitors");
  const [otherIncome, otherExpenses, staff, competitors] = await Promise.all([
    loadOtherIncome(currentRow!.id),
    loadOtherExpenses(currentRow!.id),
    loadStaff(currentRow!.id),
    loadCompetitors(currentRow!.id),
  ]);

  const { data: orgLogos } = await db
    .from("organizations")
    .select("logo_url, logo_horizontal_url, logo_confirmed_at")
    .eq("id", organization.id)
    .maybeSingle();

  // 6. Fetch prior year data (for reference values and delta flags)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: priorYearRow } = (await (supabase as any)
    .from("benchmarking")
    .select("*")
    .eq("organization_id", organization.id)
    .eq("fiscal_year", activeSurvey.fiscal_year - 1)
    // Fifteen of the 52 active member stores did not take part last year, so
    // "no prior row" is expected, not exceptional.
    .maybeSingle()) as { data: any };

  // 7. Fetch existing delta flags for this row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: deltaFlags } = (await (supabase as any)
    .from("delta_flags")
    .select("*")
    .eq("benchmarking_id", currentRow!.id)) as { data: any[] | null };

  // 7b. Notes a reviewer has written about this store and the lead approved,
  // now waiting on the store itself. Read with the service role for the same
  // reason the draft row is: `authenticated` holds SELECT on benchmarking_notes
  // and the page has already established this is their org.
  const { data: noteRows } = await db
    .from("benchmarking_notes")
    .select("id, field_name, note")
    .eq("organization_id", organization.id)
    .eq("survey_id", activeSurvey.id)
    .eq("status", "respondent_review")
    .order("created_at", { ascending: true });

  const respondentNotes = (noteRows ?? []).map((n) => ({
    id: n.id as string,
    fieldLabel: (n.field_name as string)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    note: n.note as string,
  }));

  // 7c. the consent seal — is this year still changeable? Derived from whether a later
  // survey has opened, never from a stored flag.
  const { isYearSealed, sealMessage } = await import("@/lib/benchmarking/seal");
  const sealState = await isYearSealed(activeSurvey.fiscal_year);
  const sealedMessage = sealMessage(sealState);

  // 9. The opening page, shown until the store has made its disclosure choice.
  //
  // Gated on disclosure_level_set_at rather than on whether any answer exists,
  // because the question this page asks is the consent one — a store that has
  // typed figures but never decided how they may be used has not been asked
  // properly. `?start=1` lets someone who wants the form immediately past it.
  const hasChosen = Boolean(
    (currentRow as { disclosure_level_set_at?: string | null }).disclosure_level_set_at,
  );

  if (!hasChosen && !skipIntro) {
    const { data: chairRow } = await db
      .from("site_content")
      .select("title, body")
      .eq("section", "benchmarking_intro_chair")
      .eq("is_active", true)
      .maybeSingle();

    return (
      <SurveyIntro
        fiscalYear={activeSurvey.fiscal_year}
        organizationName={organization.name}
        fieldConfig={fieldConfig}
        benchmarkingId={currentRow!.id}
        disclosureLevel={
          (currentRow as { disclosure_level?: string }).disclosure_level === "aggregate_only"
            ? "aggregate_only"
            : "full"
        }
        closesOn={formatDeadline(activeSurvey.closes_at)}
        chairNote={chairRow ?? null}
        storeContacts={storeContacts}
        organizationSlug={organization.slug}
        termsAcknowledged={Boolean(
          (currentRow as { terms_acknowledged_at?: string | null }).terms_acknowledged_at,
        )}
        onBeginHref={
          isPreview
            ? `/benchmarking/survey?start=1&org=${organization.id}&preview=1`
            : isActingAsOther
              ? `/benchmarking/survey?start=1&org=${organization.id}`
              : "/benchmarking/survey?start=1"
        }
        // Same store, or staff print one store's worksheet while filling another's.
        worksheetHref={
          isPreview
            ? "/benchmarking/worksheet?preview=1"
            : isActingAsOther
              ? `/benchmarking/worksheet?org=${organization.id}`
              : "/benchmarking/worksheet"
        }
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/*
        Whose figures am I looking at? An admin editing a live submission on a
        page that looks identical to their own is how you type into the wrong
        store. The banner names it and switches away.
      */}
      {isActingAsOther && (
        <div className="mb-6">
          <AdminOrgSwitcher
            orgs={adminOrgOptions}
            selectedOrgId={organization.id}
            basePath="/benchmarking/survey"
            label="open the survey as"
          />
          <p className="mt-2 text-xs text-amber-800">
            This is {organization.name}&apos;s live submission. Anything you change here
            is saved to their record.
          </p>
        </div>
      )}
      <BenchmarkingSurveyForm
        benchmarkingId={currentRow!.id}
        fiscalYear={activeSurvey.fiscal_year}
        organizationId={organization.id}
        organizationName={organization.name}
        organizationProvince={organization.province}
        currentData={currentRow!}
        priorYearData={priorYearRow}
        deltaFlags={deltaFlags ?? []}
        surveyClosesAt={activeSurvey.closes_at}
        fieldConfig={fieldConfig}
        storeContacts={storeContacts}
        locations={locations}
        keyDates={keyDates}
        gmCategories={gmCategories}
        cmCategories={cmCategories}
        otherIncome={otherIncome}
        otherExpenses={otherExpenses}
        staff={staff}
        competitors={competitors}
        profileKeyDates={profileKeyDates}
        isBetaTester={isBetaTester}
        logos={{
          logoUrl: (orgLogos?.logo_url as string | null) ?? null,
          logoHorizontalUrl: (orgLogos?.logo_horizontal_url as string | null) ?? null,
          confirmedAt: (orgLogos?.logo_confirmed_at as string | null) ?? null,
        }}
      />

      {/* Anything a reviewer has written about this store, awaiting their yes. */}
      {respondentNotes.length > 0 && (
        <div className="mx-auto max-w-5xl px-4">
          <RespondentNotes notes={respondentNotes} />
        </div>
      )}

      {/*
        Below the form, not buried in it. This is a consent decision about the
        store's own business, and it deserves its own block rather than being
        one more field among ninety-five.
      */}
      <div className="mx-auto mt-8 max-w-5xl px-4">
        <DisclosureChoice
          sealedMessage={sealedMessage}
          benchmarkingId={currentRow!.id}
          initialLevel={
            currentRow!.disclosure_level === "aggregate_only" ? "aggregate_only" : "full"
          }
        />
      </div>
    </div>
  );
}
