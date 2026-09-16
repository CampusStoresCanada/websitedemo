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
import { getProgramsConfig } from "@/lib/policy/engine";
import { deriveGlobalPersona } from "./persona";
import { STEPS_BY_PERSONA, type Persona } from "./steps";
import { STEP_SCHEDULE } from "./nudge-schedule";

/**
 * Most one person hears from us in a single run. Journeys go back to 2026-05-26,
 * so any newly-scheduled step is instantly past its sendAfterDays for every
 * existing row — without a cap, switching on four steps would land four emails
 * in one morning. Deterministic order (earliest sendAfterDays first) means the
 * rest simply arrive on following days.
 */
const MAX_SENDS_PER_USER_PER_RUN = 1;

/**
 * Minimum quiet days between two nudges to the same person.
 *
 * The per-run cap above stops four emails landing in one morning, but on a
 * daily cron it still permits one a day forever: a fresh journey has ~11
 * scheduled steps whose sendAfterDays all fall inside the first three weeks, so
 * they simply queue up and drain at one per day. That was tolerable when the
 * only people enrolled had opted in by logging in. It is not tolerable for the
 * 468 people who have never heard from us and are being enrolled cold — eleven
 * consecutive days of mail from an unfamiliar sender is how a domain earns spam
 * complaints, and this one is already carrying 42 hard bounces from August.
 *
 * Two days is the floor. It does not change the order or the content, only the
 * pace: the arc still reads description → logo → hero → contacts, it just takes
 * the time a person would actually give it.
 */
const MIN_DAYS_BETWEEN_SENDS_PER_USER = 2;

/**
 * How many people may be enrolled into a journey in one run.
 *
 * Enrolment is the moment someone's day-0 mail becomes due, so enrolling the
 * whole backlog at once means sending it all at once: 567 people in a single
 * 04:00 run, against a domain whose busiest recent day was about 110 and whose
 * normal is 20–60. A tenfold spike of cold mail into .ca institutional
 * mailboxes is how a sending domain gets filtered, and this one is already
 * carrying 42 hard bounces backfilled in August.
 *
 * At 150 a run the backlog clears in four mornings, every one of them still
 * ahead of the Town Hall, and the domain ramps instead of spiking. Once the
 * backlog is gone this constant never binds again — steady-state enrolment is
 * a handful of new accounts a week.
 */
const MAX_NEW_ENROLMENTS_PER_RUN = 150;

/**
 * Who gets enrolled first while the cap is biting.
 *
 * Org admins lead: they are the ones the Town Hall's own close asks to go and
 * do something ("update your profile this week"), they are the only people who
 * can act on the housekeeping half of the journey, and they are far fewer, so
 * they clear in the first run. Member-role staff follow, and a store's admin
 * having already been in for a couple of days is a better order than the
 * reverse.
 */
const ENROLMENT_PRIORITY: Persona[] = [
  "org_admin_member",
  "org_admin_partner",
  "member_member",
  "member_partner",
];

// ─────────────────────────────────────────────────────────────────────────────
// Types for the DB rows we read
// ─────────────────────────────────────────────────────────────────────────────

interface ProgressRow {
  id: string;
  user_id: string;
  step_key: string;
  /** Already selected by the job's query; carried so the copy can vary by audience. */
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
  /**
   * Who is reading. Most steps are shared by the store and vendor journeys and
   * are written neutrally, but a few describe selling TO members and read as
   * nonsense in a campus store's inbox — see `isSellingToMembers` below.
   * Optional so the copy-preview harness can still render a step without
   * naming an audience; absent behaves as the vendor copy, which is what every
   * one of these steps said before this parameter existed.
   */
  persona?: Persona | null;
}

/**
 * Is this reader a vendor selling into the network, rather than a campus store?
 *
 * Only two scheduled steps need to ask. `profile_featured_product` and
 * `profile_links_docs` sit in BOTH org-admin journeys but were written entirely
 * in a vendor's voice — "whatever you'd point at if someone walked up to your
 * booth", "Members are looking for your range". Because `buildNudgeEmail`
 * switched on `step_key` alone, a campus store admin got the vendor's email
 * verbatim: University of Calgary received "What's the one thing you want
 * members to see?" on 2026-09-11, day 7 of their journey.
 *
 * The fix is per-audience copy rather than dropping the steps from the store
 * journey — a step that silently sends nothing is the exact failure recorded in
 * nudge-schedule.ts, where four directory-critical steps sat unsent for months.
 */
function isSellingToMembers(persona: Persona | null | undefined): boolean {
  return persona !== "org_admin_member" && persona !== "member_member";
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
  const sellsToMembers = isSellingToMembers(opts.persona);

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
      if (!sellsToMembers) {
        return {
          subject: isReminder
            ? `Still nothing featured for ${orgName}`
            : `What is ${orgName} known for?`,
          html: nudgeHtml({
            firstName,
            headline: "Pick one thing to lead with.",
            body: `Your page has a Featured Product slot, and ${orgName}'s is empty. It's the first thing other stores and vendor partners see when they land on your page — your own branded line, something you make on campus, whatever you'd want the network to notice.<br><br>One item. A name and a sentence about it is plenty.`,
            ctaText: "Feature a product",
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
      if (!sellsToMembers) {
        return {
          subject: isReminder
            ? `${orgName}'s links — still missing`
            : `Where should people go next from ${orgName}'s page?`,
          html: nudgeHtml({
            firstName,
            headline: "Point people to your own channels.",
            body: `${orgName} doesn't have a store site or any documents linked yet. Vendor partners and other stores looking you up can see who you are, but not where to go next — your shop, your course-materials page, whatever you'd want them to open.<br><br>A link is enough. It doesn't have to be hosted here.`,
            ctaText: "Add my links",
            ctaUrl: orgUrl,
            footnote: isReminder ? "A link is fine — no upload needed." : undefined,
          }),
        };
      }
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

    // These two are the payoff steps, and until 2026-09-15 they sat at day 14 —
    // behind every housekeeping chore, arriving after most readers had stopped
    // opening. Now days 2 and 4. Written to send somebody looking for a specific
    // person rather than to announce that a directory exists.
    case "network_members":
      return {
        subject: sellsToMembers ? `The stores you should already know` : `Who else is doing your job`,
        html: nudgeHtml({
          firstName,
          headline: sellsToMembers ? "Fifty-two buyers, filterable." : "Somebody here has your job.",
          body: sellsToMembers
            ? `Every campus store on CSC, and you can narrow them the way you'd actually qualify them — by province, by size, by what they run, by what they're mandated to source.<br><br>${opts.orgProvince ? `${opts.orgProvince} alone has several you should know by name.` : "There are stores in every province."} They maintain these pages themselves, which is why this beats any list you could buy.`
            : `Every campus store that's part of CSC, filtered how you'd want: size, province, POS, mandate, services.<br><br>${opts.orgProvince ? `${opts.orgProvince} alone has a handful you'd recognise.` : "Coast to coast, and you'd recognise plenty of them."} Find two or three whose store is genuinely like ${orgName} — that's the whole point. The comparison only means something when you picked who you're compared to.`,
          ctaText: sellsToMembers ? "Browse the members" : "Find stores like yours",
          ctaUrl: `${base}/members`,
        }),
      };

    case "network_partners":
      return {
        subject: sellsToMembers ? `Who else is in your category` : `Who you can actually buy from`,
        html: nudgeHtml({
          firstName,
          headline: sellsToMembers ? "The rest of the floor." : "Suppliers, filtered by what you need.",
          body: sellsToMembers
            ? `Every vendor and supplier active on CSC — including, usefully, the ones members put next to you when they're comparing. Worth knowing who's in your category and how they've described themselves.<br><br>Your own page is in there too. It's worth looking at it the way a member would.`
            : `Every vendor and supplier on CSC, and you can filter them by category, by province, by the certifications you're required to ask for.<br><br>They can already see ${orgName}'s page — this is the other direction. Nobody buys their way up this list; what moves a partner is being chosen, being met, being recommended by someone like you.`,
          ctaText: "Browse partners",
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

    // ── The Town Hall set ────────────────────────────────────────────────────
    // Seven step keys that have sat in the persona lists since they were
    // written with no copy and no schedule entry, so they have never been sent
    // to anyone. They are also, not coincidentally, the steps that differentiate
    // the four personas from each other: strip them out and what remains is the
    // profile-completion arc, which is why every journey read partner-shaped.
    // Authored 2026-09-15 for the Sept 23 Town Hall lead-up.

    case "toolkit_tour": {
      // The door, and the only job it has is to send somebody looking for a
      // person. Not a feature tour: the tools are worth nothing to a reader who
      // has not yet met anyone through them, and "there's nothing for you to do
      // here" — an earlier draft of the member-role copy — reads as "this isn't
      // for you". Housekeeping comes at day 10+, once there is a reason to care.
      const bodyByPersona: Record<string, string> = {
        org_admin_member: `Fifty-two campus stores are in here, across ten provinces. You can go through them by size, by province, by what POS they run, by whether they're mandated the way you are — and find the two or three people whose job is genuinely the same as yours.<br><br>That's the part worth your morning. There's housekeeping on your page too, and it can wait; it's only worth doing once you've seen what it feeds.`,
        org_admin_partner: `Fifty-two campus stores are in here — what they run, what they carry, who does the buying, which of them are actively looking. Go and find the ones you should already know.<br><br>Your own listing needs a look at some point too, and we'll come back to it. It matters because of who's on the other side of it, not for its own sake.`,
        member_member: `Go and find your people. Fifty-two campus stores, ten provinces, and you can filter them down to the ones that are actually like yours — same size, same POS, same mandate, same headache you had last week.<br><br>Somebody in there has already solved the thing you're stuck on. That's the entire reason this exists.`,
        member_partner: `Go and find your people. Fifty-two campus stores — who they are, what they carry, who does the buying, which of them have open RFPs right now.<br><br>It isn't a lead list. It's maintained by the stores themselves, which is why it's worth more than one.`,
      };
      const body = bodyByPersona[opts.persona ?? ""] ?? bodyByPersona.member_member;
      return {
        subject: isReminder ? `Still worth a look: who else is on here` : `Go find your people`,
        html: nudgeHtml({
          firstName,
          headline: "You already have an account.",
          body: `${body}<br><br>We built this, loaded everyone in, and never actually told you. That's on us, and this is the fix.`,
          // Both sides land on the member directory: for a store it's peers, for
          // a vendor it's the market. Same page, different reason to open it.
          ctaText: sellsToMembers ? "Browse the members" : "Find stores like yours",
          ctaUrl: `${base}/members`,
          footnote: `Never signed in? About twenty seconds: go to ${base}/forgot-password, enter this address, and you'll get a six-digit code. No link to lose.`,
        }),
      };
    }

    case "view_org_page":
      // Member-role only. The in-app callout for this step is about the Toolkit
      // — the + button that follows you across every page on the network.
      return {
        subject: sellsToMembers ? `This is your company on the network` : `This site works a little differently`,
        html: nudgeHtml({
          firstName,
          headline: sellsToMembers ? "This is what campus stores see." : "Everything lives in one button.",
          body: sellsToMembers
            ? `${orgName}'s page is what a campus store sees when they look you up — who you are, what you carry, who to call.<br><br>The + button at the bottom right is the Toolkit. It follows you onto every page on the network and is how you do anything: save something, ask about it, compare it, get in touch.`
            : `Whatever you need is in the Toolkit — the + button at the bottom right. It follows you everywhere on the network rather than living on one screen, so the same actions are there whether you're looking at a supplier, a peer institution or an event.<br><br>Worth two minutes of poking at it. Nothing in there commits you to anything.`,
          ctaText: sellsToMembers ? "See our page" : "Show me",
          ctaUrl: orgUrl,
        }),
      };

    case "public_contact_email":
      // Org admins only. Deliberately blunt: this one is irreversible in print.
      return {
        subject: isReminder
          ? `${orgName}'s public email — still unset`
          : `Set ${orgName}'s public email`,
        html: nudgeHtml({
          firstName,
          headline: "This one goes on paper.",
          body: `${orgName} needs a public contact address — it's printed in the directory that ships to every member institution, and it's readable by anyone.<br><br>Use a shared inbox your team watches, never a personal address. Whoever owns it can't take it back once it's on paper, and people leave.`,
          ctaText: "Set the public email",
          ctaUrl: orgUrl,
          footnote: isReminder ? "The directory goes to press this autumn — after that it's fixed for a year." : undefined,
        }),
      };

    case "procurement":
      // Two genuinely different asks. The admin sets the categories the store
      // carries and assigns a buyer to each; each buyer then maintains their own
      // assignments from /me. Same step key, opposite ends of the same job.
      if (sellsToMembers) return null; // member-program personas only
      return opts.persona === "org_admin_member"
        ? {
            subject: isReminder
              ? `${orgName}'s procurement details — still empty`
              : `Which categories, and who buys them`,
            html: nudgeHtml({
              firstName,
              headline: "The thinnest data we hold.",
              body: `Your org page has a Procurement section, and 14 of 79 member stores have filled in any of it. Everyone else is matched to partners on province and category alone, which is as coarse as it sounds.<br><br>Two parts: set which categories ${orgName} carries, then assign a buyer to each one. Those buyers can keep their own assignments current from their own account, so it isn't yours to maintain alone.<br><br>Five fields in total — categories and buyers, certifications you require, provinces you source from, services you run, and anything that doesn't fit. You control who sees each one.`,
              ctaText: "Set up procurement",
              ctaUrl: orgUrl,
              footnote: "A declaration like this outweighs a click several times over, and February's curated meetings are matched on it.",
            }),
          }
        : {
            subject: isReminder
              ? `Your buying categories — still unconfirmed`
              : `You're the buyer for something`,
            html: nudgeHtml({
              firstName,
              headline: "Nobody knows your categories better than you.",
              body: `${orgName}'s admin can assign categories to the people who actually buy them. If that's you, you can manage your own assignments — nobody else has to do it on your behalf.<br><br>This is the most valuable thing you can tell the site about yourself, and it's also not permanent. What you buy this year isn't what you'll buy in three, and the weight we give it fades on its own. You're never held to an old answer.`,
              ctaText: "Manage my categories",
              ctaUrl: `${base}/me#edit-procurement`,
            }),
          };

    case "my_suppliers":
      // Downstream of procurement — renders empty without categories, which is
      // why its schedule entry sits well after the procurement step's.
      return {
        subject: isReminder ? `Your supplier list is still waiting` : `The suppliers who actually serve stores like yours`,
        html: nudgeHtml({
          firstName,
          headline: "Matched to what you buy.",
          body: `Once your categories are set, the site builds you a supplier list — vendors matched to what you actually buy rather than whoever markets hardest.<br><br>There's no SEO here, and a partner can't buy their way up your list. What moves them is what the community does: who gets picked when there's a real choice, who gets vouched for, who turns up.`,
          ctaText: "See my suppliers",
          ctaUrl: `${orgUrl}#my-suppliers`,
          footnote: isReminder ? "If it looks thin, it's usually because your categories aren't set yet." : undefined,
        }),
      };

    case "my_market":
      return {
        subject: isReminder ? `Your market, still worth a look` : `The member stores matched to what you sell`,
        html: nudgeHtml({
          firstName,
          headline: "Who's actually on the other side.",
          body: `The member stores matched to ${orgName}'s categories — who they are, what they carry, which of them buy what you sell.<br><br>It isn't a lead list. It's maintained by the stores themselves, and what surfaces you to them is what people do: being chosen when there was a real choice, being met, being recommended. An opened email counts for a fraction of a genuine pick, and that's deliberate.`,
          ctaText: "See my market",
          ctaUrl: `${orgUrl}#your-market`,
        }),
      };

    case "opening_rfp":
      return {
        subject: isReminder ? `Running an RFP this term?` : `When you're ready to buy`,
        html: nudgeHtml({
          firstName,
          headline: "Say what you need out loud.",
          body: `When ${orgName} is running an RFP, you can post it here and the right vendors are notified automatically — matched off your categories rather than a distribution list you have to maintain.<br><br>It's the most direct version of the whole idea: you say what you need, and the people who can actually serve it find out.`,
          ctaText: "See my RFPs",
          ctaUrl: orgUrl,
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
// Enrolment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Give every entitled member of a real org a journey, whether or not they have ever logged in.
 *
 * `user_onboarding_progress` rows were previously only ever written by
 * `initJourney()`, which calls `requireAuthenticated()` — so a row existed only
 * after that person signed in. This job then started from those rows, which made
 * "has logged in" an unstated precondition for receiving any nudge at all. The
 * effect was self-sealing: the nudges are the thing that brings a partner in, and
 * the people who most needed them were the only ones who could never get one. As
 * of 2026-09-11 that was 41 of 89 Vendor Partner org admins — Bookware among
 * them, a paid partner who had heard nothing but a renewal notice.
 *
 * So enrolment resolves from `user_organizations` (a provisioned account, which
 * every invited admin has) and the progress table goes back to being what its
 * name says: a record of what we have sent, not a gate on who may be sent to.
 *
 * Idempotent by the same `(user_id, persona, step_key)` conflict key
 * `initJourney()` upserts on, so a person who signs up in the app and a person
 * enrolled here converge on one journey rather than two.
 *
 * `journey_started_at` is now, not the account's creation date: every step is
 * scheduled as an offset from it, so backdating would make the whole arc
 * instantly overdue and drip a months-old backlog one mail per day
 * (MAX_SENDS_PER_USER_PER_RUN) at people who have never heard from us. Starting
 * today gives them the arc as written — first nudge two days out.
 */
async function ensureJourneys(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  result: NudgeJobResult,
): Promise<void> {
  const admin = createAdminClient();

  // Two plain queries rather than an embed: user_organizations has no FK
  // PostgREST can auto-detect to organizations here, the same reason
  // lib/comms/audience.ts's resolveOrgAdmins splits its lookup in two.
  // Both roles, not just org_admin: the four personas in steps.ts exist because
  // a store employee and a vendor employee need to hear different things from
  // each other and from their admins. Enrolling only admins would leave the
  // largest two audiences (member_member, member_partner) exactly as invisible
  // as the journey gate left everyone.
  const [{ data: memberships, error: mErr }, programs] = await Promise.all([
    admin
      .from("user_organizations")
      .select("user_id, organization_id, role")
      .eq("status", "active"),
    getProgramsConfig(),
  ]);

  if (mErr) {
    result.errors.push(`enrolment: load org admins: ${mErr.message}`);
    return;
  }
  const rows = (memberships ?? []) as Array<{ user_id: string; organization_id: string; role: string }>;
  if (rows.length === 0) return;

  const { data: orgs, error: oErr } = await admin
    .from("organizations")
    .select("id, type, is_test, archived_at, membership_status")
    .in("id", [...new Set(rows.map((r) => r.organization_id))]);

  if (oErr) {
    result.errors.push(`enrolment: load orgs: ${oErr.message}`);
    return;
  }

  type OrgFacts = {
    id: string; type: string | null; is_test: boolean | null;
    archived_at: string | null; membership_status: string | null;
  };
  const orgById = new Map<string, OrgFacts>();
  for (const o of (orgs ?? []) as OrgFacts[]) orgById.set(o.id, o);

  /**
   * Entitlement, not just existence. `archived_at` only says the record was
   * filed away; `membership_status` is what says whether these people are
   * still ours to write to — the trap behind `active_organizations`, whose
   * name promises the first and delivers the second.
   *
   * `grace` counts: the renewal is outstanding but access has not been cut,
   * and an org mid-renewal is exactly who a "come back and use this" mail is
   * for. `canceled` does not — 109 people sit under canceled orgs today, and
   * inviting them to sign in would be inviting them into something they no
   * longer have.
   */
  const ENTITLED = new Set(["active", "reactivated", "grace"]);

  // A test org must never receive real mail, and an archived one is gone —
  // same two exclusions resolveOrgAdmins applies before any campaign send.
  const factsByUser = new Map<string, Array<{ orgType: string | null | undefined; role: string }>>();
  for (const row of rows) {
    const org = orgById.get(row.organization_id);
    if (!org || org.is_test || org.archived_at) continue;
    if (!ENTITLED.has(org.membership_status ?? "")) continue;
    const arr = factsByUser.get(row.user_id) ?? [];
    arr.push({ orgType: org.type, role: row.role });
    factsByUser.set(row.user_id, arr);
  }

  // One persona per person, resolved by the same precedence initJourney() uses,
  // so somebody who admins both a store and a vendor gets one journey and not two.
  const personaByUser = new Map<string, Persona>();
  for (const [userId, facts] of factsByUser) {
    const persona = deriveGlobalPersona(facts, programs);
    if (persona) personaByUser.set(userId, persona);
  }
  if (personaByUser.size === 0) return;

  // Only people with no journey at all are candidates — everyone else is either
  // mid-arc or finished, and re-upserting their rows every morning would be a
  // few thousand writes a day to accomplish nothing.
  const { data: existing, error: eErr } = await admin
    .from("user_onboarding_progress")
    .select("user_id")
    .in("user_id", [...personaByUser.keys()]);

  if (eErr) {
    result.errors.push(`enrolment: load existing journeys: ${eErr.message}`);
    return;
  }
  const enrolled = new Set((existing ?? []).map((r) => (r as { user_id: string }).user_id));

  const candidates = [...personaByUser.entries()]
    .filter(([userId]) => !enrolled.has(userId))
    .sort(
      ([, a], [, b]) => ENROLMENT_PRIORITY.indexOf(a) - ENROLMENT_PRIORITY.indexOf(b)
    );

  if (candidates.length === 0) return;

  const batch = candidates.slice(0, MAX_NEW_ENROLMENTS_PER_RUN);
  const now = new Date().toISOString();
  const pending: Array<{ user_id: string; persona: Persona; step_key: string; journey_started_at: string }> = [];
  for (const [userId, persona] of batch) {
    for (const stepKey of STEPS_BY_PERSONA[persona]) {
      pending.push({ user_id: userId, persona, step_key: stepKey, journey_started_at: now });
    }
  }

  if (pending.length === 0) return;

  const { error: upsertErr } = await db
    .from("user_onboarding_progress")
    .upsert(pending, { onConflict: "user_id,persona,step_key", ignoreDuplicates: true });

  if (upsertErr) {
    result.errors.push(`enrolment: upsert journeys: ${upsertErr.message}`);
    return;
  }

  const remaining = candidates.length - batch.length;
  result.log.push(
    `enrolment: ${batch.length} enrolled (${pending.length} step rows)` +
      (remaining > 0 ? `, ${remaining} waiting for a later run` : "")
  );
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

  // ── 1b. Enrol every org admin who doesn't have a journey yet ──────────────
  // Runs before the fetch below so a first-time enrollee is picked up by the
  // same pass, rather than waiting a day for the next one.
  await ensureJourneys(db, result);

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

  // When did each person last hear from this job at all? Read across ALL their
  // rows, not just the pending ones above: a step that was sent and has since
  // been auto-completed still occupied their inbox, and pacing is about the
  // inbox rather than about the journey's state.
  const lastTouchByUser = new Map<string, string>();
  {
    const { data: touches } = await createAdminClient()
      .from("user_onboarding_progress")
      .select("user_id, sent_at, last_reminder_sent_at")
      .in("user_id", userIds);
    for (const t of (touches ?? []) as Array<{ user_id: string; sent_at: string | null; last_reminder_sent_at: string | null }>) {
      for (const stamp of [t.sent_at, t.last_reminder_sent_at]) {
        if (!stamp) continue;
        const current = lastTouchByUser.get(t.user_id);
        if (!current || stamp > current) lastTouchByUser.set(t.user_id, stamp);
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

      // Quiet period since their last nudge — same reasoning as the cap, across
      // runs rather than within one. Placed after auto-complete for the same
      // reason: a paced user's data-satisfied steps should still close.
      const lastTouch = lastTouchByUser.get(userId);
      if (lastTouch && daysSince(lastTouch) < MIN_DAYS_BETWEEN_SENDS_PER_USER) {
        result.skipped++;
        result.log.push(`paced ${ctx.email} / ${row.step_key}: nudged ${daysSince(lastTouch).toFixed(1)}d ago`);
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
