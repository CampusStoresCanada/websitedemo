"use client";

import { useState, useRef } from "react";
import WizardShell from "@/components/conference/WizardShell";
import { PARTNER_WIZARD_STEPS, DEFAULT_SALES_READINESS, type SalesReadiness } from "@/lib/types/conference";
import {
  MEETING_OUTCOME_OPTIONS,
  MEETING_STRUCTURE_OPTIONS,
  BUYING_CYCLE_OPTIONS,
  ACCOMMODATION_TYPE_OPTIONS,
  LEGAL_DOCUMENT_LABELS,
  type LegalDocumentType,
} from "@/lib/constants/conference";
import { PARTNER_PRIMARY_CATEGORIES, PARTNER_SECONDARY_CATEGORIES } from "@/lib/constants/partner-categories";
import {
  createRegistration,
  saveRegistrationStep,
  submitRegistration,
} from "@/lib/actions/conference-registration";
import { acceptLegalDocument } from "@/lib/actions/conference-legal";
import { addStaffMember } from "@/lib/actions/conference-staff";
import type { Database } from "@/lib/database.types";

type ConferenceRow = Database["public"]["Tables"]["conference_instances"]["Row"];
type RegistrationRow = Database["public"]["Tables"]["conference_registrations"]["Row"];
type LegalVersionRow = Database["public"]["Tables"]["conference_legal_versions"]["Row"];
type LegalAcceptanceRow = Database["public"]["Tables"]["legal_acceptances"]["Row"];

interface PartnerRegistrationFormProps {
  conference: ConferenceRow;
  orgId: string;
  orgName: string;
  existingRegistration: RegistrationRow | null | undefined;
  legalDocs: LegalVersionRow[];
  acceptances: LegalAcceptanceRow[];
  knownPeople: Array<{
    id: string;
    name: string;
    email: string;
    title: string | null;
    work_phone: string | null;
    mobile_phone: string | null;
  }>;
  badgeOrgOptions: Array<{ id: string; name: string }>;
}

interface StaffEntry {
  person_id?: string | null;
  name: string;
  email: string;
  phone: string;
  accommodation_type: string;
  extracurricular_registered: boolean;
  badge_organization_id: string | null;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isLikelyPhone(value: string): boolean {
  const normalized = value.replace(/[^\d+]/g, "");
  return normalized.length >= 7;
}

export default function PartnerRegistrationForm({
  conference,
  orgId,
  orgName,
  existingRegistration,
  legalDocs,
  acceptances,
  knownPeople,
  badgeOrgOptions,
}: PartnerRegistrationFormProps) {
  const [step, setStep] = useState(0);
  const [registrationId, setRegistrationId] = useState(existingRegistration?.id ?? "");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(existingRegistration?.status === "submitted");

  // Step 2: Meeting Intent
  const [meetingOutcomeIntent, setMeetingOutcomeIntent] = useState<string[]>(
    (existingRegistration?.meeting_outcome_intent as string[]) ?? []
  );
  const [meetingStructure, setMeetingStructure] = useState(existingRegistration?.meeting_structure ?? "");
  const [advanceNeeds, setAdvanceNeeds] = useState(existingRegistration?.advance_needs ?? "");
  const [differentiator, setDifferentiator] = useState(existingRegistration?.differentiator ?? "");

  // Step 3: Sales Readiness
  const [salesReadiness, setSalesReadiness] = useState<SalesReadiness>(
    (existingRegistration?.sales_readiness as unknown as SalesReadiness) ?? DEFAULT_SALES_READINESS
  );

  // Step 4: Buying Cycles
  const [buyingCycles, setBuyingCycles] = useState<string[]>(
    (existingRegistration?.buying_cycles_targeted as string[]) ?? []
  );

  // Step 5: One Thing
  const [oneThing, setOneThing] = useState(existingRegistration?.one_thing_to_remember ?? "");

  // Step 6-8: Staff
  const [staff, setStaff] = useState<StaffEntry[]>([
    {
      person_id: null,
      name: "",
      email: "",
      phone: "",
      accommodation_type: "full",
      extracurricular_registered: false,
      badge_organization_id: null,
    },
  ]);

  // Track which staff emails have been persisted to avoid duplicates on re-navigation
  const persistedStaffEmails = useRef<Set<string>>(new Set());

  // Step 9: Categorization
  const [primaryCategory, setPrimaryCategory] = useState(existingRegistration?.primary_category ?? "");
  const [secondaryCategories, setSecondaryCategories] = useState<string[]>(
    (existingRegistration?.secondary_categories as string[]) ?? []
  );

  // Step 10: Legal
  const [acceptedLegalIds, setAcceptedLegalIds] = useState<Set<string>>(
    new Set(acceptances.map((a) => a.legal_version_id))
  );

  const ensureRegistration = async (): Promise<string | null> => {
    if (registrationId) return registrationId;
    const result = await createRegistration(conference.id, "exhibitor", orgId);
    if (result.success && result.data) {
      setRegistrationId(result.data.id);
      return result.data.id;
    }
    setError(result.error ?? "Failed to create registration");
    return null;
  };

  const handleNext = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const regId = await ensureRegistration();
      if (!regId) { setIsLoading(false); return; }

      // Save step data
      if (step === 1) {
        await saveRegistrationStep(regId, {
          meeting_outcome_intent: meetingOutcomeIntent,
          meeting_structure: meetingStructure || null,
          advance_needs: advanceNeeds || null,
          differentiator: differentiator || null,
        });
      } else if (step === 2) {
        await saveRegistrationStep(regId, {
          sales_readiness: salesReadiness as unknown as Database["public"]["Tables"]["conference_registrations"]["Update"]["sales_readiness"],
        });
      } else if (step === 3) {
        await saveRegistrationStep(regId, {
          buying_cycles_targeted: buyingCycles,
        });
      } else if (step === 4) {
        if (!oneThing.trim()) {
          setError("This field is required");
          setIsLoading(false);
          return;
        }
        await saveRegistrationStep(regId, {
          one_thing_to_remember: oneThing,
        });
      } else if (step === 5) {
        for (const s of staff) {
          if (s.email.trim() && !isValidEmail(s.email)) {
            setError(`Enter a valid email for staff member "${s.name || "unnamed"}".`);
            setIsLoading(false);
            return;
          }
          if (s.phone.trim() && !isLikelyPhone(s.phone)) {
            setError(`Enter a valid phone for staff member "${s.name || "unnamed"}".`);
            setIsLoading(false);
            return;
          }
        }
        // Save staff members — skip any already persisted (idempotent on re-navigation)
        for (const s of staff) {
          if (s.name && s.email && !persistedStaffEmails.current.has(s.email)) {
            const result = await addStaffMember(regId, {
              name: s.name,
              email: s.email,
              phone: s.phone || null,
              accommodation_type: s.accommodation_type || null,
              extracurricular_registered: s.extracurricular_registered,
              badge_organization_id: s.badge_organization_id,
              user_id: null,
              person_id: s.person_id || null,
            });
            if (result.success) {
              persistedStaffEmails.current.add(s.email);
            }
          }
        }
      } else if (step === 8) {
        await saveRegistrationStep(regId, {
          primary_category: primaryCategory || null,
          secondary_categories: secondaryCategories,
        });
      }

      setStep(step + 1);
    } catch {
      setError("An error occurred");
    }
    setIsLoading(false);
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    setError(null);

    const result = await submitRegistration(registrationId);
    if (result.success) {
      setSubmitted(true);
    } else {
      setError(result.error ?? "Failed to submit");
    }
    setIsLoading(false);
  };

  if (submitted) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Registration Submitted</h2>
        <p className="text-gray-500">Your exhibitor registration has been submitted for review.</p>
      </div>
    );
  }

  const isLastStep = step === PARTNER_WIZARD_STEPS.length - 1;

  return (
    <WizardShell
      currentStep={step}
      steps={PARTNER_WIZARD_STEPS}
      onBack={step > 0 ? () => setStep(step - 1) : undefined}
      onNext={isLastStep ? handleSubmit : handleNext}
      nextLabel={isLastStep ? "Submit Registration" : "Next"}
      isLoading={isLoading}
      error={error}
    >
      {/* Step 0: Profile Review */}
      {step === 0 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Registering as <strong>{orgName}</strong> for {conference.name}.
          </p>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm">
            <div className="text-gray-500">Organization: <span className="text-gray-900 font-medium">{orgName}</span></div>
            <div className="text-gray-500 mt-1">Type: Exhibitor / Vendor Partner</div>
          </div>
          <p className="text-xs text-gray-400">Confirm your organization details above, then proceed.</p>
        </div>
      )}

      {/* Step 1: Meeting Intent */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">What do you want from meetings?</label>
            <div className="space-y-2">
              {MEETING_OUTCOME_OPTIONS.map((opt) => (
                <label key={opt} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={meetingOutcomeIntent.includes(opt)}
                    onChange={(e) =>
                      e.target.checked
                        ? setMeetingOutcomeIntent([...meetingOutcomeIntent, opt])
                        : setMeetingOutcomeIntent(meetingOutcomeIntent.filter((x) => x !== opt))
                    }
                    className="rounded border-gray-300 text-[#D60001]"
                  />
                  <span className="text-sm text-gray-700">{opt}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Meeting structure</label>
            <div className="space-y-2">
              {MEETING_STRUCTURE_OPTIONS.map((opt) => (
                <label key={opt} className="flex items-center gap-2">
                  <input type="radio" name="meetingStructure" value={opt} checked={meetingStructure === opt} onChange={() => setMeetingStructure(opt)} className="border-gray-300 text-[#D60001]" />
                  <span className="text-sm text-gray-700">{opt}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">What do you need from delegates in advance?</label>
            <textarea value={advanceNeeds} onChange={(e) => setAdvanceNeeds(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">What makes your meetings different?</label>
            <textarea value={differentiator} onChange={(e) => setDifferentiator(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
          </div>
        </div>
      )}

      {/* Step 2: Sales Readiness */}
      {step === 2 && (
        <div className="space-y-3">
          {(["can_quote", "can_negotiate", "can_write_orders", "can_sign", "legal_required"] as const).map((key) => (
            <label key={key} className="flex items-center justify-between bg-gray-50 px-4 py-3 rounded-lg">
              <span className="text-sm text-gray-700 capitalize">{key.replace(/_/g, " ")}?</span>
              <input
                type="checkbox"
                checked={salesReadiness[key]}
                onChange={(e) => setSalesReadiness({ ...salesReadiness, [key]: e.target.checked })}
                className="rounded border-gray-300 text-[#D60001] h-5 w-5"
              />
            </label>
          ))}
        </div>
      )}

      {/* Step 3: Buying Cycles */}
      {step === 3 && (
        <div className="space-y-2">
          <p className="text-sm text-gray-500 mb-3">Select up to 3 buying cycles you&apos;re targeting.</p>
          {BUYING_CYCLE_OPTIONS.map((opt) => (
            <label key={opt} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={buyingCycles.includes(opt)}
                disabled={!buyingCycles.includes(opt) && buyingCycles.length >= 3}
                onChange={(e) =>
                  e.target.checked
                    ? setBuyingCycles([...buyingCycles, opt])
                    : setBuyingCycles(buyingCycles.filter((x) => x !== opt))
                }
                className="rounded border-gray-300 text-[#D60001]"
              />
              <span className="text-sm text-gray-700">{opt}</span>
            </label>
          ))}
        </div>
      )}

      {/* Step 4: One Thing to Remember */}
      {step === 4 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            What&apos;s the one thing you want delegates to remember about you?
          </label>
          <textarea
            value={oneThing}
            onChange={(e) => setOneThing(e.target.value)}
            rows={4}
            required
            placeholder="This will appear in your exhibitor profile..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>
      )}

      {/* Step 5: Staff Selection */}
      {step === 5 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Add your booth staff. The first 2 staff members are included free.</p>
          {staff.map((s, i) => (
            <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-medium text-gray-500">Staff #{i + 1}</span>
                {i > 0 && (
                  <button onClick={() => setStaff(staff.filter((_, j) => j !== i))} className="text-xs text-red-500">Remove</button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" placeholder="Name" value={s.name} onChange={(e) => { const n = [...staff]; n[i] = { ...n[i], name: e.target.value }; setStaff(n); }} className="px-2 py-1.5 border border-gray-300 rounded text-sm" />
                <input type="email" placeholder="Email" value={s.email} onChange={(e) => { const n = [...staff]; n[i] = { ...n[i], email: e.target.value }; setStaff(n); }} className="px-2 py-1.5 border border-gray-300 rounded text-sm" />
                <select
                  value={s.person_id ?? ""}
                  onChange={(e) => {
                    const n = [...staff];
                    const selected = knownPeople.find((person) => person.id === e.target.value);
                    if (selected) {
                      n[i] = {
                        ...n[i],
                        person_id: selected.id,
                        name: selected.name,
                        email: selected.email,
                        phone: selected.work_phone ?? selected.mobile_phone ?? "",
                      };
                    } else {
                      n[i] = { ...n[i], person_id: null };
                    }
                    setStaff(n);
                  }}
                  className="px-2 py-1.5 border border-gray-300 rounded text-sm"
                >
                  <option value="">Select known contact</option>
                  {knownPeople.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} ({person.email})
                    </option>
                  ))}
                </select>
                <input type="tel" placeholder="Phone" value={s.phone} onChange={(e) => { const n = [...staff]; n[i] = { ...n[i], phone: e.target.value }; setStaff(n); }} className="px-2 py-1.5 border border-gray-300 rounded text-sm" />
                <select
                  value={s.badge_organization_id ?? ""}
                  onChange={(e) => {
                    const n = [...staff];
                    n[i] = { ...n[i], badge_organization_id: e.target.value || null };
                    setStaff(n);
                  }}
                  className="col-span-2 px-2 py-1.5 border border-gray-300 rounded text-sm"
                >
                  <option value="">Badge organization (default exhibitor org)</option>
                  {badgeOrgOptions.map((badgeOrg) => (
                    <option key={badgeOrg.id} value={badgeOrg.id}>
                      {badgeOrg.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
          <button
            onClick={() =>
              setStaff([
                ...staff,
                {
                  person_id: null,
                  name: "",
                  email: "",
                  phone: "",
                  accommodation_type: "full",
                  extracurricular_registered: false,
                  badge_organization_id: null,
                },
              ])
            }
            className="text-sm text-[#D60001] hover:underline"
          >
            + Add another staff member
          </button>
        </div>
      )}

      {/* Step 6: Staff Accommodations */}
      {step === 6 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500 mb-2">Select accommodation type for each staff member.</p>
          {staff.filter((s) => s.name).map((s, i) => (
            <div key={i} className="flex items-center justify-between bg-gray-50 px-4 py-3 rounded-lg">
              <span className="text-sm text-gray-700">{s.name}</span>
              <select
                value={s.accommodation_type}
                onChange={(e) => { const n = [...staff]; n[i] = { ...n[i], accommodation_type: e.target.value }; setStaff(n); }}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
              >
                {ACCOMMODATION_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt === "full" ? "Full" : opt === "meals_only" ? "Meals Only" : "None"}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Step 7: Extracurricular */}
      {step === 7 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500 mb-2">Register staff for extracurricular activities?</p>
          {staff.filter((s) => s.name).map((s, i) => (
            <label key={i} className="flex items-center justify-between bg-gray-50 px-4 py-3 rounded-lg">
              <span className="text-sm text-gray-700">{s.name}</span>
              <input
                type="checkbox"
                checked={s.extracurricular_registered}
                onChange={(e) => { const n = [...staff]; n[i] = { ...n[i], extracurricular_registered: e.target.checked }; setStaff(n); }}
                className="rounded border-gray-300 text-[#D60001] h-5 w-5"
              />
            </label>
          ))}
        </div>
      )}

      {/* Step 8: Categorization */}
      {step === 8 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Primary Category</label>
            <select
              value={primaryCategory}
              onChange={(e) => setPrimaryCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="">Select...</option>
              {PARTNER_PRIMARY_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Secondary Categories</label>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {PARTNER_SECONDARY_CATEGORIES.map((c) => (
                <label key={c} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={secondaryCategories.includes(c)}
                    onChange={(e) =>
                      e.target.checked
                        ? setSecondaryCategories([...secondaryCategories, c])
                        : setSecondaryCategories(secondaryCategories.filter((x) => x !== c))
                    }
                    className="rounded border-gray-300 text-[#D60001]"
                  />
                  <span className="text-sm text-gray-700">{c}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 9: Legal Acceptance */}
      {step === 9 && (
        <div className="space-y-4">
          {legalDocs.length === 0 ? (
            <p className="text-sm text-gray-500">No legal documents to accept.</p>
          ) : (
            legalDocs.map((doc) => (
              <div key={doc.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="text-sm font-medium text-gray-900">
                    {LEGAL_DOCUMENT_LABELS[doc.document_type as LegalDocumentType] ?? doc.document_type}
                  </h4>
                  {acceptedLegalIds.has(doc.id) && (
                    <span className="text-xs text-green-600 font-medium">Accepted</span>
                  )}
                </div>
                <div className="text-xs text-gray-600 max-h-32 overflow-y-auto mb-3 whitespace-pre-wrap">
                  {doc.content}
                </div>
                {!acceptedLegalIds.has(doc.id) && (
                  <button
                    onClick={async () => {
                      const result = await acceptLegalDocument(doc.id);
                      if (result.success) {
                        setAcceptedLegalIds(new Set([...acceptedLegalIds, doc.id]));
                      }
                    }}
                    className="text-sm text-[#D60001] hover:underline font-medium"
                  >
                    I accept these terms
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Step 10: Review & Submit */}
      {step === 10 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-700">Review Your Registration</h3>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2 text-sm">
            <div><span className="text-gray-500">Organization:</span> {orgName}</div>
            <div><span className="text-gray-500">Meeting Structure:</span> {meetingStructure || "Not set"}</div>
            <div><span className="text-gray-500">Buying Cycles:</span> {buyingCycles.join(", ") || "None"}</div>
            <div><span className="text-gray-500">One Thing:</span> {oneThing || "Not set"}</div>
            <div><span className="text-gray-500">Staff:</span> {staff.filter((s) => s.name).length} members</div>
            <div><span className="text-gray-500">Category:</span> {primaryCategory || "Not set"}</div>
            <div><span className="text-gray-500">Legal:</span> {acceptedLegalIds.size}/{legalDocs.length} accepted</div>
          </div>
          <p className="text-xs text-gray-400">
            Click &ldquo;Submit Registration&rdquo; to finalize. You can edit your registration until it is confirmed by an admin.
          </p>
        </div>
      )}
    </WizardShell>
  );
}
