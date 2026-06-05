"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { BrandColor } from "@/lib/database.types";
import type { VisibleOrganization, VisibleContact } from "@/lib/visibility/data";
import type { ViewerLevel } from "@/lib/visibility/defaults";
import ColorizedImage from "@/components/ui/ColorizedImage";
import { ProtectedSection, PageOwnerProvider } from "@/components/ui/GreyBlur";
import BlurredField from "@/components/ui/BlurredField";
import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import { useToolkit } from "@/components/ui/Toolkit";
import {
  assignConferenceEntitlement,
  unassignConferenceEntitlementWithDisposition,
} from "@/lib/actions/conference-people";
import { TierIconPreview } from "@/components/sponsorship/SponsorTierBadge";
import type { TierIcon } from "@/lib/sponsorship/types";
import CategoryEditor from "@/components/org/CategoryEditor";
import { VENDOR_CATEGORIES, CATEGORY_SUBCATEGORIES } from "@/lib/types/procurement";
import PartnerLinksSection from "@/components/org/PartnerLinksSection";
import type { ResolvedPartnerLink, PartnerLink } from "@/lib/partner-links";
import { CertificationBadges } from "@/components/ui/CertificationBadges";
import { CERTIFICATIONS } from "@/lib/certifications";
import { updateCertifications, updateCancollStatus } from "@/lib/actions/update-certifications";
import { setContactHidden } from "@/lib/actions/user-management";
import ContactEditModal from "@/components/org/ContactEditModal";
import { fieldProps } from "@/lib/editable-fields";
import type { RFPWithContext } from "@/lib/types/rfp";
import PartnerRFPFeed from "@/components/rfps/PartnerRFPFeed";
import type { MarketData } from "@/lib/actions/partner-market";
import PartnerMarketPanel from "@/components/org/PartnerMarketPanel";

// ── Category grouping ─────────────────────────────────────────────────────────
// primary_category is a flat comma-separated string of parent categories and
// subcategories mixed together. This groups them so subcategories nest under
// their parent for display.

const PARENT_SET = new Set<string>(VENDOR_CATEGORIES as readonly string[]);
const SUB_TO_PARENT = new Map<string, string>();
for (const [parent, subs] of Object.entries(CATEGORY_SUBCATEGORIES)) {
  for (const sub of subs ?? []) {
    SUB_TO_PARENT.set(sub, parent);
  }
}

function groupCategories(flat: string[]): Array<{ parent: string; subs: string[] }> {
  const groups = new Map<string, string[]>();
  for (const item of flat) {
    if (PARENT_SET.has(item)) {
      if (!groups.has(item)) groups.set(item, []);
    } else {
      const parent = SUB_TO_PARENT.get(item);
      if (parent) {
        if (!groups.has(parent)) groups.set(parent, []);
        groups.get(parent)!.push(item);
      } else {
        // Unknown item — show as standalone parent
        if (!groups.has(item)) groups.set(item, []);
      }
    }
  }
  return [...groups.entries()].map(([parent, subs]) => ({ parent, subs }));
}
// ─────────────────────────────────────────────────────────────────────────────

interface SponsorTierInfo {
  name: string; slug: string; color: string; icon: TierIcon | null;
}

interface PartnerProfileProps {
  organization: VisibleOrganization;
  sponsorTier?: SponsorTierInfo | null;
  contacts: VisibleContact[];
  brandColors: BrandColor[];
  viewerLevel: ViewerLevel;
  /** Pre-resolved visible links (signed URLs generated server-side) */
  visibleLinks: ResolvedPartnerLink[];
  hasGatedLinks: boolean;
  /** Raw links passed only when viewer can edit */
  rawLinks?: PartnerLink[];
  canEditLinks: boolean;
  partnerRFPs?: RFPWithContext[];
  partnerMarket?: MarketData | null;
  canNudge?: boolean;
  nudgeAvailableAt?: string | null;
  conferenceAttendance: Array<{
    id: string;
    conferenceId: string;
    conferenceName: string;
    conferenceYear: number;
    conferenceEditionCode: string;
    conferenceStartDate: string | null;
    organizationId: string;
    sourceType: string;
    sourceId: string;
    personKind: string;
    displayName: string | null;
    contactEmail: string | null;
    userId: string | null;
    assignmentStatus: string;
    entitlementId: string | null;
    entitlementType: string | null;
    badgeStatus: string;
    checkedInAt: string | null;
  }>;
  orgAssignableUsers: Array<{
    userId: string;
    displayName: string | null;
    email: string | null;
    role: string;
  }>;
}

export default function PartnerProfile({
  organization,
  contacts,
  brandColors,
  viewerLevel,
  conferenceAttendance,
  orgAssignableUsers,
  sponsorTier,
  visibleLinks,
  hasGatedLinks,
  rawLinks,
  canEditLinks,
  partnerRFPs = [],
  partnerMarket = null,
  canNudge = false,
  nudgeAvailableAt = null,
}: PartnerProfileProps) {
  const normalize = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
  const router = useRouter();
  const { permissionState, organizations, user } = useAuth();
  const userEmail = user?.email?.toLowerCase() ?? null;
  function isOwnContact(contact: VisibleContact): boolean {
    if (!userEmail) return false;
    const contactEmail = ((contact.work_email || contact.email) as string | null)?.toLowerCase();
    return !!contactEmail && contactEmail === userEmail;
  }
  const { editMode, canEditOrg } = useToolkit();
  const [savingContactId, setSavingContactId] = useState<string | null>(null);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [showCategoryEditor, setShowCategoryEditor] = useState(false);
  // Optimistic category value — updated immediately on save without a page reload
  const [categoryValue, setCategoryValue] = useState<string | null>(
    organization.primary_category ?? null
  );

  // Certifications — optimistic local state
  const [certifications, setCertifications] = useState<string[]>(
    Array.isArray(organization.certifications) ? (organization.certifications as string[]) : []
  );
  const [certSaving, setCertSaving] = useState(false);

  // CANCOLL — optimistic local state (admin only)
  const [cancollMember, setCancollMember] = useState<boolean>(
    organization.is_cancoll_member ?? false
  );
  const [cancollSaving, setCancollSaving] = useState(false);

  // Per-contact hidden state — keyed by contact.id. Overrides the DB value optimistically.
  const [contactHiddenOverrides, setContactHiddenOverrides] = useState<Record<string, boolean>>({});
  // Contact being edited in the edit modal (null = closed)
  const [editingContact, setEditingContact] = useState<VisibleContact | null>(null);
  const isContactHidden = (contact: VisibleContact) =>
    contact.id in contactHiddenOverrides ? contactHiddenOverrides[contact.id] : (contact.hidden ?? false);

  async function handleToggleContactHidden(contact: VisibleContact) {
    const current = isContactHidden(contact);
    const next = !current;
    setContactHiddenOverrides((prev) => ({ ...prev, [contact.id]: next }));
    const result = await setContactHidden(organization.id, contact.id, next);
    if (!result.success) {
      setContactHiddenOverrides((prev) => ({ ...prev, [contact.id]: current }));
    } else {
      window.dispatchEvent(new CustomEvent("csc:field-updated", {
        detail: { table: "contacts", column: "hidden", entityId: contact.id },
      }));
    }
  }

  // Check if current user can edit THIS organization
  const canEditThisOrg = canEditOrg(organization.id);
  const canEditConferenceAttendance =
    editMode &&
    (canEditThisOrg || permissionState === "admin" || permissionState === "super_admin");
  const isAdmin = permissionState === "admin" || permissionState === "super_admin";

  // Check if user is org_admin for THIS specific organization
  // True if the viewer belongs to this org in any capacity (admin or member).
  // Members of an org see their own page in full — no ProtectedSection gates.
  const isOrgAdminForThisOrg = organizations.some(
    (uo) => uo.organization.id === organization.id && uo.role === "org_admin"
  );
  const isOwnOrgPage = organizations.some(
    (uo) => uo.organization.id === organization.id
  );

  const handleToggleCertification = async (name: string) => {
    const next = certifications.includes(name)
      ? certifications.filter((c) => c !== name)
      : [...certifications, name];
    setCertifications(next);
    setCertSaving(true);
    await updateCertifications(organization.id, next);
    setCertSaving(false);
  };

  const handleCancollSave = async () => {
    setCancollSaving(true);
    await updateCancollStatus(organization.id, cancollMember);
    setCancollSaving(false);
  };

  // Debug log
  console.log("[PartnerProfile] permissionState:", permissionState, "isOrgAdmin:", isOrgAdminForThisOrg);

  // ---------------------------------------------------------------------------
  // Helpers for rendering pre-masked contact fields
  // ---------------------------------------------------------------------------

  /** Check if a string looks like a masked teaser (initials, domain-only, etc.) */
  const isMaskedValue = (value: string): boolean => {
    if (/^[A-Z]\.\s[A-Z]\.$/.test(value)) return true;
    if (/^([A-Z]\.\s?)+$/.test(value.trim())) return true;
    if (value.startsWith("@")) return true;
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

  const currentConference = useMemo(() => {
    const allRows = conferenceAttendance.map((row) => ({
      conferenceId: row.conferenceId,
      conferenceName: row.conferenceName,
      conferenceYear: row.conferenceYear,
      conferenceEditionCode: row.conferenceEditionCode,
      conferenceStartDate: row.conferenceStartDate,
      sourceType: row.sourceType,
      assignmentStatus: row.assignmentStatus,
      userId: row.userId,
      entitlementId: row.entitlementId ?? row.sourceId,
      entitlementType: row.entitlementType ?? "delegate",
      contactEmail: row.contactEmail,
      displayName: row.displayName,
    }));

    const startByConferenceId = new Map<string, number>();
    for (const row of allRows) {
      if (!row.conferenceStartDate) continue;
      const start = new Date(row.conferenceStartDate).getTime();
      if (!Number.isFinite(start)) continue;
      if (!startByConferenceId.has(row.conferenceId)) {
        startByConferenceId.set(row.conferenceId, start);
      }
    }

    const conferenceIds = Array.from(new Set(allRows.map((row) => row.conferenceId)));
    const now = Date.now();
    const upcoming = conferenceIds
      .map((id) => ({ id, start: startByConferenceId.get(id) }))
      .filter((entry): entry is { id: string; start: number } => Number.isFinite(entry.start))
      .filter((entry) => entry.start >= now)
      .sort((a, b) => a.start - b.start);
    const latestPast = conferenceIds
      .map((id) => ({ id, start: startByConferenceId.get(id) }))
      .filter((entry): entry is { id: string; start: number } => Number.isFinite(entry.start))
      .filter((entry) => entry.start < now)
      .sort((a, b) => b.start - a.start);
    const conferenceId = upcoming[0]?.id ?? latestPast[0]?.id ?? conferenceIds[0] ?? "";
    const conferenceRows = allRows.filter((row) => row.conferenceId === conferenceId);

    const entitlementRows = conferenceRows
      .filter((row) => row.sourceType === "entitlement")
      .map((row) => ({
        conferenceId: row.conferenceId,
        conferenceName: row.conferenceName,
        conferenceYear: row.conferenceYear,
        conferenceEditionCode: row.conferenceEditionCode,
        conferenceStartDate: row.conferenceStartDate,
        entitlementId: row.entitlementId,
        entitlementType: row.entitlementType ?? "delegate",
        contactEmail: row.contactEmail,
        displayName: row.displayName,
        assignmentStatus: row.assignmentStatus,
        userId: row.userId,
      }))
      .filter((row) => Boolean(row.entitlementId));

    const registrationAssignedUserIds = new Set(
      conferenceRows
        .filter((row) => row.sourceType === "registration" && row.userId && row.assignmentStatus !== "canceled")
        .map((row) => row.userId)
    );
    const registrationAssignedByEmail = new Set(
      conferenceRows
        .filter((row) => row.sourceType === "registration" && row.assignmentStatus !== "canceled")
        .map((row) => normalize(row.contactEmail))
        .filter((value) => Boolean(value))
    );
    const registrationAssignedByName = new Set(
      conferenceRows
        .filter((row) => row.sourceType === "registration" && row.assignmentStatus !== "canceled")
        .map((row) => normalize(row.displayName))
        .filter((value) => Boolean(value))
    );

    if (conferenceRows.length === 0) {
      return {
        conferenceId: "",
        label: "No conference entitlements",
        assignedByUserId: new Map<string, { entitlementId: string; entitlementType: string }>(),
        assignedByEmail: new Map<string, { entitlementId: string; entitlementType: string }>(),
        assignedByName: new Map<string, { entitlementId: string; entitlementType: string }>(),
        registrationAssignedUserIds: new Set<string>(),
        registrationAssignedByEmail: new Set<string>(),
        registrationAssignedByName: new Set<string>(),
        freeEntitlements: [] as Array<{ entitlementId: string; entitlementType: string }>,
        totalSeats: 0,
      };
    }
    const info = conferenceRows[0];

    const assignedByUserId = new Map<string, { entitlementId: string; entitlementType: string }>();
    const assignedByEmail = new Map<string, { entitlementId: string; entitlementType: string }>();
    const assignedByName = new Map<string, { entitlementId: string; entitlementType: string }>();
    const freeEntitlements: Array<{ entitlementId: string; entitlementType: string }> = [];
    for (const row of entitlementRows) {
      const entitlement = {
        entitlementId: row.entitlementId as string,
        entitlementType: row.entitlementType,
      };
      const hasAssignee = Boolean(row.userId || row.contactEmail || row.displayName) && row.assignmentStatus !== "unassigned";
      if (hasAssignee) {
        if (row.userId) assignedByUserId.set(row.userId, entitlement);
        const email = normalize(row.contactEmail);
        if (email && !assignedByEmail.has(email)) assignedByEmail.set(email, entitlement);
        const name = normalize(row.displayName);
        if (name && !assignedByName.has(name)) assignedByName.set(name, entitlement);
      } else {
        freeEntitlements.push(entitlement);
      }
    }

    const label = info
      ? `${info.conferenceName} (${info.conferenceYear}-${info.conferenceEditionCode})`
      : "Current conference";
    return {
      conferenceId,
      label,
      assignedByUserId,
      assignedByEmail,
      assignedByName,
      registrationAssignedUserIds,
      registrationAssignedByEmail,
      registrationAssignedByName,
      freeEntitlements,
      totalSeats: entitlementRows.length,
    };
  }, [conferenceAttendance]);

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

  const handleAttendanceToggle = async (contact: VisibleContact, checked: boolean) => {
    if (!canEditConferenceAttendance || !currentConference.conferenceId) return;
    const orgUser = resolveOrgUserForContact(contact);
    const contactEmail = normalize((contact.work_email ?? contact.email ?? "").toString());
    const contactName = normalize((contact.name ?? "").toString());
    const assigned =
      (orgUser ? currentConference.assignedByUserId.get(orgUser.userId) : undefined) ||
      (contactEmail ? currentConference.assignedByEmail.get(contactEmail) : undefined) ||
      (contactName ? currentConference.assignedByName.get(contactName) : undefined);
    const registrationAssigned = Boolean(
      (orgUser && currentConference.registrationAssignedUserIds.has(orgUser.userId)) ||
      (contactEmail && currentConference.registrationAssignedByEmail.has(contactEmail)) ||
      (contactName && currentConference.registrationAssignedByName.has(contactName))
    );

    setSavingContactId(contact.id);
    setAttendanceError(null);
    try {
      if (checked) {
        if (assigned || registrationAssigned) return;
        if (!orgUser) {
          setAttendanceError("Unable to match this row to an org user for assignment.");
          return;
        }
        const nextEntitlement = currentConference.freeEntitlements[0];
        if (!nextEntitlement) {
          setAttendanceError("All available conference seats are already assigned.");
          return;
        }
        const result = await assignConferenceEntitlement(
          currentConference.conferenceId,
          organization.id,
          nextEntitlement.entitlementId,
          {
            entitlementType: nextEntitlement.entitlementType,
            targetUserId: orgUser.userId,
          }
        );
        if (!result.success) {
          setAttendanceError(result.error ?? "Failed to assign conference attendance.");
          return;
        }
      } else {
        if (registrationAssigned) return;
        if (!assigned) return;
        const dispositionInput = window.prompt(
          "Unassign conference attendance:\n- Type HOLD to keep the seat for reassignment.\n- Type REFUND to release the seat and issue refund.",
          "HOLD"
        );
        if (!dispositionInput) return;
        const normalizedDisposition = dispositionInput.trim().toUpperCase();
        if (normalizedDisposition !== "HOLD" && normalizedDisposition !== "REFUND") {
          setAttendanceError("Cancelled. Use HOLD or REFUND when unassigning attendance.");
          return;
        }
        const result = await unassignConferenceEntitlementWithDisposition(
          currentConference.conferenceId,
          organization.id,
          assigned.entitlementId,
          normalizedDisposition === "REFUND" ? "release_and_refund" : "hold_for_reassignment"
        );
        if (!result.success) {
          setAttendanceError(result.error ?? "Failed to unassign conference attendance.");
          return;
        }
        if (normalizedDisposition === "REFUND" && result.data?.refundAmountCents) {
          window.alert(
            `Seat released and refund submitted for ${(result.data.refundAmountCents / 100).toFixed(2)}.`
          );
        }
      }
      router.refresh();
    } finally {
      setSavingContactId(null);
    }
  };

  const getAttendanceCell = (contact: VisibleContact) => {
    const matchedUser = resolveOrgUserForContact(contact);
    const contactEmail = normalize((contact.work_email ?? contact.email ?? "").toString());
    const contactName = normalize((contact.name ?? "").toString());
    const assignedContext =
      (matchedUser ? currentConference.assignedByUserId.get(matchedUser.userId) : undefined) ||
      (contactEmail ? currentConference.assignedByEmail.get(contactEmail) : undefined) ||
      (contactName ? currentConference.assignedByName.get(contactName) : undefined);
    const registrationAssigned = Boolean(
      (matchedUser && currentConference.registrationAssignedUserIds.has(matchedUser.userId)) ||
      (contactEmail && currentConference.registrationAssignedByEmail.has(contactEmail)) ||
      (contactName && currentConference.registrationAssignedByName.has(contactName))
    );
    const hasFreeSeats = currentConference.freeEntitlements.length > 0;
    const checked = Boolean(assignedContext) || registrationAssigned;
    const canToggle =
      Boolean(currentConference.conferenceId) &&
      (Boolean(assignedContext) || Boolean(matchedUser) || registrationAssigned);
    const disabledForAssign = !checked && (!hasFreeSeats || !matchedUser);
    const disabled =
      !canEditConferenceAttendance ||
      !canToggle ||
      registrationAssigned ||
      savingContactId === contact.id ||
      disabledForAssign;
    return { checked, disabled };
  };

  // Get primary color (first brand color, or fallback to partner blue)
  const rawPrimaryColor = brandColors[0]?.hex || "#1E3A5F";
  const primaryColor = rawPrimaryColor.startsWith("#") ? rawPrimaryColor : `#${rawPrimaryColor}`;

  const heroImage = organization.hero_image_url ?? null;
  const backgroundImage = organization.banner_url ?? null;

  // Get primary contact (first contact in list)
  const primaryContact = contacts[0] || null;

  // Parse categories from optimistic state (updates immediately after editor save)
  const categories = categoryValue
    ? categoryValue.split(",").map((c) => c.trim()).filter(Boolean)
    : [];
  const groupedCategories = groupCategories(categories);

  // Partner-specific marketing fields (typed) + NACS taxonomy (cast — added via migration)
  const highlightProductName = organization.highlight_product_name ?? null;
  const highlightProductDescription = organization.highlight_product_description ?? null;
  const highlightTheDeal = organization.highlight_the_deal ?? null;
  const orgExtra = organization as Record<string, unknown>;
  const nacsDepartment = (orgExtra.nacs_department as string | null) ?? null;
  const nacsClasses = (orgExtra.nacs_classes as string[] | null) ?? null;

  return (
    <div className="min-h-screen bg-[#EEEEF0] font-[family-name:var(--font-raleway)]" data-org-id={organization.id}>
      {/* Desktop Layout */}
      <div className="hidden lg:flex min-h-screen">

        {/* Left visual panel — sticky, exactly viewport height */}
        <div
          className="sticky top-0 h-screen flex-shrink-0 relative overflow-hidden"
          style={{ width: '51.61vw' }}
        >
          {/* Background image layer — behind hero strip and product overlay */}
          <div
            className="absolute inset-0 overflow-hidden group"
            data-onboarding="profile_background"
            data-flaggable
            data-field="organizations.banner_url"
            data-entity-id={organization.id}
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

          {/* Colorized Hero Strip — vw units so position is always relative to viewport */}
          <div
            className="absolute top-0 bottom-0 overflow-hidden group"
            style={{ left: '14.71vw', width: '23.79vw' }}
            data-onboarding="profile_hero"
            data-flaggable
            data-field="organizations.hero_image_url"
            data-entity-id={organization.id}
          >
            {heroImage ? (
              <ColorizedImage
                src={heroImage}
                color={primaryColor}
                alt={`${organization.name} product`}
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

          {/* Product Overlay — anchored to bottom of the viewport panel */}
          {(organization.product_overlay_url || (editMode && canEditThisOrg)) && (
            <div
              className="absolute z-20 pointer-events-auto flex items-center justify-center group"
              style={{ left: '5.64vw', bottom: '0', width: '42.09vw', height: '42.09vw' }}
              data-flaggable
              data-field="organizations.product_overlay_url"
              data-entity-id={organization.id}
            >
              {organization.product_overlay_url ? (
                <Image
                  src={organization.product_overlay_url}
                  alt="Featured product"
                  width={2301}
                  height={2301}
                  className="max-w-full max-h-full object-contain"
                  style={{ filter: "drop-shadow(0 25px 50px rgba(0,0,0,0.4))" }}
                  unoptimized
                />
              ) : null}
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
        </div>

        {/* Content Area — scrolls while left panel stays fixed */}
        <div
          className="relative z-10 flex-1 min-w-0"
          style={{
            paddingRight: '8.78vw',
            paddingTop: '108px',
            paddingBottom: '64px',
          }}
        >
          {/* Logo — 560x155px area */}
          <div style={{ width: '560px', height: '155px', marginBottom: '62px' }} data-onboarding="profile_logo" data-flaggable data-field="organizations.logo_horizontal_url" data-entity-id={organization.id}>
            {(organization.logo_horizontal_url || organization.logo_url) ? (
              <Image
                src={(organization.logo_horizontal_url || organization.logo_url) as string}
                alt={organization.name}
                width={560}
                height={155}
                className="w-full h-full object-contain object-left"
                unoptimized
              />
            ) : (
              <h1 className="text-4xl lg:text-6xl font-bold tracking-tight leading-[0.9] text-[#1A1A1A]">
                {organization.name.toUpperCase()}
              </h1>
            )}
          </div>

          {/* Categories — primary prominent, secondaries below */}
          {(categories.length > 0 || (editMode && canEditThisOrg)) && (
            <div className="mb-10 space-y-3" data-onboarding="profile_categories">
              {groupedCategories.map((group, i) => (
                <div key={group.parent}>
                  {/* Parent badge */}
                  <div className="flex items-center gap-3 mb-2">
                    {i === 0 ? (
                      <span
                        className="px-5 py-1.5 rounded-full text-sm font-semibold uppercase tracking-wider bg-transparent"
                        style={{ color: primaryColor, boxShadow: `0 0 0 2px white, 0 0 0 4px ${primaryColor}` }}
                      >
                        {group.parent}
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-full text-xs font-medium text-gray-500 border border-gray-300 bg-white/60">
                        {group.parent}
                      </span>
                    )}
                    {i === 0 && editMode && canEditThisOrg && (
                      <button
                        onClick={() => setShowCategoryEditor(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-dashed border-gray-300 text-gray-400 hover:border-gray-500 hover:text-gray-600 transition-colors bg-transparent"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        Edit
                      </button>
                    )}
                  </div>
                  {/* Subcategory chips */}
                  {group.subs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 ml-1">
                      {group.subs.map((sub) => (
                        <span
                          key={sub}
                          className="px-2.5 py-0.5 rounded-full text-xs text-gray-500 bg-gray-100 border border-gray-200"
                        >
                          {sub}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {/* Empty state edit button */}
              {categories.length === 0 && editMode && canEditThisOrg && (
                <button
                  onClick={() => setShowCategoryEditor(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-dashed border-gray-300 text-gray-400 hover:border-gray-500 hover:text-gray-600 transition-colors"
                >
                  Add categories
                </button>
              )}
            </div>
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

          {/* Store Contact — Members and above can see — partners and public are gated */}
          {primaryContact && (
            <ProtectedSection
              bypass={isOwnOrgPage}
              requiredPermission="member"
            >
              <div className="mb-10">
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                  Store Contact
                </h3>
                <div className="flex flex-wrap gap-8 text-gray-500">
                  <span data-flaggable data-field="contacts.work_email" data-entity-id={primaryContact.id}>
                    {renderContactField(primaryContact.work_email as string | null, primaryContact.email as string | null, "email")}
                  </span>
                  <span data-flaggable data-field="contacts.work_phone_number" data-entity-id={primaryContact.id}>
                    {renderContactField(primaryContact.work_phone_number as string | null, primaryContact.phone as string | null, "phone")}
                  </span>
                  <span data-flaggable data-field="organizations.website" data-entity-id={organization.id}>
                    {organization.website ? (
                      <a
                        href={(organization.website as string).startsWith('http') ? (organization.website as string) : `https://${organization.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-[#1A1A1A] transition-colors"
                      >
                        {organization.website as string}
                      </a>
                    ) : "—"}
                  </span>
                </div>
              </div>
            </ProtectedSection>
          )}

          {/* Description */}
          {organization.company_description && (
            <div className="mb-10" data-onboarding="profile_description">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                Description
              </h3>
              <p className="text-gray-600 leading-relaxed" data-flaggable data-field="organizations.company_description" data-entity-id={organization.id}>
                {organization.company_description}
              </p>
            </div>
          )}

          {/* Certifications + CANCOLL badges */}
          {(certifications.length > 0 || cancollMember || (editMode && (isOrgAdminForThisOrg || isAdmin))) && (
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-3">
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
                  Certifications
                </h3>
                {(certSaving || cancollSaving) && (
                  <span className="text-[10px] text-gray-400">Saving…</span>
                )}
              </div>

              {editMode && (isOrgAdminForThisOrg || isAdmin) ? (
                <div className="flex flex-wrap gap-3">
                  {/* Self-declared certifications */}
                  {CERTIFICATIONS.map((cert) => {
                    const active = certifications.includes(cert.name);
                    return (
                      <button
                        key={cert.slug}
                        type="button"
                        onClick={() => handleToggleCertification(cert.name)}
                        disabled={certSaving}
                        className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border transition-all ${
                          active
                            ? "bg-gray-900 text-white border-gray-900"
                            : "bg-white text-gray-500 border-gray-300 hover:border-gray-500"
                        }`}
                      >
                        <img src={`/certifications/${cert.slug}.svg`} alt="" className="w-5 h-5 rounded-full" />
                        {cert.name}
                        {active && <span className="text-white/70">✓</span>}
                      </button>
                    );
                  })}
                  {/* CANCOLL — admin-only toggle */}
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={async () => {
                        const next = !cancollMember;
                        setCancollMember(next);
                        setCancollSaving(true);
                        await updateCancollStatus(organization.id, next);
                        setCancollSaving(false);
                      }}
                      disabled={cancollSaving}
                      className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border transition-all ${
                        cancollMember
                          ? "bg-gray-900 text-white border-gray-900"
                          : "bg-white text-gray-500 border-gray-300 hover:border-gray-500"
                      }`}
                    >
                      <img src="/certifications/CANCOLL.jpeg" alt="" className="w-5 h-5 rounded-full object-cover" />
                      CANCOLL
                      {cancollMember && <span className="text-white/70">✓</span>}
                    </button>
                  )}
                </div>
              ) : (
                /* View mode */
                <CertificationBadges
                  certifications={certifications}
                  size="md"
                  showCancoll={cancollMember && (viewerLevel === "member" || viewerLevel === "org_admin" || viewerLevel === "admin" || viewerLevel === "super_admin")}
                />
              )}
            </div>
          )}

          {/* Featured Product */}
          {highlightProductName && (
            <div className="mb-10" data-onboarding="profile_featured_product">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                Featured Product
              </h3>
              <p
                className="text-base font-semibold mb-1"
                style={{ color: primaryColor }}
                data-flaggable
                data-field="organizations.highlight_product_name"
                data-entity-id={organization.id}
              >
                {highlightProductName}
              </p>
              {highlightProductDescription && (
                <p
                  className="text-gray-600 leading-relaxed"
                  data-flaggable
                  data-field="organizations.highlight_product_description"
                  data-entity-id={organization.id}
                >
                  {highlightProductDescription}
                </p>
              )}
            </div>
          )}

          {/* Current Offer */}
          {highlightTheDeal && (
            <div
              className="mb-10 px-5 py-4 rounded-xl border"
              style={{ borderColor: primaryColor + "40", backgroundColor: primaryColor + "0D" }}
            >
              <p className="text-xs uppercase tracking-wider font-semibold mb-1" style={{ color: primaryColor }}>
                Current Offer
              </p>
              <p
                className="text-gray-700 text-sm leading-relaxed"
                data-flaggable
                data-field="organizations.highlight_the_deal"
                data-entity-id={organization.id}
              >
                {highlightTheDeal}
              </p>
            </div>
          )}

          {/* Links & Documents */}
          <div className="mb-12" data-onboarding="partner_links">
            <PartnerLinksSection
              orgId={organization.id}
              orgName={organization.name}
              primaryColor={primaryColor}
              viewerLevel={viewerLevel}
              visibleLinks={visibleLinks}
              hasGated={hasGatedLinks}
              rawLinks={rawLinks}
              canEdit={canEditLinks}
            />
          </div>

          {/* Your Market — inline top 10, org members only */}
          {partnerMarket && partnerMarket.topMatches.length > 0 && (
            <div className="mb-12">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">Your Market</h3>
                <span className="text-xs text-gray-400">{partnerMarket.totalMatches} stores</span>
              </div>
              <div className="space-y-1.5">
                {partnerMarket.topMatches.map((match) => {
                  const contact = match.buyer ?? match.primaryContact;
                  return (
                    <div key={match.orgId} className="flex items-start gap-2.5 rounded-lg border border-gray-100 px-3 py-2.5 hover:border-gray-200 hover:bg-gray-50/50 transition-all">
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${match.confidence === "high" ? "bg-green-500" : match.confidence === "medium" ? "bg-amber-400" : "bg-gray-300"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <a href={`/org/${match.orgSlug}`} className="text-xs font-semibold text-[#1A1A1A] hover:text-[#EE2A2E] transition-colors">{match.orgName}</a>
                          {match.province && <span className="text-[10px] text-gray-400">{match.province}</span>}
                        </div>
                        {contact && (
                          <p className="text-[10px] text-gray-500 mt-0.5 truncate">
                            {contact.name ?? ""}
                            {contact.email && <span className="text-gray-400"> · {contact.email}</span>}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Staffing/Contacts Table — Members and above can see — partners and public are gated */}
          {(contacts.length > 0 || (editMode && canEditThisOrg)) && (
            <ProtectedSection
              bypass={isOwnOrgPage}
              requiredPermission="member"
            >
              <div>
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
                  Staffing
                </h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                      <th className="pb-2 pr-4 font-semibold">Name</th>
                      <th className="pb-2 pr-4 font-semibold">Email</th>
                      <th className="pb-2 pr-4 font-semibold">Role</th>
                      <th className="pb-2 pr-4 font-semibold">Phone</th>
                      <th className="pb-2 pl-3 font-semibold">Attending Conference</th>
                      {editMode && canEditThisOrg ? <th className="pb-2 pl-4 font-semibold">Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map((contact) => (
                      (() => {
                        const attendance = getAttendanceCell(contact);
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
                            isMaskedValue(contact.name as string) ? <BlurredField maskedValue={contact.name as string} /> : (contact.name as string)
                          ) : "—"}
                        </td>
                        <td className="py-2 pr-4 text-gray-400" {...(!editMode ? fieldProps("contacts", "work_email", contact.id, organization.id) : {})}>
                          {renderContactField(contact.work_email as string | null, contact.email as string | null, "email")}
                        </td>
                        <td className="py-2 pr-4 text-gray-400" {...(!editMode ? fieldProps("contacts", "role_title", contact.id, organization.id) : {})}>
                          {contact.role_title ? (contact.role_title as string) : "—"}
                        </td>
                        <td className="py-2 text-gray-400" {...(!editMode ? fieldProps("contacts", "work_phone_number", contact.id, organization.id) : {})}>
                          {renderContactField(contact.work_phone_number as string | null, contact.phone as string | null, "phone")}
                        </td>
                        <td className="py-2 pl-3 text-xs" onClick={(e) => e.stopPropagation()} /* conference checkbox — intentional */>
                          <input
                            type="checkbox"
                            aria-label={`Attending conference for ${contact.name ?? "contact"}`}
                            checked={attendance.checked}
                            disabled={attendance.disabled}
                            onChange={(event) => void handleAttendanceToggle(contact, event.target.checked)}
                            className="h-4 w-4"
                          />
                        </td>
                        {/* Delete button - only visible in edit mode */}
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
                        <td colSpan={6} className="py-3 text-center text-emerald-600 font-medium">
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
              </div>
            </ProtectedSection>
          )}

        </div>
        {/* end content area */}
      </div>
      {/* end desktop flex */}

      {/* Mobile Layout */}
      <div className="lg:hidden">
        <div className="h-64 relative overflow-hidden">
          {heroImage ? (
            <ColorizedImage
              src={heroImage}
              color={primaryColor}
              alt={`${organization.name} product`}
              className="w-full h-full"
              intensity={0.6}
            />
          ) : (
            <div className="w-full h-full" style={{ backgroundColor: primaryColor }} />
          )}
          {organization.product_overlay_url && (
            <div className="absolute bottom-0 left-4 translate-y-1/3">
              <Image
                src={organization.product_overlay_url}
                alt="Featured product"
                width={160}
                height={200}
                className="object-contain"
                style={{ filter: "drop-shadow(0 15px 30px rgba(0,0,0,0.4))" }}
                unoptimized
              />
            </div>
          )}
        </div>

        <div className="p-8">
          {/* Logo */}
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
                {organization.name.toUpperCase()}
              </h1>
            )}
          </div>

          {/* Categories — grouped with subcategories */}
          {(categories.length > 0 || (editMode && canEditThisOrg)) && (
            <div className="mb-6 space-y-2">
              {groupedCategories.map((group, i) => (
                <div key={group.parent}>
                  <div className="flex items-center gap-2 mb-1.5">
                    {i === 0 ? (
                      <span
                        className="px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-transparent"
                        style={{ color: primaryColor, boxShadow: `0 0 0 2px white, 0 0 0 3px ${primaryColor}` }}
                      >
                        {group.parent}
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-full text-xs font-medium text-gray-500 border border-gray-300 bg-white/60">
                        {group.parent}
                      </span>
                    )}
                    {i === 0 && editMode && canEditThisOrg && (
                      <button
                        onClick={() => setShowCategoryEditor(true)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border border-dashed border-gray-300 text-gray-400 hover:border-gray-500 hover:text-gray-600 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        Edit
                      </button>
                    )}
                  </div>
                  {group.subs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 ml-1">
                      {group.subs.map((sub) => (
                        <span key={sub} className="px-2 py-0.5 rounded-full text-xs text-gray-500 bg-gray-100 border border-gray-200">
                          {sub}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {categories.length === 0 && editMode && canEditThisOrg && (
                <button onClick={() => setShowCategoryEditor(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-dashed border-gray-300 text-gray-400 hover:border-gray-500 hover:text-gray-600 transition-colors">
                  Add categories
                </button>
              )}
            </div>
          )}

          {/* Store Contact — Members and above can see */}
          {primaryContact && (
            <ProtectedSection
              bypass={isOwnOrgPage}
              requiredPermission="member"
            >
              <div className="mb-8">
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                  Store Contact
                </h3>
                <div className="flex flex-wrap gap-4 text-gray-500 text-sm">
                  <span data-flaggable data-field="contacts.work_email" data-entity-id={primaryContact.id}>
                    {renderContactField(primaryContact.work_email as string | null, primaryContact.email as string | null, "email")}
                  </span>
                  <span data-flaggable data-field="contacts.work_phone_number" data-entity-id={primaryContact.id}>
                    {renderContactField(primaryContact.work_phone_number as string | null, primaryContact.phone as string | null, "phone")}
                  </span>
                  <span data-flaggable data-field="organizations.website" data-entity-id={organization.id}>
                    {organization.website ? (
                      <a href={(organization.website as string).startsWith('http') ? (organization.website as string) : `https://${organization.website}`} target="_blank" rel="noopener noreferrer" className="hover:text-[#1A1A1A] transition-colors">{organization.website as string}</a>
                    ) : "—"}
                  </span>
                </div>
              </div>
            </ProtectedSection>
          )}

          {/* Description */}
          {organization.company_description && (
            <div className="mb-8">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                Description
              </h3>
              <p className="text-gray-600 text-sm leading-relaxed" data-flaggable data-field="organizations.company_description" data-entity-id={organization.id}>
                {organization.company_description}
              </p>
            </div>
          )}

          {/* Featured Product */}
          {highlightProductName && (
            <div className="mb-6">
              <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">
                Featured Product
              </h3>
              <p className="text-sm font-semibold mb-1" style={{ color: primaryColor }}>
                {highlightProductName}
              </p>
              {highlightProductDescription && (
                <p className="text-gray-600 text-sm leading-relaxed">{highlightProductDescription}</p>
              )}
            </div>
          )}

          {/* Current Offer */}
          {highlightTheDeal && (
            <div
              className="mb-6 px-4 py-3 rounded-xl border"
              style={{ borderColor: primaryColor + "40", backgroundColor: primaryColor + "0D" }}
            >
              <p className="text-xs uppercase tracking-wider font-semibold mb-1" style={{ color: primaryColor }}>
                Current Offer
              </p>
              <p className="text-gray-700 text-sm leading-relaxed">{highlightTheDeal}</p>
            </div>
          )}

          {/* Links & Documents */}
          <div className="mb-8">
            <PartnerLinksSection
              orgId={organization.id}
              orgName={organization.name}
              primaryColor={primaryColor}
              viewerLevel={viewerLevel}
              visibleLinks={visibleLinks}
              hasGated={hasGatedLinks}
              rawLinks={rawLinks}
              canEdit={canEditLinks}
            />
          </div>

          {/* Staffing — Names visible, contact details blurred for public */}
          {(contacts.length > 0 || (editMode && canEditThisOrg)) && (
            <ProtectedSection
              bypass={isOwnOrgPage}
              requiredPermission="member"
            >
              <div>
                <h3 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-4">
                  Staffing
                </h3>
                <div className="space-y-3">
                  {contacts.map((contact) => (
                    (() => {
                      const attendance = getAttendanceCell(contact);
                      return (
                    <div
                      key={contact.id}
                      className={`border-b border-gray-200 pb-3 flex justify-between items-start ${isContactHidden(contact) ? "opacity-50" : ""}`}
                      data-flaggable
                    >
                      <div className={(editMode && canEditThisOrg) || isOwnContact(contact) ? "flex-1 cursor-pointer" : "flex-1"} onClick={(editMode && canEditThisOrg) || isOwnContact(contact) ? () => setEditingContact(contact) : undefined}>
                        <div className="font-medium text-[#1A1A1A]" {...fieldProps("contacts", "name", contact.id, organization.id)}>
                          {contact.name ? (
                            isMaskedValue(contact.name as string) ? <BlurredField maskedValue={contact.name as string} /> : (contact.name as string)
                          ) : "—"}
                        </div>
                        <div className="text-sm text-gray-400" {...fieldProps("contacts", "role_title", contact.id, organization.id)}>
                          {contact.role_title ? (contact.role_title as string) : "—"}
                        </div>
                        <div className="text-sm text-gray-400" {...fieldProps("contacts", "work_email", contact.id, organization.id)}>
                          {renderContactField(contact.work_email as string | null, contact.email as string | null, "email")}
                        </div>
                        <div className="text-xs mt-1 font-medium">
                          <label className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <span>Attending Conference</span>
                            <input
                              type="checkbox"
                              aria-label={`Attending conference for ${contact.name ?? "contact"}`}
                              checked={attendance.checked}
                              disabled={attendance.disabled}
                              onChange={(event) => void handleAttendanceToggle(contact, event.target.checked)}
                              className="h-4 w-4"
                            />
                          </label>
                        </div>
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
              </div>
            </ProtectedSection>
          )}

        </div>
      </div>

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

      {/* Market intelligence — org admin only */}
      {partnerMarket && (
        <PartnerMarketPanel
          market={partnerMarket}
          canNudge={canNudge}
          nudgeAvailableAt={nudgeAvailableAt}
        />
      )}

      {/* Open RFPs in this partner's categories */}
      {partnerRFPs.length > 0 && (
        <div className="bg-white border-t border-gray-200">
          <div className="max-w-7xl mx-auto px-8 py-12">
            <PartnerRFPFeed rfps={partnerRFPs} />
          </div>
        </div>
      )}

      {/* Contact edit modal */}
      {editingContact && (
        <ContactEditModal
          contact={editingContact}
          organizationId={organization.id}
          isHidden={isContactHidden(editingContact)}
          onToggleHidden={() => void handleToggleContactHidden(editingContact)}
          onClose={() => setEditingContact(null)}
        />
      )}

      {/* Category editor modal */}
      {showCategoryEditor && (
        <CategoryEditor
          orgId={organization.id}
          orgName={organization.name}
          currentValue={categoryValue}
          primaryColor={primaryColor}
          nacsDepartment={nacsDepartment}
          nacsClasses={nacsClasses}
          onClose={() => setShowCategoryEditor(false)}
          onSaved={(newValue) => {
            setCategoryValue(newValue || null);
            setShowCategoryEditor(false);
          }}
        />
      )}
    </div>
  );

}
