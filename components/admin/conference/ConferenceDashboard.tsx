"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Database } from "@/lib/database.types";
import type { SwapRequestSummary } from "@/lib/scheduler/types";
import ConferenceOverview from "./ConferenceOverview";
import ConferenceForm from "./ConferenceForm";
import ScheduleDesignWizard from "./ScheduleDesignWizard";
import ConferenceScheduleDesigner from "./ConferenceScheduleDesigner";
import ProductManager from "./ProductManager";
import RegistrationsTable from "./RegistrationsTable";
import LegalManager from "./LegalManager";
import StatusControls from "./StatusControls";
import WishlistQueue from "./WishlistQueue";
import BillingRunsPanel from "./BillingRunsPanel";
import SwapRequestsPanel from "./SwapRequestsPanel";

type ConferenceRow = Database["public"]["Tables"]["conference_instances"]["Row"];
type ParamsRow = Database["public"]["Tables"]["conference_parameters"]["Row"];
type ProductRow = Database["public"]["Tables"]["conference_products"]["Row"];
type ConferenceProgramItem = {
  id: string;
  conference_id: string;
  item_type:
    | "meeting"
    | "meal"
    | "education"
    | "trade_show"
    | "offsite"
    | "move_in"
    | "move_out"
    | "custom";
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  location_label: string | null;
  audience_mode: "all_attendees" | "target_roles" | "manual_curated";
  target_roles: string[];
  is_required: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
};
type ConferenceScheduleModuleRow = {
  id: string;
  conference_id: string;
  module_key:
    | "meetings"
    | "trade_show"
    | "education"
    | "meals"
    | "offsite"
    | "custom"
    | "registration_ops"
    | "communications"
    | "sponsorship_ops"
    | "logistics"
    | "travel_accommodation"
    | "content_capture"
    | "lead_capture"
    | "compliance_safety"
    | "staffing"
    | "post_event"
    | "virtual_hybrid"
    | "expo_floor_plan";
  enabled: boolean;
  config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

interface ConferenceDashboardProps {
  conference: ConferenceRow & {
    conference_parameters: ParamsRow[];
    conference_products: ProductRow[];
  };
  initialWishlistRows: Array<
    Database["public"]["Tables"]["wishlist_intents"]["Row"] & {
      organization_name: string | null;
      product_name: string | null;
    }
  >;
  initialBillingRuns: Array<
    Database["public"]["Tables"]["billing_runs"]["Row"] & {
      triggered_by_email: string | null;
    }
  >;
  initialBillingAttempts: Array<
    Database["public"]["Tables"]["wishlist_billing_attempts"]["Row"] & {
      organization_name: string | null;
      product_name: string | null;
    }
  >;
  initialSwapRequests: SwapRequestSummary[];
  initialSwapCapIncreaseRequests: Database["public"]["Tables"]["swap_cap_increase_requests"]["Row"][];
  canSuperAdminOverride: boolean;
  googleMapsApiKey: string | null;
  initialProgramItems: ConferenceProgramItem[];
  initialScheduleModules: ConferenceScheduleModuleRow[];
  initialExhibitorOrganizations: Array<{ id: string; name: string }>;
}

const TABS = [
  { id: "details", label: "Details" },
  { id: "setup", label: "Setup" },
  { id: "schedule", label: "Schedule" },
  { id: "overview", label: "Overview" },
  { id: "products", label: "Products" },
  { id: "registrations", label: "Registrations" },
  { id: "legal", label: "Legal" },
  { id: "wishlist", label: "Wishlist" },
  { id: "billing_runs", label: "Billing Runs" },
  { id: "swaps", label: "Swaps" },
  { id: "status", label: "Status Controls" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function ConferenceDashboard({
  conference,
  initialWishlistRows,
  initialBillingRuns,
  initialBillingAttempts,
  initialSwapRequests,
  initialSwapCapIncreaseRequests,
  canSuperAdminOverride,
  googleMapsApiKey,
  initialProgramItems,
  initialScheduleModules,
  initialExhibitorOrganizations,
}: ConferenceDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<TabId>(() =>
    initialTab && TABS.some((candidate) => candidate.id === initialTab)
      ? (initialTab as TabId)
      : "details"
  );
  const [products, setProducts] = useState<ProductRow[]>(conference.conference_products ?? []);
  const setActiveTabWithUrl = (tabId: TabId) => {
    setActiveTab(tabId);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", tabId);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  };

  const params = conference.conference_parameters?.[0] ?? null;

  return (
    <div>
      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{conference.name}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {conference.year} &middot; Edition {conference.edition_code}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/conference/${conference.id}/badges`}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Badge Ops
            </Link>
            <Link
              href={`/admin/conference/${conference.id}/check-in`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-[#D60001] bg-[#D60001] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001]"
            >
              Open Check-in Desk
            </Link>
            <Link
              href={`/admin/conference/${conference.id}/war-room`}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Open People Lookup
            </Link>
            <Link
              href={`/admin/conference/${conference.id}/schedule-ops`}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Schedule Ops
            </Link>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex gap-6" aria-label="Conference tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTabWithUrl(tab.id)}
              className={`py-2 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-[#D60001] text-[#D60001]"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === "details" && (
        <ConferenceForm
          conference={conference}
          canSuperAdminOverride={canSuperAdminOverride}
          googleMapsApiKey={googleMapsApiKey}
        />
      )}
      {activeTab === "overview" && (
        <ConferenceOverview conference={conference} params={params} productCount={products.length} />
      )}
      {activeTab === "setup" && (
        <ScheduleDesignWizard
          conferenceId={conference.id}
          params={params}
          initialModules={initialScheduleModules}
          conferenceStartDate={conference.start_date}
          conferenceEndDate={conference.end_date}
          conferenceRegistrationOpenAt={conference.registration_open_at}
          conferenceRegistrationCloseAt={conference.registration_close_at}
          googleMapsApiKey={googleMapsApiKey}
          initialProducts={products}
        />
      )}
      {activeTab === "schedule" && (
        <ConferenceScheduleDesigner
          conferenceId={conference.id}
          initialProgramItems={initialProgramItems}
          params={params}
          modules={initialScheduleModules}
          conferenceTimeZone={conference.timezone}
          initialExhibitorOrganizations={initialExhibitorOrganizations}
        />
      )}
      {activeTab === "products" && (
        <ProductManager
          conferenceId={conference.id}
          initialProducts={products}
          initialScheduleModules={initialScheduleModules}
          onProductsChange={setProducts}
        />
      )}
      {activeTab === "registrations" && (
        <RegistrationsTable conferenceId={conference.id} />
      )}
      {activeTab === "legal" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Link
              href={`/admin/conference/${conference.id}/legal`}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Open Legal Page
            </Link>
          </div>
          <LegalManager conferenceId={conference.id} />
        </div>
      )}
      {activeTab === "wishlist" && (
        <WishlistQueue conferenceId={conference.id} initialRows={initialWishlistRows} />
      )}
      {activeTab === "billing_runs" && (
        <BillingRunsPanel
          conferenceId={conference.id}
          initialRuns={initialBillingRuns}
          initialAttempts={initialBillingAttempts}
        />
      )}
      {activeTab === "swaps" && (
        <SwapRequestsPanel
          conferenceId={conference.id}
          initialSwapRequests={initialSwapRequests}
          initialCapIncreaseRequests={initialSwapCapIncreaseRequests}
        />
      )}
      {activeTab === "status" && (
        <StatusControls conference={conference} />
      )}
    </div>
  );
}
