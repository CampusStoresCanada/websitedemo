/**
 * Onboarding Nudge Job
 *
 * Runs daily via /api/cron/onboarding-nudge.
 * Finds org admins with pending onboarding steps and sends them the right nudge
 * at the right time — no earlier, no later, never for something already done.
 *
 * See docs/ONBOARDING_JOURNEY.md for the full step map and timing rationale.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { lookupUserEmailsByIds } from "@/lib/supabase/user-lookup";
import { sendEmail } from "@/lib/email/send";
import { STEP_SCHEDULE } from "./nudge-schedule";

/**
 * Most one person hears from us in a single run. Journeys go back to 2026-05-26,
 * so any newly-scheduled step is instantly past its sendAfterDays for every
 * existing row — without a cap, switching on four steps would land four emails
 * in one morning. Deterministic order (earliest sendAfterDays first) means the
 * rest simply arrive on following days.
 */
const MAX_SENDS_PER_USER_PER_RUN = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Types for the DB rows we read
// ─────────────────────────────────────────────────────────────────────────────

interface ProgressRow {
  id: string;
  user_id: string;
  step_key: string;
  journey_started_at: string;
  sent_at: string | null;
  completed_at: string | null;
  skipped_at: string | null;
  reminder_count: number;
  last_reminder_sent_at: string | null;
}

interface UserContext {
  userId: string;
  email: string;
  displayName: string;
  firstName: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  orgProvince: string | null;
  hasDescription: boolean;
  hasLogo: boolean;
  hasHero: boolean;
  hasContacts: boolean;
  hasContactPhotos: boolean;
  hasFeaturedProduct: boolean;
  hasCatalogueOrLinks: boolean;
  hasBackground: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function daysSince(isoString: string): number {
  // Supabase returns timestamptz without a Z — normalise to UTC
  const normalised = isoString.endsWith("Z") || isoString.includes("+")
    ? isoString
    : isoString.replace(" ", "T") + "Z";
  const ms = Date.now() - new Date(normalised).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca";
}

// ─────────────────────────────────────────────────────────────────────────────
// Email template builder
// Conversational tone — like a colleague, not a manual.
// ─────────────────────────────────────────────────────────────────────────────

interface NudgeEmailOptions {
  firstName: string;
  orgName: string;
  orgSlug: string;
  orgProvince: string | null;
  stepKey: string;
  isReminder: boolean;
}

/**
 * Exported so the copy can be rendered and read before it goes out. These are
 * unsolicited emails to real partners; the body is the product, and reviewing
 * it in a browser beats reading template literals in a diff.
 * `sendEmail` wraps whatever this returns in the branded CSC layout
 * (lib/email/layout.ts) at send time — this is the content block, not the
 * whole message.
 */
export function buildNudgeEmail(opts: NudgeEmailOptions): { subject: string; html: string } | null {
  const { firstName, orgName, orgSlug, stepKey, isReminder } = opts;
  const base = appUrl();
  const orgUrl = `${base}/org/${orgSlug}`;
  const reminder = isReminder ? " (just a gentle nudge)" : "";

  switch (stepKey) {
    case "profile_description":
      return {
        subject: isReminder
          ? `${orgName}'s description — still worth a look`
          : `Your description is the first thing they read`,
        html: nudgeHtml({
          firstName,
          headline: "First impressions happen fast.",
          body: `Your organization description is the first thing members and vendor partners read when they land on ${orgName}'s page. Does it still say what you want it to say?<br><br>It only takes a minute to update — click the pencil icon on any field when you're on your org page.`,
          ctaText: "Go to my org page",
          ctaUrl: orgUrl,
          footnote: isReminder ? `You got a nudge about this a few days ago${reminder}.` : undefined,
        }),
      };

    case "profile_logo":
      return {
        subject: isReminder
          ? `${orgName} still needs a logo`
          : `Your logo — is it on here?`,
        html: nudgeHtml({
          firstName,
          headline: "A face to the name.",
          body: `${orgName} ${isReminder ? "still doesn't have a logo on here." : "doesn't have a logo on the platform yet."} It shows up in the directory, on your org page, and next to your contacts. Worth adding if you haven't already.`,
          ctaText: "Add a logo",
          ctaUrl: orgUrl,
        }),
      };

    case "profile_hero":
      return {
        subject: `Make ${orgName}'s page stand out`,
        html: nudgeHtml({
          firstName,
          headline: "A hero image goes a long way.",
          body: `A hero image at the top of ${orgName}'s page makes it look like you own the space — because you do. It can be a photo of your store, your campus, your team. Anything that says "this is us."`,
          ctaText: "Add a hero image",
          ctaUrl: orgUrl,
          footnote: isReminder ? "Still worth doing when you get a moment." : undefined,
        }),
      };

    case "contacts_sorted":
      return {
        subject: `Who's the right person to call at ${orgName}?`,
        html: nudgeHtml({
          firstName,
          headline: "Contacts matter more than people think.",
          body: `When vendor partners want to reach ${orgName}, they look at your contacts page. When members want to know who runs what, they look at your contacts page. Make sure the right people are listed, in the right order, with accurate roles.`,
          ctaText: "Review my contacts",
          ctaUrl: orgUrl,
          footnote: isReminder ? "This one's quick — worth doing today." : undefined,
        }),
      };

    case "contact_photos":
      return {
        subject: `Faces make a difference`,
        html: nudgeHtml({
          firstName,
          headline: "People connect with people.",
          body: `The contacts members reach out to most are the ones with photos. It's a small thing that makes a real difference. If your key contacts don't have profile photos yet, it's worth uploading them.`,
          ctaText: "Update contact photos",
          ctaUrl: orgUrl,
          footnote: isReminder ? `Still no photos on some contacts at ${orgName} — quick one when you have a spare minute.` : undefined,
        }),
      };

    case "conference_delegates":
      return {
        subject: isReminder
          ? `Conference delegates — any updates for ${orgName}?`
          : `Have you sorted delegates for the conference?`,
        html: nudgeHtml({
          firstName,
          headline: "Conference time is coming.",
          body: `Have you sorted who's going from ${orgName}? Getting your delegates confirmed early means smoother logistics on our end — and yours. You can manage this right on your org page.`,
          ctaText: "Sort my delegates",
          ctaUrl: orgUrl,
        }),
      };

    case "profile_categories":
      return {
        subject: isReminder
          ? `${orgName}'s categories — worth a second look`
          : `Did we get ${orgName}'s categories right?`,
        html: nudgeHtml({
          firstName,
          headline: "We guessed. You'd know better.",
          body: `Your categories decide where ${orgName} turns up when a member goes looking for a supplier. We set them from what we knew when we built your profile — an educated guess at best, and nobody here sells what you sell.<br><br>Worth a look to correct them. Be specific: it's better to appear in three categories you genuinely serve than a dozen you don't.`,
          ctaText: "Check my categories",
          ctaUrl: orgUrl,
          footnote: isReminder ? "Takes about a minute — and it's the field members search on." : undefined,
        }),
      };

    case "profile_featured_product":
      return {
        subject: isReminder
          ? `Still nothing featured for ${orgName}`
          : `What's the one thing you want members to see?`,
        html: nudgeHtml({
          firstName,
          headline: "Pick one product to lead with.",
          body: `Your profile has a Featured Product slot, and ${orgName}'s is empty. It's the thing members see first when they land on your page — a new line, a seasonal item, whatever you'd point at if someone walked up to your booth.<br><br>One product. A name and a sentence about it is plenty.`,
          ctaText: "Feature a product",
          ctaUrl: orgUrl,
        }),
      };

    case "profile_links_docs":
      return {
        subject: isReminder
          ? `${orgName}'s catalogue — still missing`
          : `Get your catalogue in front of members`,
        html: nudgeHtml({
          firstName,
          headline: "Members are looking for your range.",
          body: `${orgName} doesn't have a catalogue or price list linked yet. Members browsing the directory can see who you are, but not what you carry — and that's usually the next thing they want.<br><br>A link to your catalogue is enough. It doesn't have to be hosted here.`,
          ctaText: "Add my catalogue",
          ctaUrl: orgUrl,
          footnote: isReminder ? "A link is fine — no upload needed." : undefined,
        }),
      };

    // Parked: no STEP_SCHEDULE entry, so this is never built. Kept so
    // re-enabling the step is one line in nudge-schedule.ts.
    case "profile_background":
      return {
        subject: `Finish off ${orgName}'s page`,
        html: nudgeHtml({
          firstName,
          headline: "One last touch.",
          body: `${orgName}'s profile page has a background image slot that's still empty. It sits behind your hero and logo and is the difference between a page that looks filled in and one that looks unfinished.<br><br>Purely cosmetic — but it's the last thing on the list.`,
          ctaText: "Add a background",
          ctaUrl: orgUrl,
        }),
      };

    case "visibility_intro":
      return {
        subject: `Did you know you control what vendor partners see?`,
        html: nudgeHtml({
          firstName,
          headline: "You're managing three audiences at once.",
          body: `Here's something a lot of org admins don't realise at first: what your members see about ${orgName}, what vendor partners see, and what the public can see are <em>not the same</em>.<br><br>You control all of it. Some information should be open. Some should stay inside the network. Some should stay inside your own team. That's all configurable from your org page.`,
          ctaText: "See my visibility settings",
          ctaUrl: orgUrl,
          footnote: "Worth understanding before you add more content.",
        }),
      };

    case "network_members":
      return {
        subject: `Meet the rest of the network`,
        html: nudgeHtml({
          firstName,
          headline: "You've got peers across the country.",
          body: `The Members directory has every campus store that's part of CSC. ${opts.orgProvince ? `${opts.orgProvince} alone has a handful of stores you'd probably recognize.` : "There are stores from coast to coast you'd probably recognize."} Worth a look — there are people in there you'll want to know.`,
          ctaText: "See the Members directory",
          ctaUrl: `${base}/members`,
        }),
      };

    case "network_partners":
      return {
        subject: `The vendors on CSC can see your profile`,
        html: nudgeHtml({
          firstName,
          headline: "This is who you're connected to.",
          body: `The Partners directory is all the vendors and suppliers active on CSC. They can already see ${orgName}'s page. It's worth knowing who they are — and having a look at your own page through their eyes.`,
          ctaText: "Browse Partners",
          ctaUrl: `${base}/partners`,
        }),
      };

    case "network_member_space":
      return {
        subject: `Member Space — same you, same platform`,
        html: nudgeHtml({
          firstName,
          headline: "One login. One platform.",
          body: `Member Space isn't a separate app. Same login you're already using. It's the community layer — discussions, announcements, resources — all connected to the same profile and permissions you have here. Worth exploring if you haven't already.`,
          ctaText: "Open Member Space",
          ctaUrl: `${base}/members-space`,
          footnote: isReminder ? "Still the same login — no new password needed." : undefined,
        }),
      };

    case "events_discovery":
      return {
        subject: `Events coming up for ${orgName}`,
        html: nudgeHtml({
          firstName,
          headline: "There are events relevant to you.",
          body: `The CSC events calendar has sessions relevant to your store, your region, and your role. ${opts.orgProvince ? `If you're in ${opts.orgProvince}, there's likely something in your area.` : "Scroll through and see what's coming up near you."} Some of these you can add to your calendar right from the platform.`,
          ctaText: "Browse events",
          ctaUrl: `${base}/events`,
          footnote: isReminder ? "Worth bookmarking the ones relevant to your team." : undefined,
        }),
      };

    case "benchmarking_survey":
      return {
        subject: isReminder
          ? `Benchmarking survey — still open`
          : `The benchmarking survey is open`,
        html: nudgeHtml({
          firstName,
          headline: "Your peers are already in.",
          body: `The annual benchmarking survey is open. The more stores that participate, the more useful the data is for everyone — including you. ${isReminder ? "It's still open if you haven't had a chance yet." : "It doesn't take long, and the results are worth having."}`,
          ctaText: "Start the survey",
          ctaUrl: `${base}/benchmarking`,
        }),
      };

    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Base email wrapper — clean, minimal, on-brand
// ─────────────────────────────────────────────────────────────────────────────

interface NudgeHtmlOptions {
  firstName: string;
  headline: string;
  body: string;
  ctaText: string;
  ctaUrl: string;
  footnote?: string;
}

function nudgeHtml(opts: NudgeHtmlOptions): string {
  const { firstName, headline, body, ctaText, ctaUrl, footnote } = opts;
  const footBlock = footnote
    ? `<p style="margin:20px 0 0;font-size:12px;color:#9CA3AF;">${footnote}</p>`
    : "";

  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1A1A1A;">
      <div style="border-top:3px solid #C8102E;padding-top:20px;margin-bottom:24px;">
        <p style="margin:0;font-size:13px;color:#9CA3AF;text-transform:uppercase;letter-spacing:.05em;">Campus Stores Canada</p>
      </div>
      <p style="margin:0 0 4px;font-size:16px;">Hey ${firstName},</p>
      <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#163D6D;">${headline}</h2>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">${body}</p>
      <p style="margin:0 0 32px;">
        <a href="${ctaUrl}"
           style="display:inline-block;background:#163D6D;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">
          ${ctaText} →
        </a>
      </p>
      ${footBlock}
      <hr style="border:none;border-top:1px solid #E5E7EB;margin:32px 0 16px;">
      <p style="margin:0;font-size:11px;color:#9CA3AF;">
        You're receiving this because you're an org admin on the CSC platform.
        Questions? Reply to this email.
      </p>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conditional checks
// ─────────────────────────────────────────────────────────────────────────────

async function isConferenceWithin60Days(db: ReturnType<typeof createAdminClient>): Promise<boolean> {
  const today = new Date();
  const cutoff = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data } = await db
    .from("conference_instances")
    .select("id")
    .gte("start_date", today.toISOString().slice(0, 10))
    .lte("start_date", cutoff)
    .limit(1);
  return (data ?? []).length > 0;
}

async function isBenchmarkingOpen(db: ReturnType<typeof createAdminClient>): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any)
    .from("benchmarking_surveys")
    .select("id")
    .eq("status", "open")
    .lte("start_date", today)
    .gte("end_date", today)
    .limit(1);
  return (data ?? []).length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-completion detection
// Before sending a nudge, check if the step is already "done" in the real data.
// If so, mark it complete in the progress table and skip.
// ─────────────────────────────────────────────────────────────────────────────

async function autoCompleteIfDone(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  row: ProgressRow,
  ctx: UserContext,
): Promise<boolean> {
  const now = new Date().toISOString();

  switch (row.step_key) {
    case "profile_description":
      if (ctx.hasDescription) {
        await db.from("user_onboarding_progress")
          .update({ completed_at: now, updated_at: now })
          .eq("id", row.id);
        return true;
      }
      break;
    case "profile_logo":
      if (ctx.hasLogo) {
        await db.from("user_onboarding_progress")
          .update({ completed_at: now, updated_at: now })
          .eq("id", row.id);
        return true;
      }
      break;
    case "profile_hero":
      if (ctx.hasHero) {
        await db.from("user_onboarding_progress")
          .update({ completed_at: now, updated_at: now })
          .eq("id", row.id);
        return true;
      }
      break;
    case "contacts_sorted":
      if (ctx.hasContacts) {
        await db.from("user_onboarding_progress")
          .update({ completed_at: now, updated_at: now })
          .eq("id", row.id);
        return true;
      }
      break;
    case "contact_photos":
      if (ctx.hasContactPhotos) {
        await db.from("user_onboarding_progress")
          .update({ completed_at: now, updated_at: now })
          .eq("id", row.id);
        return true;
      }
      break;
    // Presence tests mirror lib/publication/completeness.ts's isFieldFilled —
    // never ask a partner for something the directory already has.
    //
    // profile_categories is deliberately absent. CSC staff populated categories
    // by guessing at what each partner sells, so a non-empty value is an
    // unverified assumption, not a confirmation — and auto-completing on it
    // would silence the nudge for exactly the 31 of 32 partners whose
    // categories most need a human to check them. This step always sends.
    case "profile_featured_product":
      if (ctx.hasFeaturedProduct) {
        await db.from("user_onboarding_progress")
          .update({ completed_at: now, updated_at: now })
          .eq("id", row.id);
        return true;
      }
      break;
    case "profile_links_docs":
      if (ctx.hasCatalogueOrLinks) {
        await db.from("user_onboarding_progress")
          .update({ completed_at: now, updated_at: now })
          .eq("id", row.id);
        return true;
      }
      break;
    case "profile_background":
      if (ctx.hasBackground) {
        await db.from("user_onboarding_progress")
          .update({ completed_at: now, updated_at: now })
          .eq("id", row.id);
        return true;
      }
      break;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main job
// ─────────────────────────────────────────────────────────────────────────────

export interface NudgeJobResult {
  processed: number;
  sent: number;
  skipped: number;
  errors: string[];
  log: string[];
}

export async function runOnboardingNudgeJob(): Promise<NudgeJobResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any;
  const result: NudgeJobResult = { processed: 0, sent: 0, skipped: 0, errors: [], log: [] };

  // ── 1. Check conditional flags once for this run ──────────────────────────
  const [conferenceActive, benchmarkingOpen] = await Promise.all([
    isConferenceWithin60Days(createAdminClient()),
    isBenchmarkingOpen(createAdminClient()),
  ]);
  result.log.push(`conditionals: conference=${conferenceActive}, benchmarking=${benchmarkingOpen}`);

  // ── 2. Find all pending progress rows across all personas ────────────────
  const { data: pendingRows, error: fetchError } = await db
    .from("user_onboarding_progress")
    .select("id, user_id, step_key, persona, journey_started_at, sent_at, completed_at, skipped_at, reminder_count, last_reminder_sent_at")
    .in("persona", ["org_admin_member", "org_admin_partner", "member_member", "member_partner", "org_admin"])
    .is("completed_at", null)
    .is("skipped_at", null)
    .neq("step_key", "session_1_welcome"); // handled by WelcomeModal

  if (fetchError) {
    result.errors.push(`fetch pending rows: ${fetchError.message}`);
    return result;
  }

  const rows = (pendingRows ?? []) as ProgressRow[];
  if (rows.length === 0) {
    result.log.push("no pending rows");
    return result;
  }

  // ── 3. Group by user ──────────────────────────────────────────────────────
  const byUser = new Map<string, ProgressRow[]>();
  for (const row of rows) {
    const arr = byUser.get(row.user_id) ?? [];
    arr.push(row);
    byUser.set(row.user_id, arr);
  }

  // ── 4. Fetch user context for all users in one pass ───────────────────────
  const userIds = Array.from(byUser.keys());

  // Auth emails
  const emailById = new Map(Object.entries(await lookupUserEmailsByIds(createAdminClient(), userIds)));

  // Profiles (display_name)
  const { data: profiles } = await createAdminClient()
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds);
  const nameById = new Map<string, string | null>();
  for (const p of (profiles ?? []) as { id: string; display_name: string | null }[]) {
    nameById.set(p.id, p.display_name);
  }

  // Org memberships (first org per user where role = org_admin)
  const { data: memberships } = await createAdminClient()
    .from("user_organizations")
    .select("user_id, organization_id, role")
    .in("user_id", userIds)
    .eq("role", "org_admin")
    .eq("status", "active");

  // First org_id per user
  const orgIdByUser = new Map<string, string>();
  for (const m of (memberships ?? []) as { user_id: string; organization_id: string }[]) {
    if (!orgIdByUser.has(m.user_id)) orgIdByUser.set(m.user_id, m.organization_id);
  }

  const orgIds = Array.from(new Set(orgIdByUser.values()));

  // Org data
  const { data: orgs } = await createAdminClient()
    .from("organizations")
    .select("id, name, slug, province, company_description, logo_url, hero_image_url, highlight_product_name, catalogue_url, partner_links, banner_url")
    .in("id", orgIds);

  type OrgRow = {
    id: string; name: string; slug: string; province: string | null;
    company_description: string | null; logo_url: string | null; hero_image_url: string | null;
    highlight_product_name: string | null;
    catalogue_url: string | null; partner_links: unknown; banner_url: string | null;
  };
  const orgById = new Map<string, OrgRow>();
  for (const o of (orgs ?? []) as OrgRow[]) orgById.set(o.id, o);

  // Contact counts + photo check (per org)
  const { data: contacts } = await createAdminClient()
    .from("contacts")
    .select("id, organization_id, profile_picture_url")
    .in("organization_id", orgIds);

  const orgHasContacts = new Map<string, boolean>();
  const orgHasPhotos = new Map<string, boolean>();
  for (const c of (contacts ?? []) as { id: string; organization_id: string; profile_picture_url: string | null }[]) {
    orgHasContacts.set(c.organization_id, true);
    if (c.profile_picture_url) orgHasPhotos.set(c.organization_id, true);
  }

  // ── 5. Build UserContext per user ─────────────────────────────────────────
  const ctxByUser = new Map<string, UserContext>();
  for (const userId of userIds) {
    const email = emailById.get(userId);
    if (!email) continue;
    const orgId = orgIdByUser.get(userId);
    if (!orgId) continue;
    const org = orgById.get(orgId);
    if (!org) continue;

    const displayName = nameById.get(userId) ?? email.split("@")[0];
    const firstName = displayName.split(" ")[0] || displayName;

    ctxByUser.set(userId, {
      userId,
      email,
      displayName,
      firstName,
      orgId,
      orgName: org.name,
      orgSlug: org.slug,
      orgProvince: org.province,
      hasDescription: Boolean(org.company_description?.trim()),
      hasLogo: Boolean(org.logo_url),
      hasHero: Boolean(org.hero_image_url),
      hasContacts: orgHasContacts.get(orgId) ?? false,
      hasContactPhotos: orgHasPhotos.get(orgId) ?? false,
      hasFeaturedProduct: Boolean(org.highlight_product_name?.trim()),
      hasCatalogueOrLinks:
        Boolean(org.catalogue_url?.trim()) ||
        (Array.isArray(org.partner_links) && org.partner_links.length > 0),
      hasBackground: Boolean(org.banner_url?.trim()),
    });
  }

  // ── 6. Process each user's pending rows ───────────────────────────────────
  for (const [userId, userRows] of byUser) {
    const ctx = ctxByUser.get(userId);
    if (!ctx) {
      result.log.push(`skip ${userId}: no context (no email, org, or profile)`);
      continue;
    }

    // Earliest step in the journey first, so when the cap bites, the row that
    // goes out is the one that was due longest — not whatever the DB returned first.
    const ordered = [...userRows].sort(
      (a, b) => (STEP_SCHEDULE[a.step_key]?.sendAfterDays ?? 999) - (STEP_SCHEDULE[b.step_key]?.sendAfterDays ?? 999)
    );
    let sentForUser = 0;

    for (const row of ordered) {
      result.processed++;
      const schedule = STEP_SCHEDULE[row.step_key];

      // Unknown step key — skip silently (shouldn't happen in production)
      if (!schedule) {
        result.skipped++;
        continue;
      }

      // Check conditional flags
      if (schedule.conditional === "conference_within_60_days" && !conferenceActive) {
        result.skipped++;
        result.log.push(`skip ${ctx.email} / ${row.step_key}: conference not active`);
        continue;
      }
      if (schedule.conditional === "benchmarking_open" && !benchmarkingOpen) {
        result.skipped++;
        result.log.push(`skip ${ctx.email} / ${row.step_key}: benchmarking not open`);
        continue;
      }

      // Auto-complete if the org data already satisfies the condition
      const alreadyDone = await autoCompleteIfDone(db, row, ctx);
      if (alreadyDone) {
        result.skipped++;
        result.log.push(`auto-complete ${ctx.email} / ${row.step_key}: condition already met`);
        continue;
      }

      const daysSinceStart = daysSince(row.journey_started_at);
      const now = new Date().toISOString();

      // ── Determine what action to take ──
      let shouldSendInitial = false;
      let shouldSendReminder = false;

      if (!row.sent_at) {
        // Not yet sent — check if initial trigger has elapsed
        shouldSendInitial = daysSinceStart >= schedule.sendAfterDays;
      } else {
        // Already sent — check if a reminder is due
        const lastSent = row.last_reminder_sent_at ?? row.sent_at;
        const daysSinceLast = daysSince(lastSent);
        const remindersLeft = schedule.maxReminders - row.reminder_count;

        if (
          schedule.reminderEveryDays !== null &&
          remindersLeft > 0 &&
          daysSinceLast >= schedule.reminderEveryDays
        ) {
          shouldSendReminder = true;
        }
      }

      if (!shouldSendInitial && !shouldSendReminder) {
        result.skipped++;
        continue;
      }

      // Cap sends per user per run. Checked after auto-complete so a capped
      // user's remaining rows still get marked done when the data says so.
      if (sentForUser >= MAX_SENDS_PER_USER_PER_RUN) {
        result.skipped++;
        result.log.push(`cap ${ctx.email} / ${row.step_key}: already nudged this run`);
        continue;
      }

      // ── Build the email ──
      const emailContent = buildNudgeEmail({
        firstName: ctx.firstName,
        orgName: ctx.orgName,
        orgSlug: ctx.orgSlug,
        orgProvince: ctx.orgProvince,
        stepKey: row.step_key,
        isReminder: shouldSendReminder,
      });

      if (!emailContent) {
        result.skipped++;
        result.log.push(`no email template for ${row.step_key}`);
        continue;
      }

      // ── Send ──
      const sendResult = await sendEmail({
        to: ctx.email,
        subject: emailContent.subject,
        html: emailContent.html,
      });

      if (!sendResult.success) {
        result.errors.push(`send ${ctx.email} / ${row.step_key}: ${sendResult.error}`);
        continue;
      }

      result.sent++;
      sentForUser++;
      result.log.push(`sent ${ctx.email} / ${row.step_key} (${shouldSendReminder ? "reminder" : "initial"})`);

      // ── Update the progress row ──
      if (shouldSendInitial) {
        await db.from("user_onboarding_progress").update({
          sent_at: now,
          channel: "email",
          updated_at: now,
        }).eq("id", row.id);
      } else {
        await db.from("user_onboarding_progress").update({
          last_reminder_sent_at: now,
          reminder_count: row.reminder_count + 1,
          updated_at: now,
        }).eq("id", row.id);
      }
    }
  }

  return result;
}
