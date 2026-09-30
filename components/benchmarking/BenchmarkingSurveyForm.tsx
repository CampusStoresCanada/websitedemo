"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { formatDeadline } from "@/lib/benchmarking/deadline";
import type { Benchmarking, DeltaFlag } from "@/lib/types/db";
import {
  saveBenchmarkingField,
  submitBenchmarkingSurvey,
  amendBenchmarkingSurvey,
  saveDeltaFlag,
} from "@/lib/actions/benchmarking-survey";
import type { SurveyFieldConfig } from "@/lib/benchmarking/default-field-config";
import { DEFAULT_FIELD_CONFIG } from "@/lib/benchmarking/default-field-config";
import DynamicSurveySection from "./DynamicSurveySection";
import RespondentPicker from "./RespondentPicker";
import LocationsEditor from "./LocationsEditor";
import KeyDatesEditor from "./KeyDatesEditor";
import ServicesJourney from "./ServicesJourney";
import LogoConfirm from "./LogoConfirm";
import CategorySales from "./CategorySales";
import OtherIncomeEditor from "./OtherIncomeEditor";
import OtherExpensesEditor from "./OtherExpensesEditor";
import StaffingEditor from "./StaffingEditor";
import ReviewFinancials from "./ReviewFinancials";
import ReviewAllAnswers from "./ReviewAllAnswers";
import CompetitorsEditor from "./CompetitorsEditor";
import SocialOwner, { isInternalSocialAnswer } from "./SocialOwner";
import WagesAndBenefits from "./WagesAndBenefits";
import type { CompetitorRow } from "@/lib/actions/benchmarking-competitors";
import { matchesShowIf } from "@/lib/benchmarking/show-if";
import type { SurveyCategory } from "@/lib/actions/benchmarking-categories";
import type {
  OtherIncomeRow,
  OtherExpenseRow,
  StaffRow,
} from "@/lib/actions/benchmarking-financials";
import {
  NAMED_EXPENSE_LINES,
  categorySalesTotal,
  sumFields,
} from "@/lib/benchmarking/financial-lines";
import type { KeyDate } from "@/lib/actions/benchmarking-profile";
import type { ServiceStatus } from "@/lib/benchmarking/key-dates";
import type { SurveyLocation } from "@/lib/actions/benchmarking-locations";
import type { StoreContact } from "@/lib/actions/benchmarking-respondent";
import { parseUTC } from "@/lib/utils";

interface BenchmarkingSurveyFormProps {
  benchmarkingId: string;
  fiscalYear: number;
  organizationId: string;
  organizationName: string;
  organizationProvince: string;
  currentData: Benchmarking;
  priorYearData: Benchmarking | null;
  deltaFlags: DeltaFlag[];
  surveyClosesAt: string | null;
  fieldConfig?: SurveyFieldConfig | null;
  /** The store's known people, for the "who is filling this in" picker. */
  storeContacts?: StoreContact[];
  /** Per-location square footage — see LocationsEditor. */
  locations?: SurveyLocation[];
  /** Section 1 answers that live on the organisation, not the submission. */
  keyDates?: KeyDate[];
  /** Dates already on the organisation's profile, offered for adoption. */
  profileKeyDates?: { title: string; date: string }[];
  logos?: { logoUrl: string | null; logoHorizontalUrl: string | null; confirmedAt: string | null };
  /** §2 and §3, both category-driven. */
  gmCategories?: SurveyCategory[];
  cmCategories?: SurveyCategory[];
  /** §4, §7 and §6 — the rows a store adds itself. */
  otherIncome?: OtherIncomeRow[];
  otherExpenses?: OtherExpenseRow[];
  staff?: StaffRow[];
  /** §1 — who else sells to this store's students. */
  competitors?: CompetitorRow[];
}

export default function BenchmarkingSurveyForm({
  benchmarkingId,
  fiscalYear,
  organizationId,
  organizationName,
  organizationProvince,
  currentData,
  priorYearData,
  deltaFlags: initialDeltaFlags,
  surveyClosesAt,
  fieldConfig,
  storeContacts = [],
  locations = [],
  keyDates = [],
  profileKeyDates = [],
  logos,
  gmCategories = [],
  cmCategories = [],
  otherIncome = [],
  otherExpenses = [],
  staff = [],
  competitors = [],
}: BenchmarkingSurveyFormProps) {
  const config = useMemo(
    () => fieldConfig ?? DEFAULT_FIELD_CONFIG,
    [fieldConfig]
  );
  /** Field names the server filled from last year at submission. */
  const [carriedForward, setCarriedForward] = useState<string[]>([]);

  const sections = useMemo(
    () => [...config.sections].sort((a, b) => a.order - b.order),
    [config]
  );

  /**
   * The carried figures, as labels under their section headings.
   *
   * The server returns column names, which mean nothing to the person reading
   * the confirmation — "cm_print_new_total" is not a thing anybody recognises
   * as the number they just filed. Resolve them against the same config that
   * rendered the form, and drop any that no longer appear in it rather than
   * printing a raw column name.
   */
  const carriedForwardBySection = useMemo(() => {
    if (carriedForward.length === 0) return [];
    const wanted = new Set(carriedForward);
    return sections
      .map((section) => ({
        section: section.title,
        labels: section.fields
          .filter((f) => wanted.has(f.name))
          .sort((a, b) => a.order - b.order)
          .map((f) => f.label),
      }))
      .filter((g) => g.labels.length > 0);
  }, [carriedForward, sections]);

  const [activeSection, setActiveSection] = useState(0); // index into sections array
  /** The whole-survey read-through, opened before submitting. */
  const [reviewingAll, setReviewingAll] = useState(false);
  /**
   * True once the store has opened the review, so "Back to review" can appear
   * beside the section they went off to fix. Without it, changing one answer
   * meant walking back through every section in between.
   */
  const [hasReviewed, setHasReviewed] = useState(false);
  /** The field to scroll to and light up when a section opens. */
  const [highlightField, setHighlightField] = useState<string | null>(null);
  const formTopRef = useRef<HTMLDivElement | null>(null);

  const [formData, setFormData] = useState<Record<string, unknown>>(
    currentData as unknown as Record<string, unknown>
  );
  const [deltaFlags, setDeltaFlags] = useState<DeltaFlag[]>(initialDeltaFlags);

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(
    currentData.updated_at ? new Date(currentData.updated_at) : null
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /*
    One pending save PER FIELD, not one for the whole form.

    This was a single shared timeout, cleared on every change — so a second
    field edited within the 800ms window cancelled the first field's save
    outright. Filling in the Square Footage Breakdown by tabbing wrote only the
    last box; the other three looked saved on screen, said "Last saved", and
    were never sent. Found by typing four numbers and reading the row back.

    Keyed by field name, so each debounces against itself and none of them can
    cancel another.
  */
  const saveTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  /*
    Moving between sections puts you at the TOP of the next one.

    Clicking Next left the reader exactly where they were on the page, which on
    a long section is its foot — so the next section opened already scrolled
    past its heading, its description, and often its first two questions.
  */
  const goToSection = useCallback(
    (idx: number, field?: string) => {
      setReviewingAll(false);
      setActiveSection(idx);
      setHighlightField(field ?? null);

      /*
        One scroll, after the new section has actually rendered.

        Both scrolls used to fire inside a single animation frame: the section
        top went first and the field second, and because `smooth` scrolling is
        asynchronous the browser simply abandoned the second one. The field was
        the target that mattered and it was the one that lost, every time.

        Two frames, because the first only guarantees React has committed the
        state change, not that the new section's DOM is laid out — and an
        element with no layout scrolls to the wrong place.
      */
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const target = field ? document.getElementById(`field-${field}`) : null;
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            return;
          }
          formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }),
      );
    },
    [],
  );

  const openReview = useCallback(() => {
    setReviewingAll(true);
    setHasReviewed(true);
    setHighlightField(null);
    requestAnimationFrame(() =>
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }, []);

  const isSubmitted = formData.status === "submitted";
  const isReadOnly = isSubmitted;

  /*
    Running totals for the sections that show the store where it stands before
    asking for the next number. §4 is the first place merchandise and course
    materials are seen together, and §7 is the only place an expense total
    means anything while it is still being typed.
  */
  const merchandiseTotal = useMemo(() => categorySalesTotal(gmCategories), [gmCategories]);
  const courseMaterialsTotal = useMemo(() => categorySalesTotal(cmCategories), [cmCategories]);
  const namedExpenseTotal = useMemo(
    () => sumFields(formData, NAMED_EXPENSE_LINES),
    [formData],
  );

  /**
   * Jump to a section by id — what §8's statement lines do when clicked.
   *
   * Takes an id rather than an index because the index depends on the stored
   * config's ordering, and a review line that lands on the wrong section is
   * worse than one that does nothing.
   */
  const jumpToSection = useCallback(
    (sectionId: string) => {
      const idx = sections.findIndex((section) => section.id === sectionId);
      if (idx >= 0) goToSection(idx);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections],
  );

  // Auto-save a single field with debounce
  const handleFieldChange = useCallback(
    (field: string, value: string | number | boolean | string[] | null) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      setSaveError(null);

      if (isReadOnly) return;

      // Debounce this field against itself.
      const pending = saveTimersRef.current.get(field);
      if (pending) clearTimeout(pending);

      setSaveStatus("saving");
      const timer = setTimeout(async () => {
        saveTimersRef.current.delete(field);
        const result = await saveBenchmarkingField(benchmarkingId, field, value);
        if (result.success) {
          setSaveStatus("saved");
          setLastSaved(new Date());

          // If server returned a corrected value, update local state
          if (result.correctedValue !== undefined) {
            setFormData((prev) => ({ ...prev, [field]: result.correctedValue }));
          }

          // Reset to idle after 3 seconds
          setTimeout(() => setSaveStatus("idle"), 3000);
        } else {
          setSaveStatus("error");
          setSaveError(result.error || "Save failed");
          console.error("Save failed:", result.error);
          // Auto-clear error after 8 seconds
          setTimeout(() => setSaveError(null), 8000);
        }
      }, 800);
      saveTimersRef.current.set(field, timer);
    },
    [benchmarkingId, isReadOnly]
  );

  // Handle delta flag
  const handleDeltaFlag = useCallback(
    async (
      fieldName: string,
      previousValue: number | null,
      currentValue: number | null,
      action: "fixed" | "explained",
      explanation?: string
    ) => {
      const result = await saveDeltaFlag(
        benchmarkingId,
        fieldName,
        previousValue,
        currentValue,
        action,
        explanation
      );

      if (result.success) {
        if (action === "fixed") {
          setDeltaFlags((prev) => prev.filter((f) => f.field_name !== fieldName));
        } else {
          setDeltaFlags((prev) => {
            const existing = prev.findIndex((f) => f.field_name === fieldName);
            const newFlag = {
              id: "",
              benchmarking_id: benchmarkingId,
              field_name: fieldName,
              previous_value: previousValue,
              current_value: currentValue,
              pct_change: previousValue ? ((currentValue ?? 0) - previousValue) / previousValue * 100 : null,
              abs_change: (currentValue ?? 0) - (previousValue ?? 0),
              respondent_action: action,
              respondent_explanation: explanation ?? null,
              committee_status: "pending",
              committee_notes: null,
              reviewed_by: null,
              reviewed_at: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as DeltaFlag;

            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = newFlag;
              return updated;
            }
            return [...prev, newFlag];
          });
        }
      }
    },
    [benchmarkingId]
  );

  // Submit survey
  /**
   * Required answers that are still missing, in the order they are asked.
   *
   * ⛔ Skips anything a conditional is hiding. A store cannot answer a question
   * it was never shown, and demanding it would be a dead end with no box to
   * type in.
   */
  const missingRequired = useMemo(() => {
    const out: { sectionIdx: number; field: string; label: string; section: string }[] = [];
    sections.forEach((section, idx) => {
      section.fields
        .filter((f) => f.required && f.visible !== false)
        .filter((f) => !f.calculated && !f.displayOnly)
        .filter((f) => matchesShowIf(f.showIf, formData))
        .forEach((f) => {
          const v = formData[f.name];
          const empty =
            v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
          if (empty) {
            out.push({ sectionIdx: idx, field: f.name, label: f.label, section: section.title });
          }
        });
    });
    return out;
  }, [sections, formData]);

  /*
    Clear the complaint as soon as it stops being true.

    The error and the amber ring used to persist until the next submit, so a
    store would fill in the box it had been sent to and still be looking at a
    message telling it the box was empty. missingRequired is already derived
    from formData, so watching it is enough.
  */
  useEffect(() => {
    if (highlightField && !missingRequired.some((m) => m.field === highlightField)) {
      setHighlightField(null);
    }
    if (submitError && missingRequired.length === 0) setSubmitError(null);
  }, [missingRequired, highlightField, submitError]);

  const handleSubmit = async () => {
    // Take them to the first gap rather than naming it and leaving them to
    // hunt: the survey is ten sections long and the name of a field is not a
    // location.
    if (missingRequired.length > 0) {
      const first = missingRequired[0];
      setSubmitError(
        missingRequired.length === 1
          ? `“${first.label}” is still needed, in ${first.section}.`
          : `${missingRequired.length} required answers are still missing. The first is “${first.label}”, in ${first.section}.`,
      );
      goToSection(first.sectionIdx, first.field);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const result = await submitBenchmarkingSurvey(benchmarkingId);
    if (result.success) {
      // Figures the store left as last year's. Named rather than applied
      // silently — carry-forward cannot tell a deliberate blank from an
      // unvisited box, so the store gets to see which ones it filled and amend
      // if one of them was meant to be empty.
      setCarriedForward(result.carriedForward ?? []);
      setFormData((prev) => ({ ...prev, status: "submitted" }));
    } else {
      setSubmitError(result.error || "Failed to submit survey");
    }
    setIsSubmitting(false);
  };

  // Amend survey
  const handleAmend = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    const result = await amendBenchmarkingSurvey(benchmarkingId);
    if (result.success) {
      setFormData((prev) => ({ ...prev, status: "draft" }));
    } else {
      setSubmitError(result.error || "Failed to amend survey");
    }
    setIsSubmitting(false);
  };

  // Cleanup every pending save on unmount.
  useEffect(() => {
    const timers = saveTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const priorData = priorYearData as unknown as Record<string, unknown> | null;

  const sectionProps = {
    highlightField,
    formData,
    priorYearData: priorData,
    onFieldChange: handleFieldChange,
    onDeltaFlag: handleDeltaFlag,
    deltaFlags,
    isReadOnly,
    organizationName,
    organizationProvince,
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              FY{fiscalYear} Benchmarking Survey
            </h1>
            <p className="text-gray-600 mt-1">{organizationName}</p>
          </div>
          <SaveIndicator
            status={saveStatus}
            lastSaved={lastSaved}
            isSubmitted={isSubmitted}
          />
        </div>

        {surveyClosesAt && (
          <p className="text-sm text-gray-500 mt-2">
            {/* closes_at is an exclusive boundary — see lib/benchmarking/deadline.ts */}
            Survey closes {formatDeadline(surveyClosesAt)}
          </p>
        )}

        {isSubmitted && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-green-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-green-800 font-medium">
                  Survey submitted successfully
                </span>
              </div>
              <button
                onClick={handleAmend}
                disabled={isSubmitting}
                className="text-sm text-green-700 hover:text-green-900 underline"
              >
                {isSubmitting ? "..." : "Amend Submission"}
              </button>
            </div>

            {/*
              What we filled in on their behalf, said out loud.

              Carry-forward cannot distinguish a box left alone because nothing
              changed from one left alone because it was never opened, and a
              store that cleared a figure deliberately gets last year's back.
              Listing them by label, grouped by section, is what makes that
              recoverable: they can see it, and Amend is right there.
            */}
            {carriedForward.length > 0 && (
              <div className="mt-3 border-t border-green-200 pt-3">
                <p className="text-sm text-green-900">
                  {carriedForward.length === 1
                    ? "One figure was carried forward unchanged from FY"
                    : `${carriedForward.length} figures were carried forward unchanged from FY`}
                  {fiscalYear - 1}, because you left them as they were:
                </p>
                <ul className="mt-2 space-y-1">
                  {carriedForwardBySection.map(({ section, labels }) => (
                    <li key={section} className="text-sm text-green-800">
                      <span className="font-medium">{section}:</span>{" "}
                      {labels.join(", ")}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-green-700">
                  If any of those should be blank or different this year, choose
                  Amend Submission and correct them.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section Navigation */}
      <div ref={formTopRef} className="mb-6 flex scroll-mt-24 items-stretch gap-3 border-b border-gray-200">
        <nav className="flex flex-1 overflow-x-auto -mb-px" aria-label="Survey sections">
          {sections.map((section, idx) => (
            <button
              key={section.id}
              onClick={() => goToSection(idx)}
              className={`whitespace-nowrap px-4 py-3 border-b-2 text-sm font-medium transition-colors ${
                activeSection === idx && !reviewingAll
                  ? "border-[#EE2A2E] text-[#EE2A2E]"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {section.order}. {section.title}
            </button>
          ))}
        </nav>
        {/*
          Outside the scrolling list on purpose. Inside it, ten section tabs
          pushed this off the right-hand edge and the only way to find the
          review was to scroll a nav bar nobody scrolls.

          Shown after submitting too. Reading back what you filed is the most
          obvious thing to want once it is in, and hiding the only whole-survey
          view the moment it becomes a record made no sense.
        */}
        {(
          <button
            onClick={openReview}
            className={`-mb-px shrink-0 self-end whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
              reviewingAll
                ? "border-[#EE2A2E] text-[#EE2A2E]"
                : "border-transparent text-[#163D6D] hover:border-[#163D6D]"
            }`}
          >
            {isSubmitted ? "Read back what you filed" : "Review all answers"}
          </button>
        )}
      </div>

      {/*
        The way back, once they have been to the review.

        Changing one answer from the review meant walking forward through every
        section between it and the end to get back — so people either did not
        go and fix it, or did and lost their place.
      */}
      {hasReviewed && !reviewingAll && !isSubmitted && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[#163D6D]/20 bg-[#163D6D]/5 px-3 py-2">
          <p className="text-sm text-[#163D6D]">
            You came here from the review.
          </p>
          <button
            onClick={openReview}
            className="rounded-lg bg-[#163D6D] px-3 py-1.5 text-sm font-medium text-white"
          >
            Back to review
          </button>
        </div>
      )}

      {/* Error display */}
      {submitError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          {submitError}
        </div>
      )}

      {/* Inline save validation error */}
      {saveError && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {saveError}
        </div>
      )}

      {/* Active Section */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        {reviewingAll && (
          <ReviewAllAnswers
            config={config}
            formData={formData}
            lists={{
              gmCategories,
              cmCategories,
              otherIncome,
              otherExpenses,
              staff,
              competitors,
              locations,
              keyDates,
            }}
            onJumpToSection={jumpToSection}
            onJumpToField={(sectionId, fieldName) => {
              const idx = sections.findIndex((x) => x.id === sectionId);
              if (idx >= 0) goToSection(idx, fieldName);
            }}
            onClose={() => goToSection(activeSection)}
          />
        )}
        {!reviewingAll && sections[activeSection] && (
          <>
            {/*
              Above the questions, because "who is answering" is not one of the
              questions — it decides who a reviewer rings in November, and it is
              the one thing on this page a store should not have to retype.
            */}
            {sections[activeSection]?.id === "institution_profile" && (
            <RespondentPicker
              benchmarkingId={benchmarkingId}
              contacts={storeContacts}
              initialContactId={
                (formData.respondent_contact_id as string | null) ?? null
              }
              initialDelegated={Boolean(formData.respondent_delegate_profile_id)}
              isReadOnly={isReadOnly}
            />
          )}
            <DynamicSurveySection
              sectionConfig={sections[activeSection]}
              {...sectionProps}
              /* §2 and §3 are category-driven: the store says what it carries
                 before we ask anything about it. */
              beforeFields={
                sections[activeSection]?.id === "general_merchandise" ? (
                  <CategorySales
                    key="general_merchandise"
                    benchmarkingId={benchmarkingId}
                    scope="general_merchandise"
                    initialCategories={gmCategories}
                    locations={locations}
                    contacts={storeContacts}
                    isReadOnly={isReadOnly}
                  />
                ) : sections[activeSection]?.id === "course_materials" ? (
                  /*
                    Keyed, or §3 opens showing §2's categories until a reload.
                    Both branches render CategorySales at the same position in
                    the tree, so React reuses the instance and its
                    useState(initialCategories) — set once, on first mount —
                    keeps §2's list.
                  */
                  <CategorySales
                    key="course_materials"
                    benchmarkingId={benchmarkingId}
                    scope="course_materials"
                    initialCategories={cmCategories}
                    locations={locations}
                    contacts={storeContacts}
                    isReadOnly={isReadOnly}
                  />
                ) : sections[activeSection]?.id === "other_income" ? (
                  /* The running total leads the section: this is the first
                     place a store sees merchandise and course materials
                     together, and it is the context for everything under it. */
                  <OtherIncomeEditor
                    benchmarkingId={benchmarkingId}
                    initialRows={otherIncome}
                    merchandiseTotal={merchandiseTotal}
                    courseMaterialsTotal={courseMaterialsTotal}
                    centralFunding={
                      typeof formData.central_funding === "number"
                        ? formData.central_funding
                        : 0
                    }
                    isReadOnly={isReadOnly}
                  />
                ) : null
              }
            />
            {/* §9 — "store staff" names an arrangement, not a person. */}
            {sections[activeSection]?.id === "technology_systems" &&
              isInternalSocialAnswer(formData.social_media_run_by) && (
                <SocialOwner
                  benchmarkingId={benchmarkingId}
                  contacts={storeContacts}
                  value={
                    typeof formData.social_media_run_by_contact_id === "string"
                      ? formData.social_media_run_by_contact_id
                      : null
                  }
                  onChange={(id) => handleFieldChange("social_media_run_by_contact_id", id)}
                  isReadOnly={isReadOnly}
                />
              )}
            {/* §6 — pay as a grid, so benefits sit beside the wages they go with. */}
            {sections[activeSection]?.id === "staffing" && (
              <WagesAndBenefits
                formData={formData}
                onFieldChange={handleFieldChange}
                isReadOnly={isReadOnly}
              />
            )}
            {/* §6 — the team, not just the headcount above it. */}
            {sections[activeSection]?.id === "staffing" && (
              <StaffingEditor
                benchmarkingId={benchmarkingId}
                initialStaff={staff}
                isReadOnly={isReadOnly}
              />
            )}
            {/* §7 — the escape hatch, under the lines we named. */}
            {sections[activeSection]?.id === "expenses" && (
              <OtherExpensesEditor
                benchmarkingId={benchmarkingId}
                initialRows={otherExpenses}
                namedExpenseTotal={namedExpenseTotal}
                isReadOnly={isReadOnly}
              />
            )}
            {/* §8 — everything above, as one statement they can check. */}
            {sections[activeSection]?.id === "review_financials" && (
              <ReviewFinancials
                gmCategories={gmCategories}
                cmCategories={cmCategories}
                otherIncome={otherIncome}
                otherExpenses={otherExpenses}
                formData={formData}
                onJumpToSection={jumpToSection}
              />
            )}
            {sections[activeSection]?.id === "institution_profile" && (
              <LocationsEditor
                benchmarkingId={benchmarkingId}
                initialLocations={locations}
                isReadOnly={isReadOnly}
              />
            )}
            {sections[activeSection]?.id === "institution_profile" && (
              <>
                <KeyDatesEditor
                  benchmarkingId={benchmarkingId}
                  initialDates={keyDates}
                  isReadOnly={isReadOnly}
                  isSemesterBased={formData.is_semester_based === true}
                  inventoryCountStyle={
                    typeof formData.inventory_count_style === "string"
                      ? formData.inventory_count_style
                      : null
                  }
                  profileSuggestions={profileKeyDates}
                />
                <CompetitorsEditor
                  benchmarkingId={benchmarkingId}
                  initialRows={competitors}
                  isReadOnly={isReadOnly}
                />
                <ServicesJourney
                  benchmarkingId={benchmarkingId}
                  initialStatus={
                    (formData.service_status as Record<string, ServiceStatus> | null) ?? {}
                  }
                  isReadOnly={isReadOnly}
                />
                {logos && (
                  <LogoConfirm
                    benchmarkingId={benchmarkingId}
                    organizationId={organizationId}
                    logoUrl={logos.logoUrl}
                    logoHorizontalUrl={logos.logoHorizontalUrl}
                    confirmedAt={logos.confirmedAt}
                    isReadOnly={isReadOnly}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Navigation + Submit */}
      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() => goToSection(Math.max(0, activeSection - 1))}
          disabled={activeSection === 0 || reviewingAll}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </button>

        <div className="flex items-center gap-3">
          {reviewingAll ? (
            /*
              The only place Submit lives. Reviewing is not submitting, and the
              old flow put the two on the same button at the end of §10 — so the
              last thing a store did before filing was answer a question about
              Inclusive Access, not read back what it had said.
            */
            !isSubmitted && (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="px-8 py-2.5 text-sm font-medium text-white bg-[#EE2A2E] rounded-lg hover:bg-[#D92327] disabled:opacity-50"
              >
                {isSubmitting ? "Submitting..." : "Submit Survey"}
              </button>
            )
          ) : activeSection < sections.length - 1 ? (
            <button
              onClick={() => goToSection(Math.min(sections.length - 1, activeSection + 1))}
              className="px-6 py-2 text-sm font-medium text-white bg-[#EE2A2E] rounded-lg hover:bg-[#D92327]"
            >
              Next Section
            </button>
          ) : !isSubmitted ? (
            <button
              onClick={openReview}
              className="px-8 py-2.5 text-sm font-medium text-white bg-[#163D6D] rounded-lg hover:bg-[#12325a]"
            >
              Review your answers
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Save status indicator
function SaveIndicator({
  status,
  lastSaved,
  isSubmitted,
}: {
  status: "idle" | "saving" | "saved" | "error";
  lastSaved: Date | null;
  isSubmitted: boolean;
}) {
  if (isSubmitted) return null;

  return (
    <div className="text-sm text-gray-500">
      {status === "saving" && (
        <span className="flex items-center">
          <span className="w-2 h-2 bg-amber-400 rounded-full mr-2 animate-pulse" />
          Saving...
        </span>
      )}
      {status === "saved" && (
        <span className="flex items-center text-green-600">
          <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          Saved
        </span>
      )}
      {status === "error" && (
        <span className="text-red-600">Save failed — will retry</span>
      )}
      {status === "idle" && lastSaved && (
        <span>
          Last saved {lastSaved.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </div>
  );
}
