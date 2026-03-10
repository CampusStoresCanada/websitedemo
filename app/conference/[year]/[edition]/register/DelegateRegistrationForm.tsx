"use client";

import { useState } from "react";
import WizardShell from "@/components/conference/WizardShell";
import ConsentGate from "@/components/conference/ConsentGate";
import OrgMultiSelect from "@/components/conference/OrgMultiSelect";
import { DELEGATE_WIZARD_STEPS } from "@/lib/types/conference";
import {
  FUNCTIONAL_ROLE_OPTIONS,
  PURCHASING_AUTHORITY_OPTIONS,
  BUYING_CYCLE_OPTIONS,
  PRIORITY_OPTIONS,
  MEETING_OUTCOME_OPTIONS,
  SEAT_PREFERENCE_OPTIONS,
  LEGAL_DOCUMENT_LABELS,
  type LegalDocumentType,
} from "@/lib/constants/conference";
import { PARTNER_SECONDARY_CATEGORIES } from "@/lib/constants/partner-categories";
import {
  createRegistration,
  saveRegistrationStep,
  submitRegistration,
} from "@/lib/actions/conference-registration";
import { acceptLegalDocument } from "@/lib/actions/conference-legal";
import type { Database } from "@/lib/database.types";

type ConferenceRow = Database["public"]["Tables"]["conference_instances"]["Row"];
type RegistrationRow = Database["public"]["Tables"]["conference_registrations"]["Row"];
type LegalVersionRow = Database["public"]["Tables"]["conference_legal_versions"]["Row"];
type LegalAcceptanceRow = Database["public"]["Tables"]["legal_acceptances"]["Row"];

interface DelegateRegistrationFormProps {
  conference: ConferenceRow;
  orgId: string;
  orgName: string;
  existingRegistration: RegistrationRow | null | undefined;
  legalDocs: LegalVersionRow[];
  acceptances: LegalAcceptanceRow[];
  exhibitorOrgs: { id: string; name: string }[];
  mePerson: {
    name: string;
    email: string;
    title: string | null;
    work_phone: string | null;
    mobile_phone: string | null;
  };
  travelConsentRequired: boolean;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isLikelyPhone(value: string): boolean {
  const normalized = value.replace(/[^\d+]/g, "");
  return normalized.length >= 7;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export default function DelegateRegistrationForm({
  conference,
  orgId,
  orgName,
  existingRegistration,
  legalDocs,
  acceptances,
  exhibitorOrgs,
  mePerson,
  travelConsentRequired,
}: DelegateRegistrationFormProps) {
  const [step, setStep] = useState(0);
  const [registrationId, setRegistrationId] = useState(existingRegistration?.id ?? "");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(existingRegistration?.status === "submitted");

  // Step 0: Identification
  const [delegateName, setDelegateName] = useState(
    existingRegistration?.delegate_name ?? mePerson.name ?? ""
  );
  const [delegateTitle, setDelegateTitle] = useState(
    existingRegistration?.delegate_title ?? mePerson.title ?? ""
  );
  const [delegateEmail, setDelegateEmail] = useState(
    existingRegistration?.delegate_email ?? mePerson.email ?? ""
  );
  const [workPhone, setWorkPhone] = useState(
    existingRegistration?.delegate_work_phone ?? mePerson.work_phone ?? ""
  );
  const [mobilePhone, setMobilePhone] = useState(existingRegistration?.mobile_phone ?? "");
  const [preferredAirport, setPreferredAirport] = useState(existingRegistration?.preferred_departure_airport ?? "");
  const [nexusTraveler, setNexusTraveler] = useState(existingRegistration?.nexus_trusted_traveler ?? false);

  // Step 1: Functional Roles
  const [functionalRoles, setFunctionalRoles] = useState<string[]>(
    (existingRegistration?.functional_roles as string[]) ?? []
  );

  // Step 2: Purchasing Authority
  const [purchasingAuthority, setPurchasingAuthority] = useState(existingRegistration?.purchasing_authority ?? "");

  // Step 3: Category Responsibilities
  const [categoryResponsibilities, setCategoryResponsibilities] = useState<string[]>(
    (existingRegistration?.category_responsibilities as string[]) ?? []
  );

  // Step 4: Buying Timeline
  const [buyingTimeline, setBuyingTimeline] = useState<string[]>(
    (existingRegistration?.buying_timeline as string[]) ?? []
  );

  // Step 5: Top Priorities
  const [topPriorities, setTopPriorities] = useState<string[]>(
    (existingRegistration?.top_priorities as string[]) ?? []
  );

  // Step 6: Meeting Intent
  const [meetingIntent, setMeetingIntent] = useState<string[]>(
    (existingRegistration?.meeting_intent as string[]) ?? []
  );

  // Step 7: Success Definition
  const [successDefinition, setSuccessDefinition] = useState(existingRegistration?.success_definition ?? "");

  // Step 8: Travel
  const [travelConsent, setTravelConsent] = useState(existingRegistration?.travel_consent_given ?? false);
  const [legalName, setLegalName] = useState(existingRegistration?.legal_name ?? "");
  const [dateOfBirth, setDateOfBirth] = useState(existingRegistration?.date_of_birth ?? "");
  const [seatPreference, setSeatPreference] = useState(existingRegistration?.seat_preference ?? "");
  const [dietaryRestrictions, setDietaryRestrictions] = useState(existingRegistration?.dietary_restrictions ?? "");
  const [accessibilityNeeds, setAccessibilityNeeds] = useState(existingRegistration?.accessibility_needs ?? "");
  const [emergencyContactName, setEmergencyContactName] = useState(existingRegistration?.emergency_contact_name ?? "");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState(existingRegistration?.emergency_contact_phone ?? "");
  const [gender, setGender] = useState(existingRegistration?.gender ?? "");

  // Step 9: Preferences
  const [top5Preferences, setTop5Preferences] = useState<string[]>(
    (existingRegistration?.top_5_preferences as string[]) ?? []
  );
  const [blackoutList, setBlackoutList] = useState<string[]>(
    (existingRegistration?.blackout_list as string[]) ?? []
  );

  // Step 10: Legal
  const [acceptedLegalIds, setAcceptedLegalIds] = useState<Set<string>>(
    new Set(acceptances.map((a) => a.legal_version_id))
  );

  const ensureRegistration = async (): Promise<string | null> => {
    if (registrationId) return registrationId;
    const result = await createRegistration(conference.id, "delegate", orgId);
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

      if (step === 0) {
        if (!delegateName.trim() || !delegateEmail.trim()) {
          setError("Name and work email are required");
          setIsLoading(false);
          return;
        }
        if (!isValidEmail(delegateEmail)) {
          setError("Enter a valid work email address.");
          setIsLoading(false);
          return;
        }
        if (workPhone.trim() && !isLikelyPhone(workPhone)) {
          setError("Enter a valid work phone number.");
          setIsLoading(false);
          return;
        }
        if (mobilePhone.trim() && !isLikelyPhone(mobilePhone)) {
          setError("Enter a valid mobile phone number.");
          setIsLoading(false);
          return;
        }
        await saveRegistrationStep(regId, {
          delegate_name: delegateName.trim(),
          delegate_title: delegateTitle || null,
          delegate_email: delegateEmail.trim(),
          delegate_work_phone: workPhone || null,
          mobile_phone: mobilePhone || null,
          preferred_departure_airport: preferredAirport || null,
          nexus_trusted_traveler: nexusTraveler,
        });
      } else if (step === 1) {
        await saveRegistrationStep(regId, { functional_roles: functionalRoles });
      } else if (step === 2) {
        await saveRegistrationStep(regId, { purchasing_authority: purchasingAuthority || null });
      } else if (step === 3) {
        await saveRegistrationStep(regId, { category_responsibilities: categoryResponsibilities });
      } else if (step === 4) {
        await saveRegistrationStep(regId, { buying_timeline: buyingTimeline });
      } else if (step === 5) {
        if (topPriorities.length !== 3) {
          setError("Please select exactly 3 priorities");
          setIsLoading(false);
          return;
        }
        await saveRegistrationStep(regId, { top_priorities: topPriorities });
      } else if (step === 6) {
        await saveRegistrationStep(regId, { meeting_intent: meetingIntent });
      } else if (step === 7) {
        if (!successDefinition.trim()) {
          setError("This field is required");
          setIsLoading(false);
          return;
        }
        await saveRegistrationStep(regId, { success_definition: successDefinition });
      } else if (step === 8) {
        if (!travelConsent && travelConsentRequired) {
          setError("Travel consent is required before travel fields can be saved.");
          setIsLoading(false);
          return;
        }
        if (travelConsent) {
          if (dateOfBirth.trim() && !isIsoDate(dateOfBirth)) {
            setError("Date of birth must use YYYY-MM-DD format.");
            setIsLoading(false);
            return;
          }
          if (emergencyContactPhone.trim() && !isLikelyPhone(emergencyContactPhone)) {
            setError("Enter a valid emergency contact phone number.");
            setIsLoading(false);
            return;
          }
        }
        await saveRegistrationStep(regId, {
          travel_consent_given: travelConsent,
          ...(travelConsent
            ? {
                legal_name: legalName || null,
                date_of_birth: dateOfBirth || null,
                seat_preference: seatPreference || null,
                dietary_restrictions: dietaryRestrictions || null,
                accessibility_needs: accessibilityNeeds || null,
                emergency_contact_name: emergencyContactName || null,
                emergency_contact_phone: emergencyContactPhone || null,
                gender: gender || null,
              }
            : {}),
        });
      } else if (step === 9) {
        await saveRegistrationStep(regId, {
          top_5_preferences: top5Preferences,
          blackout_list: blackoutList,
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
        <p className="text-gray-500">Your delegate registration has been submitted for review.</p>
      </div>
    );
  }

  const isLastStep = step === DELEGATE_WIZARD_STEPS.length - 1;

  return (
    <WizardShell
      currentStep={step}
      steps={DELEGATE_WIZARD_STEPS}
      onBack={step > 0 ? () => setStep(step - 1) : undefined}
      onNext={isLastStep ? handleSubmit : handleNext}
      nextLabel={isLastStep ? "Submit Registration" : "Next"}
      isLoading={isLoading}
      error={error}
    >
      {/* Step 0: Delegate Identification */}
      {step === 0 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Registering as delegate for <strong>{orgName}</strong>.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input type="text" required value={delegateName} onChange={(e) => setDelegateName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input type="text" value={delegateTitle} onChange={(e) => setDelegateTitle(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Work Email *</label>
              <input type="email" required value={delegateEmail} onChange={(e) => setDelegateEmail(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Work Phone</label>
              <input type="tel" value={workPhone} onChange={(e) => setWorkPhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Mobile Phone <span className="text-xs text-gray-400">(for travel coordination only — not shared with vendors)</span>
            </label>
            <input type="tel" value={mobilePhone} onChange={(e) => setMobilePhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Preferred Departure Airport</label>
            <input type="text" value={preferredAirport} onChange={(e) => setPreferredAirport(e.target.value)} placeholder="e.g., YYZ" className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={nexusTraveler} onChange={(e) => setNexusTraveler(e.target.checked)} className="rounded border-gray-300 text-[#D60001]" />
            <span className="text-sm text-gray-700">NEXUS / Trusted Traveler</span>
          </label>
        </div>
      )}

      {/* Step 1: Functional Roles */}
      {step === 1 && (
        <div className="space-y-2">
          <p className="text-sm text-gray-500 mb-3">Select up to 3 functional roles.</p>
          {FUNCTIONAL_ROLE_OPTIONS.map((opt) => (
            <label key={opt} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={functionalRoles.includes(opt)}
                disabled={!functionalRoles.includes(opt) && functionalRoles.length >= 3}
                onChange={(e) =>
                  e.target.checked
                    ? setFunctionalRoles([...functionalRoles, opt])
                    : setFunctionalRoles(functionalRoles.filter((x) => x !== opt))
                }
                className="rounded border-gray-300 text-[#D60001]"
              />
              <span className="text-sm text-gray-700">{opt}</span>
            </label>
          ))}
        </div>
      )}

      {/* Step 2: Purchasing Authority */}
      {step === 2 && (
        <div className="space-y-2">
          {PURCHASING_AUTHORITY_OPTIONS.map((opt) => (
            <label key={opt} className="flex items-center gap-2">
              <input type="radio" name="purchasingAuth" value={opt} checked={purchasingAuthority === opt} onChange={() => setPurchasingAuthority(opt)} className="border-gray-300 text-[#D60001]" />
              <span className="text-sm text-gray-700">{opt}</span>
            </label>
          ))}
        </div>
      )}

      {/* Step 3: Category Responsibilities */}
      {step === 3 && (
        <div className="space-y-2">
          <p className="text-sm text-gray-500 mb-3">Select up to 8 categories you&apos;re responsible for.</p>
          <div className="max-h-64 overflow-y-auto space-y-2">
            {PARTNER_SECONDARY_CATEGORIES.map((opt) => (
              <label key={opt} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={categoryResponsibilities.includes(opt)}
                  disabled={!categoryResponsibilities.includes(opt) && categoryResponsibilities.length >= 8}
                  onChange={(e) =>
                    e.target.checked
                      ? setCategoryResponsibilities([...categoryResponsibilities, opt])
                      : setCategoryResponsibilities(categoryResponsibilities.filter((x) => x !== opt))
                  }
                  className="rounded border-gray-300 text-[#D60001]"
                />
                <span className="text-sm text-gray-700">{opt}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Step 4: Buying Timeline */}
      {step === 4 && (
        <div className="space-y-2">
          {BUYING_CYCLE_OPTIONS.map((opt) => (
            <label key={opt} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={buyingTimeline.includes(opt)}
                onChange={(e) =>
                  e.target.checked
                    ? setBuyingTimeline([...buyingTimeline, opt])
                    : setBuyingTimeline(buyingTimeline.filter((x) => x !== opt))
                }
                className="rounded border-gray-300 text-[#D60001]"
              />
              <span className="text-sm text-gray-700">{opt}</span>
            </label>
          ))}
        </div>
      )}

      {/* Step 5: Top 3 Priorities */}
      {step === 5 && (
        <div className="space-y-2">
          <p className="text-sm text-gray-500 mb-3">Select exactly 3 priorities. ({topPriorities.length}/3)</p>
          {PRIORITY_OPTIONS.map((opt) => (
            <label key={opt} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={topPriorities.includes(opt)}
                disabled={!topPriorities.includes(opt) && topPriorities.length >= 3}
                onChange={(e) =>
                  e.target.checked
                    ? setTopPriorities([...topPriorities, opt])
                    : setTopPriorities(topPriorities.filter((x) => x !== opt))
                }
                className="rounded border-gray-300 text-[#D60001]"
              />
              <span className="text-sm text-gray-700">{opt}</span>
            </label>
          ))}
        </div>
      )}

      {/* Step 6: Meeting Intent */}
      {step === 6 && (
        <div className="space-y-2">
          {MEETING_OUTCOME_OPTIONS.map((opt) => (
            <label key={opt} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={meetingIntent.includes(opt)}
                onChange={(e) =>
                  e.target.checked
                    ? setMeetingIntent([...meetingIntent, opt])
                    : setMeetingIntent(meetingIntent.filter((x) => x !== opt))
                }
                className="rounded border-gray-300 text-[#D60001]"
              />
              <span className="text-sm text-gray-700">{opt}</span>
            </label>
          ))}
        </div>
      )}

      {/* Step 7: Success Definition */}
      {step === 7 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            How do you define a successful conference experience?
          </label>
          <textarea
            value={successDefinition}
            onChange={(e) => setSuccessDefinition(e.target.value)}
            rows={4}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>
      )}

      {/* Step 8: Travel & Logistics */}
      {step === 8 && (
        <div className="space-y-4">
          <ConsentGate
            consentType="travel"
            consentText="I consent to CSC storing my travel data for the purpose of coordinating travel arrangements for this conference."
            isRequired={travelConsentRequired}
            consentGiven={travelConsent}
            onConsentChange={setTravelConsent}
          >
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Legal Name (passport)</label>
                  <input type="text" value={legalName} onChange={(e) => setLegalName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date of Birth</label>
                  <input type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Seat Preference</label>
                <div className="flex gap-3">
                  {SEAT_PREFERENCE_OPTIONS.map((opt) => (
                    <label key={opt} className="flex items-center gap-1.5">
                      <input type="radio" name="seatPref" value={opt} checked={seatPreference === opt} onChange={() => setSeatPreference(opt)} className="border-gray-300 text-[#D60001]" />
                      <span className="text-sm text-gray-700">{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Dietary Restrictions</label>
                <textarea value={dietaryRestrictions} onChange={(e) => setDietaryRestrictions(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Accessibility Needs</label>
                <textarea value={accessibilityNeeds} onChange={(e) => setAccessibilityNeeds(e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Emergency Contact Name</label>
                  <input type="text" value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Emergency Contact Phone</label>
                  <input type="tel" value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Gender</label>
                <select value={gender} onChange={(e) => setGender(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                  <option value="">Prefer not to say</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
          </ConsentGate>
        </div>
      )}

      {/* Step 9: Partner Preferences */}
      {step === 9 && (
        <div className="space-y-6">
          <OrgMultiSelect
            organizations={exhibitorOrgs}
            selected={top5Preferences}
            onChange={setTop5Preferences}
            maxSelections={5}
            label="Top 5 Preferred Exhibitors"
            description="Select up to 5 exhibitors you most want to meet with."
          />
          <div>
            <OrgMultiSelect
              organizations={exhibitorOrgs}
              selected={blackoutList}
              onChange={setBlackoutList}
              label="Blackout List"
              description="Exhibitors you do NOT want to meet with."
            />
            <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
              Warning: Blackout entries are heavily weighted. Only blackout exhibitors you truly cannot meet with.
            </div>
          </div>
        </div>
      )}

      {/* Step 10: Legal Acceptance */}
      {step === 10 && (
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

      {/* Step 11: Review & Submit */}
      {step === 11 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-700">Review Your Registration</h3>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2 text-sm">
            <div><span className="text-gray-500">Organization:</span> {orgName}</div>
            <div><span className="text-gray-500">Name:</span> {delegateName || "Not set"}</div>
            <div><span className="text-gray-500">Work Email:</span> {delegateEmail || "Not set"}</div>
            <div><span className="text-gray-500">Functional Roles:</span> {functionalRoles.join(", ") || "None"}</div>
            <div><span className="text-gray-500">Purchasing Authority:</span> {purchasingAuthority || "Not set"}</div>
            <div><span className="text-gray-500">Categories:</span> {categoryResponsibilities.length}</div>
            <div><span className="text-gray-500">Top Priorities:</span> {topPriorities.join(", ") || "None"}</div>
            <div><span className="text-gray-500">Success:</span> {successDefinition.slice(0, 80)}{successDefinition.length > 80 ? "..." : ""}</div>
            <div><span className="text-gray-500">Travel Consent:</span> {travelConsent ? "Yes" : "No"}</div>
            <div><span className="text-gray-500">Preferred Exhibitors:</span> {top5Preferences.length}/5</div>
            <div><span className="text-gray-500">Blackout:</span> {blackoutList.length}</div>
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
