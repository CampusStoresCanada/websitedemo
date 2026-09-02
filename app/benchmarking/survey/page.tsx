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

export const metadata = {
  title: "Benchmarking Survey | Campus Stores Canada",
  description: "Complete your annual benchmarking survey.",
};

export default async function BenchmarkingSurveyPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    redirect("/login");
  }
  const { supabase, userId, globalRole } = auth.ctx;

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

  // A person can hold roles at more than one member store — someone who moved
  // institutions, or covers two campuses. .find() returned whichever row the
  // database happened to hand back first, which meant they could be filing
  // against the wrong store without ever being told.
  //
  // Prefer the store where they are actually org_admin, then fall back to
  // name order so the same person lands on the same store every time rather
  // than a different one per request.
  const memberOrgLinks = (userOrgs ?? [])
    .filter((uo) => {
      const org = uo.organization as unknown as { type: string } | null;
      return org?.type === "Member" && (uo.role === "org_admin" || isAdmin);
    })
    .sort((a, b) => {
      const adminFirst =
        Number(b.role === "org_admin") - Number(a.role === "org_admin");
      if (adminFirst !== 0) return adminFirst;
      const an = (a.organization as { name?: string } | null)?.name ?? "";
      const bn = (b.organization as { name?: string } | null)?.name ?? "";
      return an.localeCompare(bn);
    });

  const memberOrgLink = memberOrgLinks[0];

  if (!memberOrgLink && !isAdmin) {
    redirect("/benchmarking");
  }

  const organization = memberOrgLink?.organization as unknown as {
    id: string;
    name: string;
    slug: string;
    type: string;
    province: string;
  } | null;

  if (!organization) {
    redirect("/benchmarking");
  }

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

  const access = await resolveSurveyAccess({
    surveyId: activeSurvey.id,
    surveyStatus: activeSurvey.status,
    organizationId: organization.id,
    isAdmin,
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
  const db = createAdminClient();

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

  // 8. Get the field config for this survey (or DEFAULT if null)
  const fieldConfig = getFieldConfig(activeSurvey);

  // 9. The opening page, shown until the store has made its disclosure choice.
  //
  // Gated on disclosure_level_set_at rather than on whether any answer exists,
  // because the question this page asks is the consent one — a store that has
  // typed figures but never decided how they may be used has not been asked
  // properly. `?start=1` lets someone who wants the form immediately past it,
  // and the intro stays reachable from the form afterwards, because the choice
  // must remain changeable for the whole cycle.
  const params = await searchParams;
  const hasChosen = Boolean(
    (currentRow as { disclosure_level_set_at?: string | null }).disclosure_level_set_at,
  );
  const skipIntro = params?.start === "1";

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
        onBeginHref="/benchmarking/survey?start=1"
      />
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <BenchmarkingSurveyForm
        benchmarkingId={currentRow!.id}
        fiscalYear={activeSurvey.fiscal_year}
        organizationName={organization.name}
        organizationProvince={organization.province}
        currentData={currentRow!}
        priorYearData={priorYearRow}
        deltaFlags={deltaFlags ?? []}
        surveyClosesAt={activeSurvey.closes_at}
        fieldConfig={fieldConfig}
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
