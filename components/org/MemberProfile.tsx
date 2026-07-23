"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { BrandColor, Benchmarking } from "@/lib/types/db";
import type { ProcurementInfo } from "@/lib/types/procurement";
import type { RFPWithContext } from "@/lib/types/rfp";
import RFPsSection from "@/components/rfps/RFPsSection";
import type { SupplierData } from "@/lib/actions/member-suppliers";
import MemberSupplierPanel from "@/components/org/MemberSupplierPanel";
import type { BenchmarkingWithOrg } from "@/lib/data";
import type { VisibleOrganization, VisibleContact } from "@/lib/visibility/data";
import type { ViewerLevel } from "@/lib/visibility/defaults";
import ColorizedImage from "@/components/ui/ColorizedImage";
import { ProtectedSection } from "@/components/ui/GreyBlur";
import BlurredField from "@/components/ui/BlurredField";
import BenchmarkingDetails from "./BenchmarkingDetails";
import BenchmarkingComparison from "./BenchmarkingComparison";
import PartnerViewOfMember from "./PartnerViewOfMember";
import EditableProcurementSection from "./EditableProcurementSection";
import ContactEditModal from "./ContactEditModal";
import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToolkit } from "@/components/ui/Toolkit";
import { allocateSeat, deallocateSeat, addConferenceAttendee } from "@/lib/actions/conference-entity-commerce";
import { addOfferToCart } from "@/lib/actions/conference-commerce";
import { dispatchConferenceCartUpdated } from "@/lib/conference/cart-events";
import { formatCents } from "@/lib/utils";
import OfferCard from "@/components/conference/OfferCard";
import HeldOfferCard from "@/components/conference/HeldOfferCard";
import type { AssignableEntityColumn } from "@/app/org/[slug]/page";
import type { ConferenceOffer } from "@/lib/actions/conference-entities";
import { updateOrgProfileVisibilitySettings, setContactHidden } from "@/lib/actions/user-management";
import { fieldProps } from "@/lib/editable-fields";
import { TierIconPreview } from "@/components/sponsorship/SponsorTierBadge";
import type { TierIcon } from "@/lib/sponsorship/types";
import RenewMembershipCard from "@/components/org/RenewMembershipCard";

interface SponsorTierInfo {
  name: string; slug: string; color: string; icon: TierIcon | null;
}

type OrgConferencePersonInfo = {
  personId: string;
  badgeStatus: string;
  checkedInAt: string | null;
};

interface MemberProfileProps {
  organization: VisibleOrganization;
  sponsorTier?: SponsorTierInfo | null;
  contacts: VisibleContact[];
  brandColors: BrandColor[];
  benchmarking: Benchmarking | null;
  allBenchmarking: BenchmarkingWithOrg[];
  viewerLevel: ViewerLevel;
  conferenceAttendance: Array<{
    id: string;
    conferenceId: string;
    conferenceName: string;
    conferenceYear: number;
    conferenceEditionCode: string;
    conferenceStartDate: string | null;
    conferenceStatus: string;
    organizationId: string;
    sourceType: string;
    sourceId: string;
    personKind: string;
    displayName: string | null;
    contactEmail: string | null;
    userId: string | null;
    assignmentStatus: string;
    badgeStatus: string;
    checkedInAt: string | null;
  }>;
  orgAssignableUsers: Array<{
    userId: string;
    displayName: string | null;
    email: string | null;
    role: string;
  }>;
  assignableEntities: AssignableEntityColumn[];
  buyableExtras: ConferenceOffer[];
  currentConferenceId: string | null;
  /** Whether currentConferenceId is actually public-facing (not a draft) — computed
   *  server-side from the conference itself, not from conferenceAttendance (which can be
   *  empty for an org that holds seats but hasn't assigned anyone yet). */
  currentConferenceIsPublic: boolean;
  initialRFPs?: RFPWithContext[];
  memberSuppliers?: SupplierData | null;
  /** Whether this org is within its admin-configured renewal window (renewal.reminder_days) — computed server-side, gates the Renew Now card. */
  renewalWindowOpen?: boolean;
}

export default function MemberProfile({
  organization,
  contacts,
  brandColors,
  benchmarking,
  allBenchmarking,
  viewerLevel,
  conferenceAttendance,
  orgAssignableUsers,
  assignableEntities,
  buyableExtras,
  currentConferenceId,
  currentConferenceIsPublic,
  sponsorTier,
  initialRFPs = [],
  memberSuppliers = null,
  renewalWindowOpen = false,
}: MemberProfileProps) {
  // buyableExtras now includes offers the org already holds seats of (see
  // app/org/[slug]/page.tsx) — this looks up which ones, so those render as
  // HeldOfferCard (holdings-aware) instead of the plain buy-only OfferCard.
  // Offer id and entity id are the same id, confirmed against real data.
  const heldEntityById = new Map(assignableEntities.map((e) => [e.entityId, e]));
  const normalize = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
  const router = useRouter();
  const { permissionState, organizations, user } = useAuth();
  const userEmail = user?.email?.toLowerCase() ?? null;
  // Members can click their own contact entry to edit visibility
  function isOwnContact(contact: VisibleContact): boolean {
    if (!userEmail) return false;
    const contactEmail = ((contact.work_email || contact.email) as string | null)?.toLowerCase();
    return !!contactEmail && contactEmail === userEmail;
  }
  const { editMode, canEditOrg } = useToolkit();
  const [savingContactId, setSavingContactId] = useState<string | null>(null);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const rawPrimaryColor = brandColors[0]?.hex || "#EE2A2E";
  const primaryColor = rawPrimaryColor.startsWith("#") ? rawPrimaryColor : `#${rawPrimaryColor}`;
  const heroImage = organization.hero_image_url ?? null;
  const backgroundImage = organization.banner_url ?? null;

  // Check if current user can edit THIS organization
  const canEditThisOrg = canEditOrg(organization.id);

  // Visibility flag local state (optimistic — synced to DB on toggle)
  const [showContacts, setShowContacts] = useState(organization.show_contacts ?? true);
  const [showBrandColors, setShowBrandColors] = useState(organization.show_brand_colors ?? true);
  const [showInBenchmarking, setShowInBenchmarking] = useState(organization.show_in_benchmarking ?? true);
  const [showPrimaryContact, setShowPrimaryContact] = useState(organization.show_primary_contact ?? true);
  const [showStoreInfo, setShowStoreInfo] = useState(organization.show_store_information ?? true);
  const [, startVisibilityTransition] = useTransition();

  // Per-contact hidden state — keyed by contact.id. Overrides the DB value optimistically.
  const [contactHiddenOverrides, setContactHiddenOverrides] = useState<Record<string, boolean>>({});
  // Contact being edited in the edit modal (null = closed)
  const [editingContact, setEditingContact] = useState<VisibleContact | null>(null);
  // Lifted procurement state — shared between EditableProcurementSection and ContactEditModal
  const [procurementInfo, setProcurementInfo] = useState<ProcurementInfo | undefined>(
    (organization as any).procurement_info ?? undefined
  );
  const isContactHidden = (contact: VisibleContact) =>
    contact.id in contactHiddenOverrides ? contactHiddenOverrides[contact.id] : (contact.hidden ?? false);

  async function handleToggleContactHidden(contact: VisibleContact) {
    const current = isContactHidden(contact);
    const next = !current;
    // Optimistic update
    setContactHiddenOverrides((prev) => ({ ...prev, [contact.id]: next }));
    const result = await setContactHidden(organization.id, contact.id, next);
    if (!result.success) {
      // Revert
      setContactHiddenOverrides((prev) => ({ ...prev, [contact.id]: current }));
    } else {
      window.dispatchEvent(new CustomEvent("csc:field-updated", {
        detail: { table: "contacts", column: "hidden", entityId: contact.id },
      }));
    }
  }

  // Viewer is privileged if they can edit this org (they always see everything)
  const isPrivilegedViewer = canEditThisOrg ||
    viewerLevel === "org_admin" || viewerLevel === "admin" || viewerLevel === "super_admin";

  type VisibilityFlag = "contacts" | "brandColors" | "benchmarking" | "primaryContact" | "storeInfo";

  async function toggleVisibility(flag: VisibilityFlag) {
    const next = {
      contacts: showContacts,
      brandColors: showBrandColors,
      benchmarking: showInBenchmarking,
      primaryContact: showPrimaryContact,
      storeInfo: showStoreInfo,
    };
    next[flag] = !next[flag];

    // Optimistic update
    if (flag === "contacts") setShowContacts(next.contacts);
    if (flag === "brandColors") setShowBrandColors(next.brandColors);
    if (flag === "benchmarking") setShowInBenchmarking(next.benchmarking);
    if (flag === "primaryContact") setShowPrimaryContact(next.primaryContact);
    if (flag === "storeInfo") setShowStoreInfo(next.storeInfo);

    const result = await updateOrgProfileVisibilitySettings(organization.id, {
      showContacts: next.contacts,
      showBrandColors: next.brandColors,
      showInBenchmarking: next.benchmarking,
      showPrimaryContact: next.primaryContact,
      showStoreInformation: next.storeInfo,
    });

    if (!result.success) {
      // Revert on failure
      if (flag === "contacts") setShowContacts(!next.contacts);
      if (flag === "brandColors") setShowBrandColors(!next.brandColors);
      if (flag === "benchmarking") setShowInBenchmarking(!next.benchmarking);
      if (flag === "primaryContact") setShowPrimaryContact(!next.primaryContact);
      if (flag === "storeInfo") setShowStoreInfo(!next.storeInfo);
    } else {
      startVisibilityTransition(() => router.refresh());
    }
  }

  // Helper: inline pill toggle button shown in edit mode
  function VisEye({ flag, value, label }: { flag: VisibilityFlag; value: boolean; label: string }) {
    return (
      <button
        onClick={() => toggleVisibility(flag)}
        title={value ? `Visible to the community — click to hide` : `Hidden from the community — click to show`}
        className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors ${value ? "border-emerald-300 text-emerald-600 hover:bg-emerald-50" : "border-amber-300 text-amber-600 bg-amber-50 hover:bg-amber-100"}`}
      >
        {value ? (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        ) : (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
        )}
        {label}
      </button>
    );
  }
  const canEditConferenceAttendance =
    editMode &&
    (canEditThisOrg || permissionState === "admin" || permissionState === "super_admin");

  // Partners see procurement info instead of benchmarking
  const isPartner = permissionState === "partner";

  // Check if user is org_admin for THIS specific organization (can edit procurement info)
  const isOrgAdminForThisOrg = organizations.some(
    (uo) => uo.organization.id === organization.id && uo.role === "org_admin"
  );
  // Any member of this org sees their own page in full
  const isOwnOrgPage = organizations.some(
    (uo) => uo.organization.id === organization.id
  );

  // "View as Partner" toggle — org admins, admins, and super admins
  const isAdmin = permissionState === "admin" || permissionState === "super_admin";
  const canViewAsPartner = isOrgAdminForThisOrg || isAdmin;
  const [partnerViewMode, setPartnerViewMode] = useState(false);

  // ---------------------------------------------------------------------------
  // Helpers for rendering pre-masked contact fields
  // ---------------------------------------------------------------------------

  /** Check if a string looks like a masked teaser (initials, domain-only, etc.) */
  const isMaskedValue = (value: string): boolean => {
    // Masked initials: "J. D." pattern
    if (/^[A-Z]\.\s[A-Z]\.$/.test(value)) return true;
    if (/^([A-Z]\.\s?)+$/.test(value.trim())) return true;
    // Masked email domain: starts with @
    if (value.startsWith("@")) return true;
    // Masked phone: contains bullet chars
    if (value.includes("•")) return true;
    return false;
  };

  /** Render a contact field (email or phone) that may be masked, null, or full */
  const renderContactField = (
    primary: string | null | undefined,
    fallback: string | null | undefined,
    type: "email" | "phone"
  ) => {
    const value = (primary || fallback) as string | null;
    if (!value) return <BlurredField placeholderWidth={type === "email" ? 20 : 12} />;
    if (isMaskedValue(value)) return <BlurredField maskedValue={value} />;
    // Full value — render as clickable link
    if (type === "email") {
      return (
        <a href={`mailto:${value}`} className="hover:text-[#1A1A1A] transition-colors">
          {value}
        </a>
      );
    }
    return (
      <a href={`tel:${value}`} className="hover:text-[#1A1A1A] transition-colors">
        {value}
      </a>
    );
  };

  /** Render an org-level field (email/phone) that may be masked or null */
  const renderOrgField = (
    value: string | null | undefined,
    type: "email" | "phone"
  ) => {
    const v = value as string | null;
    if (!v) return "—";
    if (isMaskedValue(v)) return <BlurredField maskedValue={v} />;
    if (type === "email") {
      return (
        <a href={`mailto:${v}`} className="hover:text-[#1A1A1A] transition-colors">{v}</a>
      );
    }
    return (
      <a href={`tel:${v}`} className="hover:text-[#1A1A1A] transition-colors">{v}</a>
    );
  };

  // Only show conference columns when there's a public-facing conference.
  // Draft conferences are internal-only and shouldn't surface to org admins.
  // Computed server-side from currentConferenceId itself — deriving this from
  // conferenceAttendance would stay false forever for an org that holds seats
  // but hasn't assigned anyone yet (conferenceAttendance is empty until then).
  // CSC admins/super_admins can still see it while in draft — they're the
  // ones testing a conference before it goes public, and need to be able to
  // assign seats bought against it (e.g. via dev-checkout) to verify the flow.
  const isCscAdmin = viewerLevel === "admin" || viewerLevel === "super_admin";
  const hasPublicConference = currentConferenceIsPublic || isCscAdmin;

  // Which conference_people row (if any) represents each contact, scoped to
  // the current conference — reused for both "are they seated" lookups and
  // rendering their already-fetched badge/check-in status.
  const personIndex = useMemo(() => {
    const rows = conferenceAttendance.filter(
      (row) => row.conferenceId === currentConferenceId && row.assignmentStatus !== "canceled"
    );
    const byUserId = new Map<string, OrgConferencePersonInfo>();
    const byEmail = new Map<string, OrgConferencePersonInfo>();
    const byName = new Map<string, OrgConferencePersonInfo>();
    for (const row of rows) {
      const entry: OrgConferencePersonInfo = {
        personId: row.id,
        badgeStatus: row.badgeStatus,
        checkedInAt: row.checkedInAt,
      };
      if (row.userId) byUserId.set(row.userId, entry);
      const email = normalize(row.contactEmail);
      if (email && !byEmail.has(email)) byEmail.set(email, entry);
      const name = normalize(row.displayName);
      if (name && !byName.has(name)) byName.set(name, entry);
    }
    return { byUserId, byEmail, byName };
  }, [conferenceAttendance, currentConferenceId]);

  const resolveOrgUserForContact = (contact: VisibleContact) => {
    const directUserId = ((contact as unknown as { user_id?: string | null }).user_id ?? "").trim();
    if (directUserId) return { userId: directUserId };

    const contactEmail = normalize((contact.work_email ?? contact.email ?? "").toString());
    if (contactEmail) {
      const matched = orgAssignableUsers.find(
        (orgUser) => normalize(orgUser.email) === contactEmail
      );
      if (matched) return { userId: matched.userId };
    }

    const contactName = normalize((contact.name ?? "").toString());
    if (!contactName) return null;
    const matchedByName = orgAssignableUsers.find(
      (orgUser) => normalize(orgUser.displayName) === contactName
    );
    return matchedByName ? { userId: matchedByName.userId } : null;
  };

  /** Find this contact's conference_people row for the current conference, if one exists. */
  const findPersonForContact = (contact: VisibleContact): OrgConferencePersonInfo | null => {
    const orgUser = resolveOrgUserForContact(contact);
    const contactEmail = normalize((contact.work_email ?? contact.email ?? "").toString());
    const contactName = normalize((contact.name ?? "").toString());
    return (
      (orgUser ? personIndex.byUserId.get(orgUser.userId) : undefined) ||
      (contactEmail ? personIndex.byEmail.get(contactEmail) : undefined) ||
      (contactName ? personIndex.byName.get(contactName) : undefined) ||
      null
    );
  };

  const handleEntityToggle = async (
    contact: VisibleContact,
    entity: AssignableEntityColumn,
    checked: boolean
  ) => {
    if (!canEditConferenceAttendance || !currentConferenceId) return;
    const busyKey = `${contact.id}:${entity.entityId}`;
    setSavingContactId(busyKey);
    setAttendanceError(null);
    try {
      const person = findPersonForContact(contact);
      const existingSeat = person ? entity.seats.find((s) => s.holderPersonId === person.personId) : undefined;

      if (checked) {
        if (existingSeat) return;

        const freeSeat = entity.seats.find((s) => !s.holderPersonId);
        if (!freeSeat) {
          if (!entity.overageOffer || entity.overageOffer.soldOut || !entity.overageOffer.eligible) {
            setAttendanceError(`No additional ${entity.name} is available to purchase right now.`);
            return;
          }
          const confirmed = window.confirm(
            `This will add 1 more ${entity.name} to your cart for ${formatCents(entity.overageOffer.unitPriceCents)} — continue?`
          );
          if (!confirmed) return;
          const attendeeName = (contact.name ?? "").toString().trim() || undefined;
          const attendeeEmail =
            ((contact.work_email ?? contact.email ?? "") as string).toString().trim() || null;
          const cartResult = await addOfferToCart({
            conferenceId: currentConferenceId,
            organizationId: organization.id,
            offerEntityId: entity.entityId,
            quantity: 1,
            attendees: attendeeName ? [{ name: attendeeName, email: attendeeEmail }] : undefined,
          });
          if (!cartResult.success) {
            setAttendanceError(cartResult.error ?? "Failed to add to cart.");
            return;
          }
          dispatchConferenceCartUpdated(organization.id);
          setAttendanceError(
            attendeeName
              ? `Added ${entity.name} to your cart for ${contact.name} — check out to finish assigning it.`
              : `Added ${entity.name} to your cart — check out, then come back to assign it.`
          );
          return;
        }

        let personId = person?.personId ?? null;
        if (!personId) {
          const name = (contact.name ?? "").toString().trim();
          if (!name) {
            setAttendanceError("This contact needs a name before they can be assigned.");
            return;
          }
          const email = ((contact.work_email ?? contact.email ?? "") as string).toString().trim() || null;
          const added = await addConferenceAttendee(currentConferenceId, organization.id, {
            displayName: name,
            contactEmail: email,
          });
          if (!added.success) {
            setAttendanceError(added.error ?? "Failed to add attendee.");
            return;
          }
          personId = added.data.id;
        }

        const result = await allocateSeat(freeSeat.id, personId);
        if (!result.success) {
          setAttendanceError(result.error ?? "Failed to assign seat.");
          return;
        }
        if (result.data.warning) setAttendanceError(result.data.warning);
      } else {
        if (!existingSeat) return;
        const result = await deallocateSeat(existingSeat.id);
        if (!result.success) {
          setAttendanceError(result.error ?? "Failed to remove assignment.");
          return;
        }
      }
      router.refresh();
    } finally {
      setSavingContactId(null);
    }
  };

  const getEntityAttendanceCell = (contact: VisibleContact, entity: AssignableEntityColumn) => {
    const person = findPersonForContact(contact);
    const checked = Boolean(person && entity.seats.some((s) => s.holderPersonId === person.personId));
    const busyKey = `${contact.id}:${entity.entityId}`;
    const disabled = !canEditConferenceAttendance || !currentConferenceId || savingContactId === busyKey;
    return { checked, disabled };
  };

  return (
    <div className="min-h-screen bg-[#EEEEF0] font-[family-name:var(--font-raleway)]" data-org-id={organization.id}>
      {/* Desktop Layout — flex row; hero panel sticky until contacts end */}
      <div className="hidden lg:flex">

        {/* Left visual panel — sticky, viewport height, releases naturally after Zone 1 */}
        <div className="sticky top-0 h-screen flex-shrink-0 relative overflow-hidden" style={{ width: '51.61vw' }}>

        {/* Background image layer — fills the left panel behind everything */}
        <div
          className="absolute inset-0 overflow-hidden group"
          data-onboarding="profile_background"
          {...fieldProps("organizations", "banner_url", organization.id, organization.id)}
        >
          {backgroundImage ? (
            <Image
              src={backgroundImage}
              alt=""
              fill
              className="object-cover object-center"
              unoptimized
            />
          ) : (
            <div className="w-full h-full bg-[#EEEEF0]" />
          )}
          {editMode && canEditThisOrg && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer">
              <div className="bg-white/90 rounded-full p-3 shadow-lg">
                <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                </svg>
              </div>
              <span className="absolute bottom-4 text-white text-sm font-medium drop-shadow">
                {backgroundImage ? "Change background" : "Add background image"}
              </span>
            </div>
          )}
        </div>

        {/* Colorized Hero Strip — vw units, sits over background */}
        <div
          className="absolute top-0 bottom-0 overflow-hidden group"
          style={{ left: '14.71vw', width: '23.79vw' }}
          data-onboarding="profile_hero"
          {...fieldProps("organizations", "hero_image_url", organization.id, organization.id)}
        >
          {heroImage ? (
            <ColorizedImage
              src={heroImage}
              color={primaryColor}
              alt={`${organization.name} campus`}
              className="w-full h-full"
              intensity={0.6}
            />
          ) : (
            <div className="w-full h-full" style={{ backgroundColor: primaryColor }} />
          )}
          {editMode && canEditThisOrg && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer">
              <div className="bg-white/90 rounded-full p-4 shadow-lg">
                <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                </svg>
              </div>
              <span className="absolute bottom-4 text-white text-sm font-medium">
                {heroImage ? "Change hero strip" : "Add hero strip image"}
              </span>
            </div>
          )}
        </div>

        {/* Product Overlay — anchored to bottom of sticky panel */}
        {(organization.product_overlay_url || (editMode && canEditThisOrg)) && (
          <div
            className="absolute z-20 pointer-events-auto flex items-center justify-center group"
            style={{ left: '5.64vw', bottom: '0', width: '42.09vw', height: '42.09vw' }}
            data-onboarding="profile_featured_product"
            {...fieldProps("organizations", "product_overlay_url", organization.id, organization.id)}
          >
            {organization.product_overlay_url ? (
              <Image
                src={organization.product_overlay_url}
                alt="Featured product"
                width={2301}
                height={2301}
                className="max-w-full max-h-full object-contain"
                style={{
                  filter: "drop-shadow(0 25px 50px rgba(0,0,0,0.4))",
                }}
                unoptimized
              />
            ) : null}
            {/* Edit mode overlay - shows upload hint */}
            {editMode && canEditThisOrg && (
              <div className={`absolute inset-0 ${organization.product_overlay_url ? 'bg-black/0 group-hover:bg-black/40' : 'bg-gray-200/50'} transition-colors flex items-center justify-center ${organization.product_overlay_url ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'} cursor-pointer rounded-lg`}>
                <div className="bg-white/90 rounded-full p-3 shadow-lg">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                  </svg>
                </div>
                <span className="absolute bottom-8 text-white text-sm font-medium bg-black/50 px-3 py-1 rounded-full">
                  {organization.product_overlay_url ? 'Change' : 'Add'} product overlay
                </span>
              </div>
            )}
          </div>
        )}

        </div>{/* end sticky left panel */}

        {/* Right content panel — Zone 1: logo through contacts */}
        <div
          className="flex-1 relative z-10"
          style={{
            paddingRight: '8.78%',
            paddingTop: '108px',
            paddingBottom: '64px',
          }}
        >
          {/* Logo — 560x155px area, 62px gap to color swatches */}
          <div style={{ width: '560px', height: '155px', marginBottom: '62px' }} data-onboarding="profile_logo" {...fieldProps("organizations", "logo_horizontal_url", organization.id, organization.id)}>
            {organization.logo_horizontal_url ? (
              <Image
                src={organization.logo_horizontal_url}
                alt={organization.name}
                width={560}
                height={155}
                className="w-full h-full object-contain object-left"
                unoptimized
              />
            ) : organization.logo_url ? (
              <Image
                src={organization.logo_url}
                alt={organization.name}
                width={560}
                height={155}
                className="w-full h-full object-contain object-left"
                unoptimized
              />
            ) : (
              <h1 className="text-4xl lg:text-6xl font-bold tracking-tight leading-[0.9] text-[#1A1A1A]">
                {formatSchoolName(organization.name)}
              </h1>
            )}
          </div>

          {/* Directory Mark — separate SQUARE logo used on the map & directory cards.
              Edit-mode only so the public profile stays focused on the horizontal logo above. */}
          {editMode && canEditThisOrg && (
            <div className="mb-10">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">Directory Mark</h3>
              <div className="flex items-start gap-4">
                <div
                  className="w-20 h-20 rounded-full border border-gray-200 bg-white flex items-center justify-center overflow-hidden cursor-pointer flex-shrink-0"
                  {...fieldProps("organizations", "logo_url", organization.id, organization.id)}
                >
                  {organization.logo_url ? (
                    <Image
                      src={organization.logo_url}
                      alt={`${organization.name} directory mark`}
                      width={80}
                      height={80}
                      className="w-full h-full object-contain"
                      unoptimized
                    />
                  ) : (
                    <span className="text-[11px] text-gray-400 text-center leading-tight px-1">Add mark</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
                  Square mark shown on the map and in directory cards. Your full horizontal logo at the top of this page is set separately.
                </p>
              </div>
            </div>
          )}

          {isCscAdmin && renewalWindowOpen && (
            <RenewMembershipCard
              organizationId={organization.id}
              membershipStatus={organization.membership_status ?? null}
              membershipExpiresAt={organization.membership_expires_at ?? null}
            />
          )}

          {/* Sponsor tier badge */}
          {sponsorTier && (
            <div className="flex items-center gap-2 mb-8">
              <TierIconPreview icon={sponsorTier.icon ?? "shield"} color={sponsorTier.color} size={20} />
              <span className="text-sm font-semibold" style={{ color: sponsorTier.color }}>
                {sponsorTier.name} Sponsor
              </span>
            </div>
          )}

          {/* Brand Color Swatches — grouped by Primary/Secondary */}
          {(brandColors.length > 0 || (editMode && canEditThisOrg)) && (() => {
            const primaryColors = brandColors.filter(c => c.name?.toLowerCase().includes('primary') || (c.sort_order && c.sort_order <= 5));
            const secondaryColors = brandColors.filter(c => c.name?.toLowerCase().includes('secondary') || (c.sort_order && c.sort_order > 5));
            // If no categorization, show all as primary
            const hasCategories = primaryColors.length > 0 && secondaryColors.length > 0;

            return (
              <div className="mb-10 space-y-4">
                {/* Brand Colors section header with visibility toggle */}
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wider text-gray-400 font-medium">Brand Colours</span>
                  {editMode && canEditThisOrg && (
                    <button
                      onClick={() => toggleVisibility("brandColors")}
                      title={showBrandColors ? "Visible to the community — click to hide" : "Hidden from the community — click to show"}
                      className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors ${showBrandColors ? "border-emerald-300 text-emerald-600 hover:bg-emerald-50" : "border-amber-300 text-amber-600 bg-amber-50 hover:bg-amber-100"}`}
                    >
                      {showBrandColors ? (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      ) : (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                      )}
                      {showBrandColors ? "Visible" : "Hidden"}
                    </button>
                  )}
                </div>
                {/* Primary Colors — larger, more prominent */}
                <div>
                  {hasCategories && (
                    <span className="text-xs uppercase tracking-wider text-gray-400 font-medium mb-2 block">Primary</span>
                  )}
                  <div className="flex flex-wrap items-center" style={{ gap: '12px' }}>
                    {(hasCategories ? primaryColors : brandColors).map((color) => {
                      const hexColor = normalizeHex(color.hex);
                      return (
                        <div key={color.id} className="relative group">
                          <div
                            className="rounded-full flex items-center justify-center text-sm font-semibold shadow-sm"
                            style={{
                              width: '130px',
                              height: '40px',
                              backgroundColor: hexColor,
                              color: isLightColor(color.hex) ? "#000" : "#fff",
                            }}
                            {...fieldProps("brand_colors", "hex", color.id, organization.id)}
                          >
                            {hexColor.toUpperCase()}
                          </div>
                          {/* Delete button - only in edit mode */}
                          {editMode && canEditThisOrg && (
                            <div
                              className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                              data-delete-color
                              data-entity-id={color.id}
                            >
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                              </svg>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Add primary color button */}
                    {editMode && canEditThisOrg && (
                      <div
                        className="rounded-full flex items-center justify-center text-gray-400 hover:text-emerald-600 hover:border-emerald-400 border-2 border-dashed border-gray-300 cursor-pointer transition-colors"
                        style={{ width: '130px', height: '40px' }}
                        data-add-color
                        data-organization-id={organization.id}
                        data-color-type="primary"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
                {/* Secondary Colors — smaller, subtler */}
                {(hasCategories || (editMode && canEditThisOrg)) && (
                  <div>
                    <span className="text-xs uppercase tracking-wider text-gray-400 font-medium mb-2 block">Secondary</span>
                    <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
                      {secondaryColors.map((color) => {
                        const hexColor = normalizeHex(color.hex);
                        return (
                          <div key={color.id} className="relative group">
                            <div
                              className="rounded-full flex items-center justify-center text-xs font-medium"
                              style={{
                                width: '90px',
                                height: '28px',
                                backgroundColor: hexColor,
                                color: isLightColor(color.hex) ? "#000" : "#fff",
                              }}
                              {...fieldProps("brand_colors", "hex", color.id, organization.id)}
                            >
                              {hexColor.toUpperCase()}
                            </div>
                            {/* Delete button - only in edit mode */}
                            {editMode && canEditThisOrg && (
                              <div
                                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                data-delete-color
                                data-entity-id={color.id}
                              >
                                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {/* Add secondary color button */}
                      {editMode && canEditThisOrg && (
                        <div
                          className="rounded-full flex items-center justify-center text-gray-400 hover:text-emerald-600 hover:border-emerald-400 border-2 border-dashed border-gray-300 cursor-pointer transition-colors"
                          style={{ width: '90px', height: '28px' }}
                          data-add-color
                          data-organization-id={organization.id}
                          data-color-type="secondary"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Store Contact — hidden when show_primary_contact is off for non-admins */}
          {(isPrivilegedViewer || showPrimaryContact) && (
            <div className="mb-10">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Store Contact</h3>
                {editMode && canEditThisOrg && VisEye({ flag: "primaryContact", value: showPrimaryContact, label: showPrimaryContact ? "Visible" : "Hidden" })}
              </div>
              <div className="flex flex-wrap gap-8 text-gray-500">
                <span data-onboarding="public_contact_email" {...fieldProps("organizations", "email", organization.id, organization.id)}>
                  {editMode && canEditThisOrg
                    ? <span className="flex flex-col gap-0.5">
                        <span>{organization.email || "—"}</span>
                        <span className="text-xs text-gray-400">Public email — use a shared inbox, not a personal address</span>
                      </span>
                    : renderOrgField(organization.email, "email")}
                </span>
                <span {...fieldProps("organizations", "phone", organization.id, organization.id)}>
                  {editMode && canEditThisOrg
                    ? (organization.phone || "—")
                    : renderOrgField(organization.phone, "phone")}
                </span>
                <span {...fieldProps("organizations", "website", organization.id, organization.id)}>
                  {editMode && canEditThisOrg
                    ? (organization.website || "—")
                    : organization.website
                      ? <a href={organization.website.startsWith('http') ? organization.website : `https://${organization.website}`} target="_blank" rel="noopener noreferrer" className="hover:text-[#1A1A1A] transition-colors">{organization.website}</a>
                      : "—"}
                </span>
              </div>
            </div>
          )}

          {/* Store Information — hidden when show_store_information is off for non-admins */}
          {(isPrivilegedViewer || showStoreInfo) && (
            <div className="mb-10">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Store Information</h3>
                {editMode && canEditThisOrg && VisEye({ flag: "storeInfo", value: showStoreInfo, label: showStoreInfo ? "Visible" : "Hidden" })}
              </div>
              <ProtectedSection
                bypass={isOwnOrgPage}
              requiredPermission="member"
                bannerMessage="Sign in as a member or partner to view store details."
                ctaText="Sign In"
                ctaLink="/login"
              >
                <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
                  {(organization.square_footage || benchmarking?.total_square_footage || (editMode && canEditThisOrg)) && (
                    <>
                      <span className="text-gray-500">Square Footage</span>
                      <span className="text-[#1A1A1A] font-medium" {...fieldProps("organizations", "square_footage", organization.id, organization.id)}>
                        {organization.square_footage || benchmarking?.total_square_footage
                          ? `${formatNumber(organization.square_footage || benchmarking?.total_square_footage)} sq ft`
                          : "—"}
                      </span>
                    </>
                  )}
                  {(organization.fte || (editMode && canEditThisOrg)) && (
                    <>
                      <span className="text-gray-500">Student FTE</span>
                      <span className="text-[#1A1A1A] font-medium" {...fieldProps("organizations", "fte", organization.id, organization.id)}>
                        {organization.fte || "—"}
                      </span>
                    </>
                  )}
                  {(benchmarking?.enrollment_fte || (editMode && canEditThisOrg && benchmarking)) && (
                    <>
                      <span className="text-gray-500">Student FTE</span>
                      <span className="text-[#1A1A1A] font-medium" {...fieldProps("benchmarking", "enrollment_fte", benchmarking!.id, organization.id)}>
                        {benchmarking?.enrollment_fte ? formatNumber(benchmarking.enrollment_fte) : "—"}
                      </span>
                    </>
                  )}
                  {(benchmarking?.num_store_locations || (editMode && canEditThisOrg && benchmarking)) && (
                    <>
                      <span className="text-gray-500">Store Locations</span>
                      <span className="text-[#1A1A1A] font-medium" {...fieldProps("benchmarking", "num_store_locations", benchmarking!.id, organization.id)}>
                        {benchmarking?.num_store_locations || "—"}
                      </span>
                    </>
                  )}
                  {(benchmarking?.institution_type || (editMode && canEditThisOrg && benchmarking)) && (
                    <>
                      <span className="text-gray-500">Institution Type</span>
                      <span className="text-[#1A1A1A] font-medium" {...fieldProps("benchmarking", "institution_type", benchmarking!.id, organization.id)}>
                        {benchmarking?.institution_type || "—"}
                      </span>
                    </>
                  )}
                  {(benchmarking?.pos_system || (editMode && canEditThisOrg && benchmarking)) && (
                    <>
                      <span className="text-gray-500">POS System</span>
                      <span className="text-[#1A1A1A] font-medium" {...fieldProps("benchmarking", "pos_system", benchmarking!.id, organization.id)}>
                        {benchmarking?.pos_system || "—"}
                      </span>
                    </>
                  )}
                  {!organization.square_footage && !organization.fte && !benchmarking && !editMode && (
                    <span className="text-gray-400 col-span-2 italic">Store information not yet available</span>
                  )}
                </div>
              </ProtectedSection>
            </div>
          )}

          {/* Staffing — Names visible to all, contact details blurred for public */}
          {(contacts.length > 0 || (editMode && canEditThisOrg)) && (
            <ProtectedSection
              requiredPermission="partner"
              bannerMessage="Sign in to view full contact details"
              ctaText="Sign In"
              ctaLink="/login"
            >
              <div data-onboarding="contacts_section">
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Staffing</h3>
                  {editMode && canEditThisOrg && (
                    <button
                      onClick={() => toggleVisibility("contacts")}
                      title={showContacts ? "Visible to the community — click to hide" : "Hidden from the community — click to show"}
                      className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors ${showContacts ? "border-emerald-300 text-emerald-600 hover:bg-emerald-50" : "border-amber-300 text-amber-600 bg-amber-50 hover:bg-amber-100"}`}
                    >
                      {showContacts ? (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      ) : (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                      )}
                      {showContacts ? "Visible" : "Hidden"}
                    </button>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                      <th className="pb-2 pr-4 font-semibold">Name</th>
                      <th className="pb-2 pr-4 font-semibold">Email</th>
                      <th className="pb-2 pr-4 font-semibold">Role</th>
                      <th className="pb-2 pr-4 font-semibold">Phone</th>
                      {hasPublicConference && assignableEntities.map((entity) => (
                        <th key={entity.entityId} className="pb-2 pl-3 font-semibold">{entity.name}</th>
                      ))}
                      {/* Badge/check-in status is a CSC staff concern, not something an org admin manages or needs to see. */}
                      {isCscAdmin && <th className="pb-2 pl-3 font-semibold">Badge</th>}
                      {isCscAdmin && <th className="pb-2 pl-3 font-semibold">Check-in</th>}
                      {editMode && canEditThisOrg ? <th className="pb-2 pl-4 font-semibold">Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map((contact) => (
                      (() => {
                        const person = findPersonForContact(contact);
                        return (
                      <tr
                        key={contact.id}
                        className={`border-b border-gray-200 ${isContactHidden(contact) ? "opacity-50" : ""} ${(editMode && canEditThisOrg) || isOwnContact(contact) ? "cursor-pointer hover:bg-gray-50" : ""}${isOwnContact(contact) && !editMode ? " ring-1 ring-inset ring-[#EE2A2E]/20" : ""}`}
                        data-flaggable
                        onClick={(editMode && canEditThisOrg) || isOwnContact(contact) ? (e) => {
                          if ((e.target as HTMLElement).closest('[data-deletable]')) return;
                          setEditingContact(contact);
                        } : undefined}
                      >
                        <td className="py-2 pr-4 text-[#1A1A1A]" {...(!editMode ? fieldProps("contacts", "name", contact.id, organization.id) : {})}>
                          {contact.name ? (
                            isMaskedValue(contact.name as string) ? <BlurredField maskedValue={contact.name as string} /> : (
                              contact.circle_id ? (
                                <a href={`/api/circle/profile/${contact.id}`} className="hover:text-[#EE2A2E] transition-colors">{contact.name as string}</a>
                              ) : (contact.name as string)
                            )
                          ) : "—"}
                        </td>
                        <td className="py-2 pr-4 text-gray-400" {...(!editMode ? fieldProps("contacts", "work_email", contact.id, organization.id) : {})}>
                          {renderContactField(contact.work_email as string | null, contact.email as string | null, "email")}
                        </td>
                        <td className="py-2 pr-4 text-gray-400" {...(!editMode ? fieldProps("contacts", "role_title", contact.id, organization.id) : {})}>
                          {contact.role_title ? (contact.role_title as string) : <BlurredField placeholderWidth={10} />}
                        </td>
                        <td className="py-2 text-gray-400" {...(!editMode ? fieldProps("contacts", "work_phone_number", contact.id, organization.id) : {})}>
                          {renderContactField(contact.work_phone_number as string | null, contact.phone as string | null, "phone")}
                        </td>
                        {hasPublicConference && assignableEntities.map((entity) => {
                          const cell = getEntityAttendanceCell(contact, entity);
                          return (
                            <td key={entity.entityId} className="py-2 pl-3 text-xs" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                aria-label={`${entity.name} for ${contact.name ?? "contact"}`}
                                checked={cell.checked}
                                disabled={cell.disabled}
                                onChange={(event) => void handleEntityToggle(contact, entity, event.target.checked)}
                                className="h-4 w-4"
                              />
                            </td>
                          );
                        })}
                        {isCscAdmin && <td className="py-2 pl-3 text-gray-400">{person?.badgeStatus ?? "—"}</td>}
                        {isCscAdmin && <td className="py-2 pl-3 text-gray-400">{person?.checkedInAt ? "Checked in" : "—"}</td>}
                        {/* Actions — delete only in edit mode; eye moved to contact edit modal */}
                        {editMode && canEditThisOrg && (
                          <td className="py-2 pl-4 w-10">
                            <div
                              className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 cursor-pointer rounded transition-colors"
                              data-entity-id={contact.id}
                              data-deletable
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                              </svg>
                            </div>
                          </td>
                        )}
                      </tr>
                        );
                      })()
                    ))}
                    {/* Add Contact row - only visible in edit mode for admins */}
                    {editMode && canEditThisOrg && (
                      <tr
                        className="border-b border-gray-200 hover:bg-emerald-50 cursor-pointer transition-colors"
                        data-add-contact
                        data-organization-id={organization.id}
                      >
                        <td colSpan={4 + (hasPublicConference ? assignableEntities.length : 0) + (isCscAdmin ? 2 : 0)} className="py-3 text-center text-emerald-600 font-medium">
                          <span className="flex items-center justify-center gap-2">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                            Add a new contact
                          </span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {attendanceError ? (
                  <p className="mt-2 text-xs text-red-600">{attendanceError}</p>
                ) : null}
                {/* Add-ons are secondary to the roster above — nice to have, not required, so they sit below the names. */}
                {hasPublicConference && buyableExtras.length > 0 ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {buyableExtras.map((offer) => {
                      const heldEntity = heldEntityById.get(offer.id);
                      return heldEntity ? (
                        <HeldOfferCard
                          key={offer.id}
                          offer={offer}
                          entity={heldEntity}
                          conferenceId={currentConferenceId ?? ""}
                          organizationId={organization.id}
                          contacts={contacts}
                        />
                      ) : (
                        <OfferCard
                          key={offer.id}
                          offer={offer}
                          conferenceId={currentConferenceId ?? ""}
                          organizationId={organization.id}
                        />
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </ProtectedSection>
          )}

        </div>
      </div>

      {/* "View as Partner" toggle bar — hidden while in toolkit edit mode */}
      {canViewAsPartner && !isPartner && !editMode && (
        <div data-onboarding="view_as_partner" className="bg-gray-50 border-t border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-8 py-2.5 flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {partnerViewMode
                ? "Viewing as a vendor partner — this is exactly what they see."
                : "Switch to see what vendor partners see about your institution."}
            </p>
            <button
              onClick={() => {
                setPartnerViewMode((v) => !v);
                window.dispatchEvent(new CustomEvent("csc:field-updated", {
                  detail: { table: "organizations", column: "_partner_view_toggled" },
                }));
              }}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                partnerViewMode
                  ? "bg-[#1A1A1A] text-white hover:bg-gray-700"
                  : "bg-white border border-gray-300 text-gray-700 hover:border-gray-400"
              }`}
            >
              {partnerViewMode ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Back to my view
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  View as Partner
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Conditional Section: edit mode takes over entirely; otherwise partner/normal view */}
      {!editMode && (isPartner || partnerViewMode) ? (
        <PartnerViewOfMember
          organization={organization}
          contacts={contacts}
        />
      ) : !editMode && (
        benchmarking && allBenchmarking.length > 0 && (
          <div className="bg-white border-t border-gray-200">
            <div className="max-w-7xl mx-auto px-8 py-12">
              {editMode && canEditThisOrg && (
                <div className="flex items-center gap-2 mb-6">
                  <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Benchmarking</h3>
                  <button
                    onClick={() => toggleVisibility("benchmarking")}
                    title={showInBenchmarking ? "Included in comparisons — click to opt out" : "Opted out of comparisons — click to include"}
                    className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors ${showInBenchmarking ? "border-emerald-300 text-emerald-600 hover:bg-emerald-50" : "border-amber-300 text-amber-600 bg-amber-50 hover:bg-amber-100"}`}
                  >
                    {showInBenchmarking ? (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    ) : (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                    )}
                    {showInBenchmarking ? "Included" : "Opted out"}
                  </button>
                </div>
              )}
              <BenchmarkingDetails
                benchmarking={benchmarking}
                organizationName={organization.name}
              />
              <div className="mt-12 pt-8 border-t border-gray-200">
                <BenchmarkingComparison
                  allBenchmarking={allBenchmarking}
                  currentOrgId={organization.id}
                />
              </div>
            </div>
          </div>
        )
      )}

      {/* Procurement edit form — toolkit edit mode active, not an actual partner */}
      <div data-onboarding="procurement_section">
      {editMode && canEditThisOrg && !isPartner && (
        <EditableProcurementSection
          organization={organization}
          contacts={contacts}
          autoEdit
          externalData={procurementInfo}
          onExternalSave={setProcurementInfo}
        />
      )}

      {/* My Suppliers — full panel for org members */}
      {memberSuppliers && (
        <MemberSupplierPanel data={memberSuppliers} />
      )}

      </div>{/* end procurement_section */}

      {/* RFPs — visible to all viewers with appropriate access; org admins can manage */}
      {!isPartner && (
        <div data-onboarding="rfps_section" className="bg-white border-t border-gray-200">
          <div className="max-w-7xl mx-auto px-8 py-12">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-[#1A1A1A]">Open RFPs</h2>
            </div>
            <RFPsSection
              organizationId={organization.id}
              contacts={contacts}
              initialRFPs={initialRFPs}
              canEdit={canEditThisOrg}
            />
          </div>
        </div>
      )}

      {/* Mobile Layout — no hero strip, clean content focus */}
      <div className="lg:hidden">
        {/* Slim colour accent bar in place of the hero */}
        <div className="h-1.5 w-full" style={{ backgroundColor: primaryColor }} />

        <div className="p-8">
          <div className="mb-6">
            {(organization.logo_horizontal_url || organization.logo_url) ? (
              <Image
                src={(organization.logo_horizontal_url || organization.logo_url) as string}
                alt={organization.name}
                width={300}
                height={80}
                className="h-16 w-auto object-contain"
                unoptimized
              />
            ) : (
              <h1 className="text-3xl font-bold text-[#1A1A1A]">
                {formatSchoolName(organization.name)}
              </h1>
            )}
          </div>

          {isCscAdmin && renewalWindowOpen && (
            <RenewMembershipCard
              organizationId={organization.id}
              membershipStatus={organization.membership_status ?? null}
              membershipExpiresAt={organization.membership_expires_at ?? null}
            />
          )}

          {/* Sponsor tier badge (mobile) */}
          {sponsorTier && (
            <div className="flex items-center gap-2 mb-6">
              <TierIconPreview icon={sponsorTier.icon ?? "shield"} color={sponsorTier.color} size={18} />
              <span className="text-sm font-semibold" style={{ color: sponsorTier.color }}>
                {sponsorTier.name} Sponsor
              </span>
            </div>
          )}

          {/* Brand Color Swatches — grouped by Primary/Secondary (mobile) */}
          {(brandColors.length > 0 || (editMode && canEditThisOrg)) && (() => {
            const primaryColors = brandColors.filter(c => c.name?.toLowerCase().includes('primary') || (c.sort_order && c.sort_order <= 5));
            const secondaryColors = brandColors.filter(c => c.name?.toLowerCase().includes('secondary') || (c.sort_order && c.sort_order > 5));
            const hasCategories = primaryColors.length > 0 && secondaryColors.length > 0;

            return (
              <div className="mb-8 space-y-3">
                {/* Brand Colors section header with visibility toggle */}
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wider text-gray-400 font-medium">Brand Colours</span>
                  {editMode && canEditThisOrg && (
                    <button
                      onClick={() => toggleVisibility("brandColors")}
                      title={showBrandColors ? "Visible to the community — click to hide" : "Hidden from the community — click to show"}
                      className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors ${showBrandColors ? "border-emerald-300 text-emerald-600 hover:bg-emerald-50" : "border-amber-300 text-amber-600 bg-amber-50 hover:bg-amber-100"}`}
                    >
                      {showBrandColors ? (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      ) : (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                      )}
                      {showBrandColors ? "Visible" : "Hidden"}
                    </button>
                  )}
                </div>
                {/* Primary Colors — larger, more prominent */}
                <div>
                  {hasCategories && (
                    <span className="text-xs uppercase tracking-wider text-gray-400 font-medium mb-2 block">Primary</span>
                  )}
                  <div className="flex gap-3 flex-wrap items-center">
                    {(hasCategories ? primaryColors : brandColors).map((color) => {
                      const hexColor = normalizeHex(color.hex);
                      return (
                        <div key={color.id} className="relative group">
                          <div
                            className="rounded-full flex items-center justify-center text-xs font-semibold shadow-sm"
                            style={{
                              width: '110px',
                              height: '34px',
                              backgroundColor: hexColor,
                              color: isLightColor(color.hex) ? "#000" : "#fff",
                            }}
                          >
                            {hexColor.toUpperCase()}
                          </div>
                          {/* Delete button - only in edit mode */}
                          {editMode && canEditThisOrg && (
                            <div
                              className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center cursor-pointer"
                              data-delete-color
                              data-entity-id={color.id}
                            >
                              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                              </svg>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {/* Add primary color button */}
                    {editMode && canEditThisOrg && (
                      <div
                        className="rounded-full flex items-center justify-center text-gray-400 hover:text-emerald-600 hover:border-emerald-400 border-2 border-dashed border-gray-300 cursor-pointer transition-colors"
                        style={{ width: '110px', height: '34px' }}
                        data-add-color
                        data-organization-id={organization.id}
                        data-color-type="primary"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
                {/* Secondary Colors — smaller, subtler */}
                {(hasCategories || (editMode && canEditThisOrg)) && (
                  <div>
                    <span className="text-xs uppercase tracking-wider text-gray-400 font-medium mb-2 block">Secondary</span>
                    <div className="flex gap-2 flex-wrap items-center">
                      {secondaryColors.map((color) => {
                        const hexColor = normalizeHex(color.hex);
                        return (
                          <div key={color.id} className="relative group">
                            <div
                              className="rounded-full flex items-center justify-center font-medium"
                              style={{
                                width: '76px',
                                height: '24px',
                                fontSize: '10px',
                                backgroundColor: hexColor,
                                color: isLightColor(color.hex) ? "#000" : "#fff",
                              }}
                            >
                              {hexColor.toUpperCase()}
                            </div>
                            {/* Delete button - only in edit mode */}
                            {editMode && canEditThisOrg && (
                              <div
                                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center cursor-pointer"
                                data-delete-color
                                data-entity-id={color.id}
                              >
                                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {/* Add secondary color button */}
                      {editMode && canEditThisOrg && (
                        <div
                          className="rounded-full flex items-center justify-center text-gray-400 hover:text-emerald-600 hover:border-emerald-400 border-2 border-dashed border-gray-300 cursor-pointer transition-colors"
                          style={{ width: '76px', height: '24px' }}
                          data-add-color
                          data-organization-id={organization.id}
                          data-color-type="secondary"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Store Contact */}
          {(isPrivilegedViewer || showPrimaryContact) && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Store Contact</h3>
                {editMode && canEditThisOrg && VisEye({ flag: "primaryContact", value: showPrimaryContact, label: showPrimaryContact ? "Visible" : "Hidden" })}
              </div>
              <div className="flex flex-wrap gap-4 text-gray-500 text-sm">
                <span data-onboarding="public_contact_email" {...fieldProps("organizations", "email", organization.id, organization.id)}>
                  {editMode && canEditThisOrg
                    ? <span className="flex flex-col gap-0.5">
                        <span>{organization.email || "—"}</span>
                        <span className="text-xs text-gray-400">Public email — use a shared inbox, not a personal address</span>
                      </span>
                    : renderOrgField(organization.email, "email")}
                </span>
                <span {...fieldProps("organizations", "phone", organization.id, organization.id)}>
                  {editMode && canEditThisOrg ? (organization.phone || "—") : renderOrgField(organization.phone, "phone")}
                </span>
                <span {...fieldProps("organizations", "website", organization.id, organization.id)}>
                  {editMode && canEditThisOrg
                    ? (organization.website || "—")
                    : organization.website
                      ? <a href={organization.website.startsWith('http') ? organization.website : `https://${organization.website}`} target="_blank" rel="noopener noreferrer" className="hover:text-[#1A1A1A] transition-colors">{organization.website}</a>
                      : "—"}
                </span>
              </div>
            </div>
          )}

          {/* Store Information */}
          {(isPrivilegedViewer || showStoreInfo) && (
            <div className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Store Information</h3>
                {editMode && canEditThisOrg && VisEye({ flag: "storeInfo", value: showStoreInfo, label: showStoreInfo ? "Visible" : "Hidden" })}
              </div>
              <ProtectedSection
                bypass={isOwnOrgPage}
              requiredPermission="member"
                bannerMessage="Sign in as a member or partner to view store details."
                ctaText="Sign In"
                ctaLink="/login"
              >
                <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  {(organization.square_footage || benchmarking?.total_square_footage || (editMode && canEditThisOrg)) && (
                    <>
                      <span className="text-gray-500">Square Footage</span>
                      <span className="text-[#1A1A1A] font-medium" {...fieldProps("organizations", "square_footage", organization.id, organization.id)}>
                        {organization.square_footage || benchmarking?.total_square_footage
                          ? `${formatNumber(organization.square_footage || benchmarking?.total_square_footage)} sq ft`
                          : "—"}
                      </span>
                    </>
                  )}
                  {(organization.fte || (editMode && canEditThisOrg)) && (
                    <>
                      <span className="text-gray-500">Student FTE</span>
                      <span className="text-[#1A1A1A] font-medium" {...fieldProps("organizations", "fte", organization.id, organization.id)}>
                        {organization.fte || "—"}
                      </span>
                    </>
                  )}
                  {(benchmarking?.enrollment_fte || (editMode && canEditThisOrg && benchmarking)) && (
                    <>
                      <span className="text-gray-500">Student FTE</span>
                      <span className="text-[#1A1A1A] font-medium" {...fieldProps("benchmarking", "enrollment_fte", benchmarking!.id, organization.id)}>
                        {benchmarking?.enrollment_fte ? formatNumber(benchmarking.enrollment_fte) : "—"}
                      </span>
                    </>
                  )}
                  {(benchmarking?.institution_type || (editMode && canEditThisOrg && benchmarking)) && (
                    <>
                      <span className="text-gray-500">Institution Type</span>
                      <span className="text-[#1A1A1A] font-medium" {...fieldProps("benchmarking", "institution_type", benchmarking!.id, organization.id)}>
                        {benchmarking?.institution_type || "—"}
                      </span>
                    </>
                  )}
                  {!organization.square_footage && !organization.fte && !benchmarking && !editMode && (
                    <span className="text-gray-400 col-span-2 italic">Store information not yet available</span>
                  )}
                </div>
              </ProtectedSection>
            </div>
          )}

          {/* Staffing — Names visible, contact details blurred for public */}
          {(contacts.length > 0 || (editMode && canEditThisOrg)) && (
            <ProtectedSection
              requiredPermission="partner"
              bannerMessage="Sign in to view full contact details"
              ctaText="Sign In"
              ctaLink="/login"
            >
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Staffing</h3>
                  {editMode && canEditThisOrg && (
                    <button
                      onClick={() => toggleVisibility("contacts")}
                      title={showContacts ? "Visible to the community — click to hide" : "Hidden from the community — click to show"}
                      className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-colors ${showContacts ? "border-emerald-300 text-emerald-600 hover:bg-emerald-50" : "border-amber-300 text-amber-600 bg-amber-50 hover:bg-amber-100"}`}
                    >
                      {showContacts ? (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      ) : (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                      )}
                      {showContacts ? "Visible" : "Hidden"}
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {contacts.map((contact) => (
                    (() => {
                      const person = findPersonForContact(contact);
                      return (
                    <div
                      key={contact.id}
                      className={`border-b border-gray-200 pb-3 flex justify-between items-start ${isContactHidden(contact) ? "opacity-50" : ""}`}
                      data-flaggable
                    >
                      <div className="flex-1">
                        <div className="font-medium text-[#1A1A1A]" {...fieldProps("contacts", "name", contact.id, organization.id)}>
                          {contact.name ? (
                            isMaskedValue(contact.name as string) ? <BlurredField maskedValue={contact.name as string} /> : (
                              contact.circle_id ? (
                                <a href={`/api/circle/profile/${contact.id}`} className="hover:text-[#EE2A2E] transition-colors">{contact.name as string}</a>
                              ) : (contact.name as string)
                            )
                          ) : "—"}
                        </div>
                        <div className="text-sm text-gray-400" {...fieldProps("contacts", "role_title", contact.id, organization.id)}>
                          {contact.role_title ? (contact.role_title as string) : "—"}
                        </div>
                        <div className="text-sm text-gray-400" {...fieldProps("contacts", "work_email", contact.id, organization.id)}>
                          {renderContactField(contact.work_email as string | null, contact.email as string | null, "email")}
                        </div>
                        {hasPublicConference && assignableEntities.map((entity) => {
                          const cell = getEntityAttendanceCell(contact, entity);
                          return (
                            <div key={entity.entityId} className="text-xs mt-1 font-medium">
                              <label className="inline-flex items-center gap-2">
                                <span>{entity.name}</span>
                                <input
                                  type="checkbox"
                                  aria-label={`${entity.name} for ${contact.name ?? "contact"}`}
                                  checked={cell.checked}
                                  disabled={cell.disabled}
                                  onChange={(event) => void handleEntityToggle(contact, entity, event.target.checked)}
                                  className="h-4 w-4"
                                />
                              </label>
                            </div>
                          );
                        })}
                        {isCscAdmin && person ? (
                          <div className="text-[11px] text-gray-400 mt-1">
                            Badge: {person.badgeStatus} · {person.checkedInAt ? "Checked in" : "Not checked in"}
                          </div>
                        ) : null}
                      </div>
                      {/* Actions — eye toggle + delete, only in edit mode */}
                      {editMode && canEditThisOrg && (
                        <div className="ml-2 flex flex-col gap-1 items-center">
                          {/* Visibility toggle */}
                          <button
                            onClick={() => void handleToggleContactHidden(contact)}
                            title={isContactHidden(contact) ? "Hidden from the community — click to show" : "Visible to the community — click to hide"}
                            className={`p-1.5 rounded border transition-colors ${isContactHidden(contact) ? "border-amber-300 text-amber-600 bg-amber-50 hover:bg-amber-100" : "border-gray-300 text-gray-400 hover:bg-gray-50"}`}
                          >
                            {isContactHidden(contact) ? (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            )}
                          </button>
                          {/* Delete */}
                          <div
                            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded cursor-pointer transition-colors"
                            data-entity-id={contact.id}
                            data-deletable
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                            </svg>
                          </div>
                        </div>
                      )}
                    </div>
                      );
                    })()
                  ))}
                  {/* Add Contact row - only visible in edit mode for admins */}
                  {editMode && canEditThisOrg && (
                    <div
                      className="border-b border-gray-200 pb-3 pt-2 hover:bg-emerald-50 cursor-pointer transition-colors text-center"
                      data-add-contact
                      data-organization-id={organization.id}
                    >
                      <span className="flex items-center justify-center gap-2 text-emerald-600 font-medium">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        Add a new contact
                      </span>
                    </div>
                  )}
                </div>
                {attendanceError ? (
                  <p className="mt-2 text-xs text-red-600">{attendanceError}</p>
                ) : null}
                {/* Add-ons are secondary to the roster above — nice to have, not required, so they sit below the names. */}
                {hasPublicConference && buyableExtras.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {buyableExtras.map((offer) => {
                      const heldEntity = heldEntityById.get(offer.id);
                      return heldEntity ? (
                        <HeldOfferCard
                          key={offer.id}
                          offer={offer}
                          entity={heldEntity}
                          conferenceId={currentConferenceId ?? ""}
                          organizationId={organization.id}
                          contacts={contacts}
                        />
                      ) : (
                        <OfferCard
                          key={offer.id}
                          offer={offer}
                          conferenceId={currentConferenceId ?? ""}
                          organizationId={organization.id}
                        />
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </ProtectedSection>
          )}

        </div>
      </div>

      {/* Contact edit modal */}
      {editingContact && (
        <ContactEditModal
          contact={editingContact}
          organizationId={organization.id}
          isHidden={isContactHidden(editingContact)}
          onToggleHidden={() => void handleToggleContactHidden(editingContact)}
          onClose={() => setEditingContact(null)}
          procurementInfo={
            // Always show Procurement tab for own contacts — even if org has no procurement
            // data yet, so the member can set their buying categories from scratch.
            isOwnOrgPage || isOwnContact(editingContact)
              ? (procurementInfo ?? {})
              : procurementInfo
          }
          onProcurementSave={setProcurementInfo}
        />
      )}

      {/* Back Link */}
      <div className="fixed bottom-8 left-8 z-50">
        <Link
          href="/"
          className="flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur-sm rounded-full shadow-lg text-gray-600 hover:text-[#1A1A1A] transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Network
        </Link>
      </div>
    </div>
  );
}

function formatSchoolName(name: string): React.ReactNode {
  if (name.toLowerCase().startsWith("university of ")) {
    return (<>UNIVERSITY OF<br />{name.slice(14).toUpperCase()}</>);
  }
  if (name.toLowerCase().endsWith(" university")) {
    return (<>{name.slice(0, -11).toUpperCase()}<br />UNIVERSITY</>);
  }
  if (name.toLowerCase().endsWith(" college")) {
    return (<>{name.slice(0, -8).toUpperCase()}<br />COLLEGE</>);
  }
  return name.toUpperCase();
}

function isLightColor(hex: string | null): boolean {
  if (!hex) return false;
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
}

function normalizeHex(hex: string | null): string {
  if (!hex) return "#888888";
  // Ensure hex has # prefix
  return hex.startsWith("#") ? hex : `#${hex}`;
}

function formatNumber(num: number | null | undefined): string {
  if (num == null) return "";
  return num.toLocaleString();
}
