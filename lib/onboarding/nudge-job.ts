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
import type { Persona } from "./steps";

/**
 * Most one person hears from us in a single run. Journeys go back to 2026-05-26,
 * so any newly-scheduled step is instantly past its sendAfterDays for every
 * existing row — without a cap, switching on four steps would land four emails
 * in one morning. Deterministic order (earliest sendAfterDays first) means the
 * rest simply arrive on following days.
 */
const MAX_SENDS_PER_USER_PER_RUN = 1;

/**
 * Quiet days a person gets after ANY CSC email before this job adds another.
 *
 * The cap above governs one run. It does nothing about consecutive runs, and
 * it cannot see the rest of our sending at all — so on 2026-09-21 the Town
 * Hall campaign reached 529 people at 15:15 and the nudge cron would have put
 * a profile reminder in the same inboxes at 10:00 the next morning. Different
 * calendar days, same reading session.
 *
 * Counts campaign deliveries as well as previous nudges, which is what makes
 * one rule cover both problems: a campaign suppresses the next nudge, and a
 * nudge suppresses the one after it. Measured on 2026-09-24's backlog, 40
 * people have an overdue step and the median is a single email — but 8 of them
 * would otherwise get five to seven consecutive mornings.
 *
 * ⚠️ It can only see what is written down. Campaigns leave message_deliveries
 * rows and nudges leave sent_at on the progress row. Renewal and grace mail
 * call sendTransactional directly and leave no trace, so they stay invisible
 * here and can still land beside a nudge.
 */
const QUIET_DAYS_AFTER_ANY_EMAIL = 2;

/**
 * Steps whose backing field exists only on a Vendor Partner page.
 *
 * `company_description`, `catalogue_url` and `partner_links` are rendered and
 * edited by PartnerProfile.tsx (and PartnerLinksSection, which only
 * PartnerProfile mounts). MemberProfile.tsx carries none of them.
 *
 * `profile_featured_product` was in this set for a day and should not have been.
 * A campus store HAS a featured product — it is an image, `product_overlay_url`,
 * anchored on the member page under this very step key — and 73 of 79 have
 * already set one. The step was never unreachable; `autoCompleteIfDone` was
 * reading the vendor column, so stores who had done it were told they hadn't.
 * Fixed at the check rather than by silencing the mail. They sit in ORG_ADMIN_MEMBER_STEPS anyway, so a campus
 * store admin is mailed about a field that is not on their page, sent to their
 * org page to look for it, and then — because autoCompleteIfDone can never
 * observe a value that has no input — mailed a reminder about it.
 *
 * The data says it plainly: 1 of 79 member orgs has a description (the one
 * exception predates the current page), 0 have a featured product, 0 have
 * links. Partners: 71, 47 and 46 of 83. As of 2026-09-16 that left 103 rows
 * that can never complete — 84 of them already sent and holding a reminder.
 *
 * Gated on ORGANISATION TYPE rather than persona on purpose: one of those rows
 * carries the legacy persona `org_admin`, which no longer appears in
 * STEPS_BY_PERSONA and would slip past a persona check.
 *
 * This suppresses the SEND only. Rows are left pending rather than marked
 * skipped, so if these fields are ever added to the member page the journey
 * resumes by itself instead of needing a second migration to undo this one.
 */
const PARTNER_PAGE_FIELD_STEPS = new Set([
  "profile_description",
  "profile_links_docs",
]);

/** organizations.type for the vendor program — capitalised, as stored. */
const PARTNER_ORG_TYPE = "Vendor Partner";


/**
 * Nothing leaves this job before this moment.
 *
 * The Town Hall invite went to 529 people on 2026-09-21 and the ask in it is
 * "go and sign in". Uptake is slow by nature, and a profile nudge landing on
 * the same inbox the next morning competes with the one thing we asked for.
 * The meeting itself is Wednesday 2026-09-23, 12:00–13:30 Eastern.
 *
 * It is also the guard this job was missing. Giving a step a sendAfterDays
 * does not mean "five days from now" — it means five days from
 * journey_started_at, and the journeys that exist began in May. Scheduling
 * procurement on 2026-09-21 therefore made it instantly overdue for all 97 of
 * them, which is precisely the instant backlog the note above warns about and
 * precisely what happened.
 *
 * Self-expiring on purpose: no deploy is needed to lift it, and a forgotten
 * flag that silently stops all onboarding mail would be worse than the problem
 * it solves. Delete the constant and this block once it is behind us.
 */
const QUIET_UNTIL = Date.parse("2026-09-24T00:00:00Z");

// ─────────────────────────────────────────────────────────────────────────────
// Types for the DB rows we read
// ─────────────────────────────────────────────────────────────────────────────

interface ProgressRow {
  id: string;
  user_id: string;
  step_key: string;
  /** Already in the SELECT below; carried so a step can address the right side. */
  persona: Persona | null;
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
  /** organizations.type — decides whether a field-backed step is reachable at all. */
  orgType: string | null;
  hasDescription: boolean;
  hasLogo: boolean;
  hasHero: boolean;
  hasContacts: boolean;
  hasContactPhotos: boolean;
  hasFeaturedProduct: boolean;
  hasCatalogueOrLinks: boolean;
  hasBackground: boolean;
  /**
   * Is THIS person named against a buying category at their org?
   *
   * Per-person, not per-org: getMemberSupplierData reads the caller's own
   * contact id out of category_buyers and returns hasAssignments:false when it
   * is absent. So a store can have procurement filled in while this particular
   * reader still opens an empty panel.
   */
  isNamedBuyer: boolean;
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
  /** Absent behaves as the vendor wording — what every step said before this. */
  persona?: Persona | null;
}

/**
 * Is the reader on the vendor side of the network?
 *
 * Needed by `profile_featured_product`, where the two programs keep the same
 * idea in different columns: a partner names a product, a store shows one.
 * Same distinction the org-type gate above makes, from the persona rather than
 * the org row, because the copy is chosen before the org is in hand.
 */
function isVendorProgram(persona: Persona | null | undefined): boolean {
  return persona === "org_admin_partner" || persona === "member_partner";
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

    /**
     * Procurement, from the two ends it is actually filled in from.
     *
     * A store admin sets which categories the store carries and puts a name
     * against each. A buyer claims the ones that are theirs — and that claim
     * CREATES the category on the organisation if it is not there yet
     * (SelfEditModal pushes a new category_buyers entry), so the record is
     * assembled from the people who do the buying rather than guessed downward
     * by one person.
     *
     * The payoff is per-person and immediate: getMemberSupplierData reads the
     * caller's own contact id out of category_buyers and returns
     * hasAssignments:false when there is nothing, which is why the panel on
     * /me is empty for almost everybody. match/profile.ts reads the same
     * field, plus preferred_certifications and sourcing_provinces.
     *
     * ⛔ No counts in this copy. It is evergreen and fires for every store
     * that joins from here on.
     */
    /**
     * The payoff for procurement, and only sent once there is one. The job
     * defers this step until ctx.isNamedBuyer, so by the time this renders the
     * reader has categories and the panel has something in it.
     */
    case "my_suppliers":
      return {
        subject: isReminder ? `Your supplier list, still waiting` : `Your suppliers are matched and waiting`,
        html: nudgeHtml({
          firstName,
          headline: "Built from what you buy.",
          body: `You set your buying categories, so ${orgName} now has a supplier list put together for you: the vendors that match what you actually buy, rather than everyone in the directory.<br><br>It's yours rather than the store's. Somebody else at ${orgName} buying different things sees a different list. Change your categories and it changes with them.<br><br>Worth a look before you next go sourcing.`,
          ctaText: "See my suppliers",
          ctaUrl: `${base}/me`,
          footnote: isReminder ? "The full list exports to a spreadsheet from the Toolkit." : undefined,
        }),
      };

    case "procurement": {
      if (isVendorProgram(opts.persona)) return null; // member-program step only
      const isAdmin = opts.persona === "org_admin_member";
      return isAdmin
        ? {
            subject: isReminder
              ? `Still nobody named against ${orgName}'s categories`
              : `Who buys what at ${orgName}?`,
            html: nudgeHtml({
              firstName,
              headline: "Put a name against each category.",
              body: `Your org page has a Procurement section: the categories ${orgName} carries, and who owns each one.<br><br>Setting it does two things. Vendors looking for the right person at your store find them instead of guessing, and every buyer you name gets their own supplier list built from their own categories rather than the store's.<br><br>You don't have to know it all. Name the ones you're sure of and leave the rest. Each buyer can add and adjust their own from their account, so it isn't a list you have to keep current by yourself.`,
              ctaText: "Set up procurement",
              ctaUrl: orgUrl,
              footnote: "It's also what the curated meetings at the conference are matched on.",
            }),
          }
        : {
            subject: isReminder
              ? `Your supplier list is still waiting on one thing`
              : `What do you buy for ${orgName}?`,
            html: nudgeHtml({
              firstName,
              headline: "Your own supplier list starts here.",
              body: `On your account page, open Edit my info and tick the categories you buy for. The site builds you a supplier list out of them.<br><br>Yours, not the store's. If two of you buy different things, you each get a different list. And it keeps up with you: change what you tick and the list changes with it.<br><br>If a category you buy isn't there yet, add it. What you pick becomes part of ${orgName}'s record, which is how the store's list gets built in the first place.`,
              ctaText: "Set my categories",
              ctaUrl: `${base}/me`,
            }),
          };
    }

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
      if (!isVendorProgram(opts.persona)) {
        return {
          subject: isReminder
            ? `Still nothing on show for ${orgName}`
            : `What would you put in the window?`,
          html: nudgeHtml({
            firstName,
            headline: "Show the network something you're proud of.",
            body: `${orgName}'s page has a space for one product, front and centre over your hero image — and yours is empty.<br><br>It isn't a sales pitch. It's the thing you'd point at if another store walked in: your own branded line, something that only works on your campus, the item people come back for. Whatever best reflects the store.<br><br>One image is all it takes.`,
            ctaText: "Put something on show",
            ctaUrl: orgUrl,
          }),
        };
      }
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

  if (Date.now() < QUIET_UNTIL) {
    result.log.push(
      `quiet period: sending nothing until ${new Date(QUIET_UNTIL).toISOString()} (Town Hall 2026-09-23)`
    );
    return result;
  }

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

  // When did each of these people last hear from us, by any route we record?
  const lastEmailByUser = new Map<string, string>();
  {
    // Previous nudges — read across ALL their rows, not just the pending ones:
    // a step that was sent and has since auto-completed still used up an inbox.
    const { data: nudges } = await createAdminClient()
      .from("user_onboarding_progress")
      .select("user_id, sent_at, last_reminder_sent_at")
      .in("user_id", userIds);
    for (const n of (nudges ?? []) as Array<{ user_id: string; sent_at: string | null; last_reminder_sent_at: string | null }>) {
      for (const stamp of [n.sent_at, n.last_reminder_sent_at]) {
        if (!stamp) continue;
        const seen = lastEmailByUser.get(n.user_id);
        if (!seen || stamp > seen) lastEmailByUser.set(n.user_id, stamp);
      }
    }

    // Campaign sends. message_recipients carries the user_id; the delivery row
    // beside it carries when it actually went.
    const { data: campaignSends } = await createAdminClient()
      .from("message_recipients")
      .select("user_id, message_deliveries(sent_at)")
      .in("user_id", userIds);
    for (const r of (campaignSends ?? []) as Array<{ user_id: string | null; message_deliveries: { sent_at: string | null }[] | { sent_at: string | null } | null }>) {
      if (!r.user_id) continue;
      const rows = Array.isArray(r.message_deliveries) ? r.message_deliveries : r.message_deliveries ? [r.message_deliveries] : [];
      for (const d of rows) {
        if (!d?.sent_at) continue;
        const seen = lastEmailByUser.get(r.user_id);
        if (!seen || d.sent_at > seen) lastEmailByUser.set(r.user_id, d.sent_at);
      }
    }
  }

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
    .select("id, name, slug, province, type, company_description, logo_url, hero_image_url, highlight_product_name, product_overlay_url, catalogue_url, partner_links, banner_url, procurement_info")
    .in("id", orgIds);

  type OrgRow = {
    id: string; name: string; slug: string; province: string | null; type: string | null;
    company_description: string | null; logo_url: string | null; hero_image_url: string | null;
    highlight_product_name: string | null; product_overlay_url: string | null;
    procurement_info: { category_buyers?: { contact_ids?: string[] }[] } | null;
    catalogue_url: string | null; partner_links: unknown; banner_url: string | null;
  };
  const orgById = new Map<string, OrgRow>();
  for (const o of (orgs ?? []) as OrgRow[]) orgById.set(o.id, o);

  // Contact counts + photo check (per org)
  const { data: contacts } = await createAdminClient()
    .from("contacts")
    .select("id, organization_id, profile_picture_url, profile_id")
    .in("organization_id", orgIds);

  const orgHasContacts = new Map<string, boolean>();
  const orgHasPhotos = new Map<string, boolean>();
  // Every contact row a person holds at an org, not one: 39 people hold two at
  // a single org, and either could be the row named against a category.
  const contactIdsByUserOrg = new Map<string, Set<string>>();
  for (const c of (contacts ?? []) as { id: string; organization_id: string; profile_picture_url: string | null; profile_id: string | null }[]) {
    orgHasContacts.set(c.organization_id, true);
    if (c.profile_picture_url) orgHasPhotos.set(c.organization_id, true);
    if (c.profile_id) {
      const key = `${c.profile_id}:${c.organization_id}`;
      const set = contactIdsByUserOrg.get(key) ?? new Set<string>();
      set.add(c.id);
      contactIdsByUserOrg.set(key, set);
    }
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
      orgType: org.type,
      hasDescription: Boolean(org.company_description?.trim()),
      hasLogo: Boolean(org.logo_url),
      hasHero: Boolean(org.hero_image_url),
      hasContacts: orgHasContacts.get(orgId) ?? false,
      hasContactPhotos: orgHasPhotos.get(orgId) ?? false,
      // Two columns, one idea. Partners name a product (`highlight_product_name`,
      // text, on PartnerProfile); stores show one (`product_overlay_url`, an
      // image over the hero, on MemberProfile). Reading only the vendor column
      // made this step permanently incomplete for 73 stores who had done it.
      hasFeaturedProduct:
        org.type === PARTNER_ORG_TYPE
          ? Boolean(org.highlight_product_name?.trim())
          : Boolean(org.product_overlay_url),
      hasCatalogueOrLinks:
        Boolean(org.catalogue_url?.trim()) ||
        (Array.isArray(org.partner_links) && org.partner_links.length > 0),
      hasBackground: Boolean(org.banner_url?.trim()),
      isNamedBuyer: (() => {
        const mine = contactIdsByUserOrg.get(`${userId}:${orgId}`);
        if (!mine || mine.size === 0) return false;
        return (org.procurement_info?.category_buyers ?? []).some((entry) =>
          (entry.contact_ids ?? []).some((id) => mine.has(id))
        );
      })(),
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

      // Nothing to look at yet. my_suppliers renders the vendors matched to
      // THIS person's buying categories, and getMemberSupplierData returns
      // hasAssignments:false when they have none — so the mail would land
      // somebody on an empty panel and spend the one thing it had to spend.
      //
      // Skipped, not completed: they are one procurement save away from being
      // a buyer, and the step should fire then. Leaving the row pending is
      // what makes that happen on a later run.
      if (row.step_key === "my_suppliers" && !ctx.isNamedBuyer) {
        result.skipped++;
        result.log.push(`deferred ${ctx.email} / my_suppliers: no buying categories yet`);
        continue;
      }

      // Unreachable for this org type — the field has no input on their page,
      // so the ask cannot be actioned and the step cannot ever complete.
      if (PARTNER_PAGE_FIELD_STEPS.has(row.step_key) && ctx.orgType !== PARTNER_ORG_TYPE) {
        result.skipped++;
        result.log.push(`unreachable ${ctx.email} / ${row.step_key}: no such field on a ${ctx.orgType ?? "unknown"} page`);
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
      // Anything from us in the last couple of days wins over a nudge. Placed
      // after auto-complete so a quiet person's satisfied steps still close.
      const lastEmail = lastEmailByUser.get(userId);
      if (lastEmail && daysSince(lastEmail) < QUIET_DAYS_AFTER_ANY_EMAIL) {
        result.skipped++;
        result.log.push(
          `quiet ${ctx.email} / ${row.step_key}: heard from us ${daysSince(lastEmail).toFixed(1)}d ago`
        );
        continue;
      }

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
        persona: row.persona,
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
