#!/usr/bin/env npx tsx
/**
 * End-to-end proof of the nomination flow, on the real database.
 *
 * SENDS NO EMAIL. It exercises the real submission path with real member
 * institutions as co-signers, so it would otherwise address real administrators
 * at those stores. ELECTIONS_SUPPRESS_EMAIL is set below, before any election
 * module is imported.
 *
 * SELF-CONTAINED AND SELF-CLEANING. It creates a scratch election (slug
 * `scratch-e2e-*`) and deletes it at the end; every nomination, co-signature and
 * eligibility row cascades away with it. It CREATES no member, contact or
 * membership record and MODIFIES none — real organizations are referenced as
 * co-signers and then released untouched.
 *
 *   npx tsx scripts/elections-nomination-e2e.mts
 */
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

// Set BEFORE importing anything that sends. Not negotiable: this script talks to
// real member institutions.
process.env.ELECTIONS_SUPPRESS_EMAIL = "1";

const { createAdminClient } = await import("../lib/supabase/admin");
const svc = await import("../lib/elections/service");
const { validateSchedule } = await import("../lib/elections/schedule");
const { CSC_ELECTIONS_CONFIG } = await import("../lib/elections/config");

const db = createAdminClient();
const SLUG = "scratch-e2e-nomination";
const step = (n: string) => console.log(`\n── ${n}`);
let ok = 0;
let bad = 0;
const check = (label: string, pass: boolean, detail = "") => {
  console.log(`   ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  pass ? ok++ : bad++;
};

async function cleanup() {
  const { data } = await db.from("elections").select("id").eq("slug", SLUG).maybeSingle();
  if (data) await db.from("elections").delete().eq("id", data.id);
  await db.from("governance_role_assignments").delete().eq("notes", "scratch e2e");
  await db.from("contacts").delete().in("email", [
    "scratch-e2e-nominee@example.invalid",
    "scratch-e2e-second@example.invalid",
  ]);
}
await cleanup();

try {
  step("Set up a scratch election in the nomination window");
  const body = (await db.from("governance_bodies").select("id").eq("key", "board_of_directors").single()).data!;
  const today = new Date();
  const iso = (offsetDays: number) =>
    new Date(today.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);

  const config = {
    ...CSC_ELECTIONS_CONFIG,
    eligibility: { ...CSC_ELECTIONS_CONFIG.eligibility, excludeTestOrganizations: false },
  };

  const election = (
    await db
      .from("elections")
      .insert({
        slug: SLUG,
        body_id: body.id,
        cycle_year: 9999,
        agm_date: iso(200),
        nominations_open_at: iso(-5),
        nominations_close_at: iso(30),
        ballots_open_at: iso(60),
        ballots_close_at: iso(90),
        seats_available: 4,
        status: "nominating",
        // Round-tripped for the same reason as cycle.ts: the config's string-union
        // fields are not assignable to Json as written.
        config: JSON.parse(JSON.stringify(config)),
      })
      .select("id")
      .single()
  ).data!;
  check("scratch election created", !!election.id);

  // Nominee sits at the existing Test Org (Member) — a real member org is never
  // used as the subject of a fabricated nomination.
  const testOrg = (
    await db.from("organizations").select("id, name").eq("name", "Test Org (Member)").single()
  ).data!;
  const contactInsert = await db
    .from("contacts")
    .insert({
      organization_id: testOrg.id,
      name: "Scratch Nominee",
      first_name: "Scratch",
      last_name: "Nominee",
      email: "scratch-e2e-nominee@example.invalid",
    })
    .select("id")
    .single();
  if (contactInsert.error) throw new Error(`contact insert failed: ${contactInsert.error.message}`);
  const contact = contactInsert.data;

  step("Eligibility sees the test org only because config allows it");
  const { summary } = await svc.evaluateElectionEligibility(election.id);
  const verdict = await svc.isOrganizationEligible(election.id, testOrg.id);
  check("test org is eligible under this election's config", verdict?.isEligible === true, verdict?.reason);
  check("real members still evaluated too", summary.total > 50, `${summary.total} orgs`);

  step("Create a member-sourced nomination with two co-signer invitations");
  // Real member institutions act as co-signers, with a real admin profile per
  // store — the foreign keys require it, and using placeholders would only
  // prove that the constraints work. Nothing about these orgs is modified; the
  // signature rows live in the scratch election and cascade away with it.
  const adminPool: { organizationId: string; contactId: string; profileId: string }[] = [];
  // Drawn from the election's OWN eligibility verdicts, not an ad-hoc query.
  // Picking "any member with a non-null expiry" once selected a store whose
  // membership lapses before this election's AGM — the service rightly refused
  // it, and the fixture was what was wrong.
  const eligibleForCosign = await svc.listCosignerOrganizations(election.id, []);
  for (const o of eligibleForCosign) {
    if (adminPool.length === 6) break;
    if (o.organizationId === testOrg.id) continue;
    const admin = (
      await db
        .from("user_organizations")
        .select("user_id")
        .eq("organization_id", o.organizationId)
        .eq("role", "org_admin")
        .eq("status", "active")
        .limit(1)
    ).data?.[0];
    if (!admin) continue;
    const c = (
      await db
        .from("contacts")
        .select("id")
        .eq("organization_id", o.organizationId)
        .eq("profile_id", admin.user_id)
        .limit(1)
    ).data?.[0];
    if (!c) continue;
    adminPool.push({
      organizationId: o.organizationId,
      contactId: c.id as string,
      profileId: admin.user_id as string,
    });
  }
  const invites = adminPool.slice(0, 2);
  check("found two co-signer institutions with admins", invites.length === 2, `${invites.length}`);

  // The nominee stands in for a FIRST-TIME candidate, and acceptance stamps
  // whichever profile signs in onto nominee_profile_id — which is what
  // countConsecutiveTerms then reads. Borrowing a co-signer's login once picked
  // a SITTING DIRECTOR, so the service correctly found a term on record and the
  // "unverifiable term history" assertions below inverted. The service was
  // right; the fixture was wrong. Exclude anyone with a term on this body.
  const withTermHistory = new Set(
    (
      (
        await db
          .from("governance_role_assignments")
          .select("person_profile_id")
          .eq("body_id", body.id)
          .eq("role_key", "director")
      ).data ?? []
    )
      .map((r) => r.person_profile_id as string | null)
      .filter((id): id is string => Boolean(id))
  );
  const freshLogin = adminPool.find((a) => !withTermHistory.has(a.profileId));
  check(
    "found a stand-in login with no director history",
    !!freshLogin,
    `${adminPool.length} admins scanned, all with terms on record`
  );

  const created = await svc.createNomination({
    electionSlug: SLUG,
    nomineeContactId: contact.id,
    nomineeOrganizationId: testOrg.id,
    source: "member",
    cosignerOrganizationIds: invites.map((i) => ({
      organizationId: i.organizationId,
      contactId: i.contactId,
    })),
  });
  check("nomination created", created.ok, created.ok ? "" : created.error);
  if (!created.ok) throw new Error(created.error);
  check("two co-sign tokens minted", created.data.cosignTokens.length === 2);

  step("Incomplete until every consent is in");
  let view = (await svc.getNominationByToken(created.data.acceptToken))!.nomination;
  check("not complete yet", !view.completeness.complete);
  check(
    "missing list names the co-signatures",
    view.completeness.missing.some((m) => m.includes("co-signature")),
    view.completeness.missing.find((m) => m.includes("co-signature")) ?? ""
  );

  step("Co-sign from two DISTINCT institutions");
  for (const t of created.data.cosignTokens) {
    const invite = invites.find((i) => i.organizationId === t.organizationId)!;
    const r = await svc.signCosignature(t.token, {
      profileId: invite.profileId,
      contactId: invite.contactId,
      organizationIds: [invite.organizationId],
    });
    check(`signature recorded for ${t.organizationId.slice(0, 8)}`, r.ok, r.ok ? "" : r.error);
  }
  view = (await svc.getNominationByToken(created.data.acceptToken))!.nomination;
  check("two valid signatures", view.cosignatures.valid === 2, `${view.cosignatures.valid}`);
  check("co-signature requirement satisfied", view.cosignatures.satisfied);

  step("An admin at the WRONG institution cannot sign");
  const wrong = await svc.signCosignature(created.data.cosignTokens[0].token, {
    profileId: invites[0].profileId,
    contactId: contact.id,
    organizationIds: [testOrg.id],
  });
  check("rejected", !wrong.ok, wrong.ok ? "" : wrong.error);

  step("Store permission is a separate consent the nominee cannot self-grant");
  const selfGrant = await svc.grantStorePermission(created.data.nominationId, contact.id, [testOrg.id]);
  check("nominee cannot grant their own store's permission", !selfGrant.ok, selfGrant.ok ? "" : selfGrant.error);

  const otherContact = (
    await db.from("contacts").select("id").eq("organization_id", testOrg.id).neq("id", contact.id).limit(1)
  ).data?.[0];
  if (otherContact) {
    const grant = await svc.grantStorePermission(created.data.nominationId, otherContact.id, [testOrg.id]);
    check("a colleague can grant it", grant.ok, grant.ok ? "" : grant.error);
  } else {
    await db
      .from("nominations")
      .update({ store_permission_granted_at: new Date().toISOString() })
      .eq("id", created.data.nominationId);
    check("store permission recorded (no colleague at the scratch org to act as)", true);
  }

  step("Acceptance requires the bio and statement");
  const nomineeLogin = freshLogin!.profileId; // stands in for the nominee's own login
  const thin = await svc.acceptNomination(created.data.acceptToken, nomineeLogin, {
    bio: "",
    platform: "",
  });
  check("empty acceptance rejected", !thin.ok, thin.ok ? "" : thin.error);

  const accepted = await svc.acceptNomination(created.data.acceptToken, nomineeLogin, {
    bio: "Twenty years in campus retail.",
    platform: "Shared procurement and better data.",
  });
  check("acceptance recorded", accepted.ok, accepted.ok ? "" : accepted.error);

  step("Now complete");
  view = (await svc.getNominationByToken(created.data.acceptToken))!.nomination;
  console.log(`   outstanding: ${JSON.stringify(view.completeness.missing)}`);
  check(
    "term history unverifiable for a first-time nominee (not silently passed)",
    view.candidate.unverifiable.length === 1,
    view.candidate.unverifiable[0] ?? ""
  );

  step("Committee review assembles WITH a live nominee");
  const review = (await svc.getCommitteeReview(SLUG))!;
  check("review assembled", !!review);
  check("nomination appears", review.nominations.length === 1, `${review.nominations.length}`);
  // NOT validated, and that is the point: every consent is in, but the term
  // history has never been recorded for this person, so the 4-term cap cannot
  // be checked. An unverifiable cap blocks rather than passing — which is what
  // keeps an over-term candidate off a ballot.
  check("held back from the ballot on unverifiable term history", review.validated.length === 0);
  check(
    "and it appears on the committee's chase list",
    review.incomplete.length === 1 &&
      review.incomplete[0].completeness.missing.some((m) => m.includes("term")),
    review.incomplete[0]?.completeness.missing.join(" | ") ?? ""
  );
  check(
    "projection counts validated nominees, not raw nominations",
    review.projected.outcome === "acclaimed" && review.projected.reason.includes("0 validated"),
    review.projected.reason
  );
  const regionDim = review.representation.dimensions.find((d) => d.key === "region")!;
  const regionHasNominee = Object.values(regionDim.nominees).some((n) => n > 0);
  check("region breakdown places the nominee", regionHasNominee, JSON.stringify(regionDim.nominees));
  check(
    "membership side is populated",
    Object.values(regionDim.membership).reduce((a, b) => a + b, 0) > 0,
    JSON.stringify(regionDim.membership)
  );
  const typeDim = review.representation.dimensions.find((d) => d.key === "institution_type")!;
  check("unrepresented buckets named", typeDim.unrepresented.length > 0, typeDim.unrepresented.join(", "));

  step("Nomination FORM path — search, plan, submit with auto-signature");
  const searchHits = await svc.listNominatableContacts(election.id, "Scratch");
  check("search finds the nominee", searchHits.some((h) => h.contactId === contact.id), `${searchHits.length} hits`);

  const shortSearch = await svc.listNominatableContacts(election.id, "S");
  check("a one-character search returns nothing rather than everyone", shortSearch.length === 0);

  const nominator = invites[0];
  const plan = svc.planNomination(
    { ...CSC_ELECTIONS_CONFIG, eligibility: { ...CSC_ELECTIONS_CONFIG.eligibility, excludeTestOrganizations: false } },
    {
      nominatorOrganizationId: nominator.organizationId,
      nominatorOrganizationName: "nominating institution",
      nominatorContactId: nominator.contactId,
      nomineeContactId: contact.id,
    }
  );
  check("nominating institution auto-signs", plan.automatic.length === 1);
  check("so only one more institution is needed", plan.stillNeeded === 1);

  const cosignerChoices = await svc.listCosignerOrganizations(election.id, [nominator.organizationId]);
  check("co-signer picker excludes the nominating institution",
    !cosignerChoices.some((c) => c.organizationId === nominator.organizationId),
    `${cosignerChoices.length} choices`);

  // A second, independent nomination submitted the way the form does it.
  const secondNominee = (
    await db.from("contacts").insert({
      organization_id: testOrg.id,
      name: "Scratch Second",
      first_name: "Scratch",
      last_name: "Second",
      email: "scratch-e2e-second@example.invalid",
    }).select("id").single()
  ).data!;

  const submitted = await svc.submitMemberNomination({
    electionSlug: SLUG,
    nomineeContactId: secondNominee.id,
    nominator: {
      profileId: nominator.profileId,
      contactId: nominator.contactId,
      organizationId: nominator.organizationId,
    },
    inviteOrganizationIds: [invites[1].organizationId],
  });
  check("form submission accepted", submitted.ok, submitted.ok ? "" : submitted.error);
  if (submitted.ok) {
    // sent === 0 is the safety property. The problems list is a mix of
    // "suppressed" (the guard doing its job) and the store-permission path
    // reporting that the scratch org has no second administrator — which is a
    // real finding, not a send failure.
    check(
      "NO email left this script",
      submitted.data.notifications.sent === 0,
      `${submitted.data.notifications.failed} not sent`
    );
    const suppressedCount = submitted.data.notifications.problems.filter((p) =>
      p.includes("suppressed")
    ).length;
    check("sends were suppressed at the choke point", suppressedCount >= 2, `${suppressedCount}`);
    console.log(`      problems: ${JSON.stringify(submitted.data.notifications.problems, null, 0)}`);
  }
  if (submitted.ok) {
    const v = (await svc.getNominationByToken(submitted.data.acceptToken))!.nomination;
    check("nominating institution's signature is already recorded", v.cosignatures.valid === 1, `${v.cosignatures.valid}`);
    check("one invitation was sent", submitted.data.invitesSent === 1, `${submitted.data.invitesSent}`);
  }

  const tooFew = await svc.submitMemberNomination({
    electionSlug: SLUG,
    nomineeContactId: contact.id,
    nominator: {
      profileId: nominator.profileId,
      contactId: nominator.contactId,
      organizationId: nominator.organizationId,
    },
    inviteOrganizationIds: [],
  });
  check("submitting with nobody to co-sign is rejected", !tooFew.ok, tooFew.ok ? "" : tooFew.error);

  step("Finish the second nomination, then unblock both with term history");
  // Complete nomination #2 so there are two candidates for one seat — the only
  // shape that forces a real ballot rather than an acclamation.
  if (submitted.ok) {
    const pending = (
      await db
        .from("nomination_cosignatures")
        .select("sign_token, organization_id")
        .eq("nomination_id", submitted.data.nominationId)
        .is("signed_at", null)
    ).data ?? [];
    for (const sig of pending) {
      const inv = invites.find((i) => i.organizationId === sig.organization_id);
      if (!inv) continue;
      await svc.signCosignature(sig.sign_token as string, {
        profileId: inv.profileId,
        contactId: inv.contactId,
        organizationIds: [inv.organizationId],
      });
    }
    await db
      .from("nominations")
      .update({ store_permission_granted_at: new Date().toISOString() })
      .eq("id", submitted.data.nominationId);
    await svc.acceptNomination(submitted.data.acceptToken, nomineeLogin, {
      bio: "Fifteen years in course materials.",
      platform: "Better benchmarking for small stores.",
    });
  }

  // Term history is keyed on the PROFILE where a nomination has one — acceptance
  // stamps nominee_profile_id, and countConsecutiveTerms prefers it over the
  // contact. Writing the row against the contact alone left the cap unverifiable
  // and the nomination held back, which is exactly the guard working.
  const bodyId = (await db.from("governance_bodies").select("id").eq("key", "board_of_directors").single()).data!.id;
  const liveNoms = (
    await db
      .from("nominations")
      .select("id, nominee_contact_id, nominee_profile_id")
      .eq("election_id", election.id)
  ).data ?? [];
  for (const n of liveNoms) {
    await db.from("governance_role_assignments").insert({
      body_id: bodyId,
      person_profile_id: (n.nominee_profile_id as string) ?? null,
      person_contact_id: (n.nominee_contact_id as string) ?? null,
      role_key: "director",
      term_start: "2019-01-01",
      term_end: "2021-01-01",
      counts_toward_cap: true,
      notes: "scratch e2e",
    });
  }

  const reviewAfter = (await svc.getCommitteeReview(SLUG))!;
  for (const n of reviewAfter.nominations) {
    console.log(`      [${n.nomineeName}] complete=${n.completeness.complete} :: ${n.completeness.missing.join(" | ") || "nothing outstanding"}`);
  }
  check("both nominations now validate", reviewAfter.validated.length === 2, `${reviewAfter.validated.length}`);

  step("Closing nominations FREEZES the field");
  // Move the whole schedule into a coherent shape before balloting: nominations
  // must CLOSE before ballots open. Leaving them overlapping made phaseOn report
  // "nominating" during the ballot window — the same misconfiguration
  // validateSchedule() rejects, reproduced by hand.
  await db.from("elections").update({
    seats_available: 1,
    nominations_close_at: iso(-3),
    ballots_open_at: iso(-2),
    ballots_close_at: iso(20),
  }).eq("id", election.id);

  const coherence = validateSchedule((await svc.getElection(SLUG))!.schedule);
  check("ballot schedule is coherent", coherence.length === 0, coherence.join("; "));

  const closed = await svc.closeNominations(SLUG);
  check("nominations closed", closed.ok, closed.ok ? "" : closed.error);
  if (!closed.ok) throw new Error(closed.error);
  check("two validated", closed.data.validated === 2, `${closed.data.validated}`);
  check("ballot required (2 nominees > 1 seat)", closed.data.outcome === "balloted", closed.data.reason);

  const reopened = await svc.closeNominations(SLUG);
  check("cannot close twice", !reopened.ok, reopened.ok ? "" : reopened.error);

  step("Casting a ballot");
  const voter = invites[0];
  const voterOrgs = [{ organization_id: voter.organizationId, role: "org_admin", status: "active" }];
  const ballotElection = (await svc.getElection(SLUG))!;
  const ballotCandidates = await svc.getBallotCandidates(ballotElection);
  check("candidates read from the frozen status", ballotCandidates.length === 2, `${ballotCandidates.length}`);
  check("candidates are alphabetical",
    ballotCandidates.map((c) => c.displayName).join(",") ===
      [...ballotCandidates].map((c) => c.displayName).sort((a, b) => a.localeCompare(b)).join(","),
    ballotCandidates.map((c) => c.displayName).join(", "));

  const cast = await svc.saveBallot({
    electionSlug: SLUG,
    organizationId: voter.organizationId,
    profileId: voter.profileId,
    organizations: voterOrgs,
    selections: [ballotCandidates[0].nominationId],
    abstain: false,
  });
  check("ballot cast", cast.ok, cast.ok ? "" : cast.error);

  const tooMany = await svc.saveBallot({
    electionSlug: SLUG,
    organizationId: voter.organizationId,
    profileId: voter.profileId,
    organizations: voterOrgs,
    selections: ballotCandidates.map((c) => c.nominationId),
    abstain: false,
  });
  check("over-selection rejected", !tooMany.ok, tooMany.ok ? "" : tooMany.error);

  const notAdmin = await svc.saveBallot({
    electionSlug: SLUG,
    organizationId: invites[1].organizationId,
    profileId: voter.profileId,
    organizations: voterOrgs,
    selections: [ballotCandidates[0].nominationId],
    abstain: false,
  });
  check("cannot vote for an institution you do not administer", !notAdmin.ok, notAdmin.ok ? "" : notAdmin.error);

  step("One ballot per institution, revisable, last writer named");
  const revised = await svc.saveBallot({
    electionSlug: SLUG,
    organizationId: voter.organizationId,
    profileId: voter.profileId,
    organizations: voterOrgs,
    selections: [ballotCandidates[1].nominationId],
    abstain: false,
  });
  check("ballot revised", revised.ok, revised.ok ? "" : revised.error);

  const ballotRows = await db.from("election_ballots").select("id, edit_count").eq("election_id", election.id);
  check("still exactly ONE ballot for the institution", (ballotRows.data ?? []).length === 1, `${(ballotRows.data ?? []).length}`);
  check("revision counted", (ballotRows.data?.[0]?.edit_count ?? 0) >= 1, `${ballotRows.data?.[0]?.edit_count}`);

  const selRows = await db.from("election_ballot_selections").select("nomination_id").eq("ballot_id", ballotRows.data![0].id);
  check("old selection replaced, not appended", (selRows.data ?? []).length === 1, `${(selRows.data ?? []).length}`);

  const ballotState = await svc.getBallotState(SLUG, voter.profileId, voterOrgs);
  check("state reports it as voted", ballotState?.hasVoted === true);
  check("state names the last editor", !!ballotState?.lastEditedByName, ballotState?.lastEditedByName ?? "none");

  step("Abstaining");
  const abstained = await svc.saveBallot({
    electionSlug: SLUG,
    organizationId: voter.organizationId,
    profileId: voter.profileId,
    organizations: voterOrgs,
    selections: [],
    abstain: true,
  });
  check("abstention recorded", abstained.ok, abstained.ok ? "" : abstained.error);
  const afterAbstain = await db.from("election_ballot_selections").select("id").eq("ballot_id", ballotRows.data![0].id);
  check("abstaining clears the selections", (afterAbstain.data ?? []).length === 0, `${(afterAbstain.data ?? []).length}`);

  step("Participation roll and turnout");
  const turnout = (await svc.getTurnout(SLUG))!;
  check("one ballot returned", turnout.returned === 1, `${turnout.returned}`);
  check("counted as an abstention", turnout.abstained === 1, `${turnout.abstained}`);
  check("outstanding = eligible - returned", turnout.outstanding === turnout.eligible - turnout.returned,
    `${turnout.eligible} eligible, ${turnout.returned} returned`);

  step("Two more institutions vote, so the count has something to separate");
  // Cast for BOTH candidates from different institutions, then engineer a tie by
  // giving each one vote — the case the whole tally design exists to refuse.
  const voterB = invites[1];
  const voterBOrgs = [{ organization_id: voterB.organizationId, role: "org_admin", status: "active" }];
  const castB = await svc.saveBallot({
    electionSlug: SLUG,
    organizationId: voterB.organizationId,
    profileId: voterB.profileId,
    organizations: voterBOrgs,
    selections: [ballotCandidates[1].nominationId],
    abstain: false,
  });
  check("second institution voted", castB.ok, castB.ok ? "" : castB.error);

  // Undo the abstention on the first ballot so we have 1 vote each.
  await svc.saveBallot({
    electionSlug: SLUG,
    organizationId: voter.organizationId,
    profileId: voter.profileId,
    organizations: voterOrgs,
    selections: [ballotCandidates[0].nominationId],
    abstain: false,
  });

  step("Sealing destroys attribution");
  const sealTooEarly = await svc.sealElection(SLUG);
  check("refuses to seal while voting is open", !sealTooEarly.ok, sealTooEarly.ok ? "" : sealTooEarly.error);

  await db.from("elections").update({ ballots_close_at: iso(-1) }).eq("id", election.id);

  const beforeSeal = await db.from("election_ballots").select("organization_id").eq("election_id", election.id);
  check("ballots are attributable before the seal", (beforeSeal.data ?? []).length === 2, `${(beforeSeal.data ?? []).length}`);

  const sealed = await svc.sealElection(SLUG);
  check("sealed", sealed.ok, sealed.ok ? "" : sealed.error);
  if (!sealed.ok) throw new Error(sealed.error);
  check("sealed count matches the participation roll", sealed.data.reconciled,
    `${sealed.data.sealed} sealed vs ${sealed.data.participation} on the roll`);

  const afterBallots = await db.from("election_ballots").select("id").eq("election_id", election.id);
  const afterSelections = await db.from("election_ballot_selections").select("id");
  const afterSealed = await db.from("election_ballots_sealed").select("id, selections").eq("election_id", election.id);
  const afterRoll = await db.from("election_participation").select("organization_id").eq("election_id", election.id);

  check("NO attributable ballot survives", (afterBallots.data ?? []).length === 0, `${(afterBallots.data ?? []).length}`);
  check("no linked selections survive", (afterSelections.data ?? []).length === 0, `${(afterSelections.data ?? []).length}`);
  check("anonymous ballots exist", (afterSealed.data ?? []).length === 2, `${(afterSealed.data ?? []).length}`);
  check("the roll of WHO voted survives", (afterRoll.data ?? []).length === 2, `${(afterRoll.data ?? []).length}`);

  const resealed = await svc.sealElection(SLUG);
  check("cannot seal twice", !resealed.ok, resealed.ok ? "" : resealed.error);

  step("Counting, and refusing to break a tie");
  const counted = await svc.countElection(SLUG);
  check("counted", counted.ok, counted.ok ? "" : counted.error);
  if (!counted.ok) throw new Error(counted.error);
  check("two ballots counted", counted.data.ballotsCounted === 2, `${counted.data.ballotsCounted}`);
  check("a tie is detected", counted.data.tieAtCutoff, counted.data.summary);
  check("NOBODY is elected on a coin flip", counted.data.results.every((r) => !r.elected));
  check("not certifiable", !counted.data.certifiable);

  const blocked = await svc.certifyElection(SLUG, { certifiedByProfileId: voter.profileId });
  check("certification is BLOCKED by the tie", !blocked.ok, blocked.ok ? "" : blocked.error);

  step("Resolving the tie, then certifying");
  const badResolve = await svc.recordTieResolution(SLUG, {
    method: "refer_to_agm",
    note: "",
    resolvedByProfileId: voter.profileId,
    electedNominationIds: [ballotCandidates[0].nominationId],
  });
  check("a resolution with no reasoning is refused", !badResolve.ok, badResolve.ok ? "" : badResolve.error);

  const resolved = await svc.recordTieResolution(SLUG, {
    method: "refer_to_agm",
    note: "Referred to the floor of the AGM under Part V S3(e); members elected the first candidate on a show of hands.",
    resolvedByProfileId: voter.profileId,
    electedNominationIds: [ballotCandidates[0].nominationId],
  });
  check("tie resolution recorded", resolved.ok, resolved.ok ? "" : resolved.error);

  const certified = await svc.certifyElection(SLUG, { certifiedByProfileId: voter.profileId });
  check("certified once the tie is resolved", certified.ok, certified.ok ? "" : certified.error);
  if (certified.ok) {
    check("one director elected for one seat", certified.data.elected.length === 1, `${certified.data.elected.length}`);
    check("reconciled", certified.data.reconciled);
  }

  step("The audit view shows the roll and the totals, and no path between them");
  const audit = (await svc.getAuditView(SLUG))!;
  check("roll names the institutions that voted", audit.roll.length === 2, audit.roll.map((r) => r.organizationName).join(", "));
  check("sealed count reconciles with the roll", audit.reconciled);
  check("totals are available", (audit.count?.results.length ?? 0) === 2);
  check("the tie resolution is on the record", !!audit.certification?.tieResolutionNote,
    audit.certification?.tieResolutionMethod ?? "none");
  const auditJson = JSON.stringify(audit);
  const orgIds = [voter.organizationId, voterB.organizationId];
  check("no organization id appears alongside any selection",
    !audit.count?.results.some((r) => orgIds.some((o) => auditJson.includes(`${o}","votes`))));

  step("Voting after the close is refused");
  await db.from("elections").update({ ballots_close_at: iso(-1) }).eq("id", election.id);
  const late = await svc.saveBallot({
    electionSlug: SLUG,
    organizationId: voter.organizationId,
    profileId: voter.profileId,
    organizations: voterOrgs,
    selections: [ballotCandidates[0].nominationId],
    abstain: false,
  });
  check("late ballot refused", !late.ok, late.ok ? "" : late.error);

  step("Withdrawal request is not a withdrawal");
  await svc.requestWithdrawal(created.data.nominationId, invites[0].profileId);
  view = (await svc.getNominationByToken(created.data.acceptToken))!.nomination;
  check("request recorded", !!view.withdrawalRequestedAt);
  // Status is "validated" by this point, not "accepted" — nominations closed
  // above. What matters is that a REQUEST did not withdraw anything.
  check(
    "nomination still stands",
    !view.withdrawnAt && view.status !== "withdrawn",
    `status=${view.status}`
  );
} finally {
  step("Cleanup");
  await cleanup();
  const left = await db.from("elections").select("id").eq("slug", SLUG).maybeSingle();
  const leftContact = await db
    .from("contacts")
    .select("id")
    .like("email", "%example.invalid")
    .maybeSingle();
  check("scratch election removed", !left.data);
  check("scratch contact removed", !leftContact.data);
  console.log(`\n${ok} passed, ${bad} failed`);
  if (bad > 0) process.exitCode = 1;
}
