"use client";

import { useMemo, useState } from "react";
import {
  createRegistration,
  requestTravelWindowException,
  saveRegistrationStep,
  submitRegistration,
} from "@/lib/actions/conference-registration";
import { acceptLegalDocument } from "@/lib/actions/conference-legal";
import {
  parseRegistrationOptions,
  REGISTRATION_DB_COLUMN_BY_FIELD,
  REGISTRATION_FIELD_DEFS,
  type RegistrationFieldInputType,
  type RegistrationFieldKey,
} from "@/lib/conference/registration-schema";

type FieldValue = string | boolean | string[];
type RegistrationPayloadValue = string | boolean | string[];
type CanonicalFormValueRecord = Record<string, FieldValue>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ConferenceRow = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RegistrationRow = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LegalVersionRow = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LegalAcceptanceRow = Record<string, any>;

interface RegistrationOptionFormProps {
  conference: ConferenceRow;
  orgId: string;
  orgName: string;
  registrationType: "delegate" | "exhibitor";
  existingRegistration: RegistrationRow | null | undefined;
  legalDocs: LegalVersionRow[];
  acceptances: LegalAcceptanceRow[];
  optionsRaw: unknown;
  mePerson?: {
    name: string;
    email: string;
    title: string | null;
    work_phone: string | null;
    mobile_phone: string | null;
  } | null;
}

type TravelOpsClassification = {
  effectiveTravelSupportMode: string;
  travelBookingOwner: string;
  travelPaymentOwner: string;
  accommodationBookingOwner: string;
  accommodationPaymentOwner: string;
  airTravelAllowed: boolean | null;
  requiresTravelIntake: boolean | null;
  requiresAccommodationIntake: boolean | null;
  organizationDistanceKm: number | null;
  attendeeGuidance: string[];
};

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

function isDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value.trim());
}

function normalizeOptionValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : String(item ?? "")))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeFieldValue(value: unknown): FieldValue {
  if (Array.isArray(value)) {
    return normalizeOptionValues(value);
  }
  if (typeof value === "boolean") return value;
  return typeof value === "string" ? value : "";
}

function toAnswerKey(
  item: {
    type: "field" | "custom" | "break" | "title";
    field_key?: RegistrationFieldKey | null;
    custom_key?: string | null;
    id: string;
  },
): string | null {
  if (item.type === "custom") {
    return item.custom_key ?? item.id;
  }
  if (item.type === "field") {
    return item.field_key ?? null;
  }
  return null;
}

function getDefaultStringValues(): CanonicalFormValueRecord {
  return {
    display_name: "",
    contact_email: "",
    phone: "",
    mobile_phone: "",
    job_title: "",
    legal_name: "",
    departure_city: "",
    travel_mode: "",
    date_of_birth: "",
    dietary_needs: "",
    accessibility_needs: "",
    emergency_contact: "",
    organization: "",
  };
}

function extractTravelOpsClassification(
  registration: RegistrationRow | null | undefined
): TravelOpsClassification | null {
  if (!registration || typeof registration !== "object") return null;
  const customAnswers = (
    registration as { registration_custom_answers?: Record<string, unknown> | null }
  ).registration_custom_answers;
  if (!customAnswers || typeof customAnswers !== "object" || Array.isArray(customAnswers)) {
    return null;
  }
  const raw = customAnswers.travel_ops_classification;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const classification = raw as Record<string, unknown>;
  return {
    effectiveTravelSupportMode:
      typeof classification.effective_travel_support_mode === "string"
        ? classification.effective_travel_support_mode
        : "unknown",
    travelBookingOwner:
      typeof classification.travel_booking_owner === "string"
        ? classification.travel_booking_owner
        : "unknown",
    travelPaymentOwner:
      typeof classification.travel_payment_owner === "string"
        ? classification.travel_payment_owner
        : "unknown",
    accommodationBookingOwner:
      typeof classification.accommodation_booking_owner === "string"
        ? classification.accommodation_booking_owner
        : "unknown",
    accommodationPaymentOwner:
      typeof classification.accommodation_payment_owner === "string"
        ? classification.accommodation_payment_owner
        : "unknown",
    airTravelAllowed:
      typeof classification.air_travel_allowed === "boolean"
        ? classification.air_travel_allowed
        : null,
    requiresTravelIntake:
      typeof classification.requires_travel_intake === "boolean"
        ? classification.requires_travel_intake
        : null,
    requiresAccommodationIntake:
      typeof classification.requires_accommodation_intake === "boolean"
        ? classification.requires_accommodation_intake
        : null,
    organizationDistanceKm:
      typeof classification.organization_distance_to_destination_airport_km === "number" &&
      Number.isFinite(classification.organization_distance_to_destination_airport_km)
        ? classification.organization_distance_to_destination_airport_km
        : null,
    attendeeGuidance: Array.isArray(classification.attendee_guidance)
      ? classification.attendee_guidance.filter(
          (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
        )
      : [],
  };
}

export default function RegistrationOptionForm({
  conference,
  orgId,
  orgName,
  registrationType,
  existingRegistration,
  legalDocs,
  acceptances,
  optionsRaw,
  mePerson = null,
}: RegistrationOptionFormProps) {
  const options = useMemo(
    () =>
      parseRegistrationOptions(optionsRaw).filter(
        (option) => option.registration_type === registrationType
      ),
    [optionsRaw, registrationType]
  );

  const [optionId, setOptionId] = useState<string>(options[0]?.id ?? "");
  const selectedOption = options.find((option) => option.id === optionId) ?? options[0] ?? null;
  const [registrationId, setRegistrationId] = useState(existingRegistration?.id ?? "");
  const [isLoading, setIsLoading] = useState(false);
  const [isRequestingException, setIsRequestingException] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [exceptionReason, setExceptionReason] = useState("");
  const [submitted, setSubmitted] = useState(existingRegistration?.status === "submitted");
  const [acceptedLegalIds, setAcceptedLegalIds] = useState<Set<string>>(
    new Set(acceptances.map((acceptance) => acceptance.legal_version_id))
  );
  const [travelOpsClassification, setTravelOpsClassification] =
    useState<TravelOpsClassification | null>(() =>
      extractTravelOpsClassification(existingRegistration)
    );

  const [fieldValues, setFieldValues] = useState<CanonicalFormValueRecord>(() => {
    const base: CanonicalFormValueRecord = {
      ...getDefaultStringValues(),
      display_name:
        (existingRegistration?.delegate_name as string | null) ??
        mePerson?.name ??
        "",
      contact_email:
        (existingRegistration?.delegate_email as string | null) ??
        mePerson?.email ??
        "",
      phone:
        (existingRegistration?.delegate_work_phone as string | null) ??
        mePerson?.work_phone ??
        "",
      mobile_phone:
        (existingRegistration?.mobile_phone as string | null) ??
        mePerson?.mobile_phone ??
        "",
      job_title:
        (existingRegistration?.delegate_title as string | null) ??
        mePerson?.title ??
        "",
      legal_name: existingRegistration?.legal_name ?? "",
      departure_city: existingRegistration?.preferred_departure_airport ?? "",
      travel_mode: (existingRegistration?.travel_mode as string | null) ?? "",
      date_of_birth: existingRegistration?.date_of_birth ?? "",
      dietary_needs: existingRegistration?.dietary_restrictions ?? "",
      accessibility_needs: existingRegistration?.accessibility_needs ?? "",
      emergency_contact: existingRegistration?.emergency_contact_name ?? "",
      organization: orgName,
    };

    const customAnswers =
      existingRegistration &&
      ((existingRegistration as unknown as { registration_custom_answers?: Record<string, unknown> })
        .registration_custom_answers as Record<string, unknown> | undefined);

    if (!customAnswers || typeof customAnswers !== "object") {
      return base;
    }

    const merged: CanonicalFormValueRecord = { ...base };
    Object.entries(customAnswers).forEach(([key, value]) => {
      merged[key] = normalizeFieldValue(value);
    });
    return merged;
  });

  const getItemOptions = (
    inputType: RegistrationFieldInputType,
    customOptions: string[] | undefined,
    fallback?: string[]
  ): string[] => {
    if (inputType === "radio" || inputType === "select" || inputType === "multiselect") {
      return customOptions && customOptions.length > 0 ? customOptions : fallback ?? [];
    }
    return fallback ?? [];
  };

  const resolveFieldType = (
    itemType: "field" | "custom",
    fieldKey: RegistrationFieldKey | null | undefined,
    overrideType: RegistrationFieldInputType | undefined
  ): RegistrationFieldInputType => {
    if (overrideType) return overrideType;
    if (itemType === "field" && fieldKey) {
      return REGISTRATION_FIELD_DEFS[fieldKey]?.inputType ?? "text";
    }
    return "text";
  };

  const validateFieldValue = (params: {
    label: string;
    inputType: RegistrationFieldInputType;
    required: boolean;
    options: string[];
    value: FieldValue;
  }): string | null => {
    const { label, inputType, required, options, value } = params;

    if (required) {
      if (typeof value === "string") {
        if (!value.trim()) return `${label} is required.`;
      } else if (typeof value === "boolean") {
        if (!value) return `${label} is required.`;
      } else if (!value.length) {
        return `${label} is required.`;
      }
    }

    if (inputType === "email" && typeof value === "string" && value.trim() && !isValidEmail(value)) {
      return `${label} must be a valid email address.`;
    }
    if (inputType === "phone" && typeof value === "string" && value.trim() && !isLikelyPhone(value)) {
      return `${label} must be a valid phone number.`;
    }
    if (inputType === "number" && typeof value === "string" && value.trim() && Number.isNaN(Number(value))) {
      return `${label} must be a valid number.`;
    }
    if (inputType === "date" && typeof value === "string" && value.trim() && !isIsoDate(value)) {
      return `${label} must be in YYYY-MM-DD format.`;
    }
    if (inputType === "datetime" && typeof value === "string" && value.trim() && !isDateTime(value)) {
      return `${label} must be in YYYY-MM-DDTHH:mm format.`;
    }
    if (
      (inputType === "select" || inputType === "radio") &&
      typeof value === "string" &&
      value.trim() &&
      options.length > 0 &&
      !options.includes(value)
    ) {
      return `${label} contains an invalid selection.`;
    }
    if (inputType === "multiselect" && Array.isArray(value)) {
      const badValues = value.filter((entry) => options.length > 0 && !options.includes(entry));
      if (badValues.length > 0) {
        return `${label} contains unsupported selections.`;
      }
    }
    return null;
  };

  const ensureRegistration = async (): Promise<string | null> => {
    if (registrationId) return registrationId;
    const result = await createRegistration(conference.id, registrationType, orgId);
    if (!result.success || !result.data) {
      setError(result.error ?? "Failed to create registration.");
      return null;
    }
    setRegistrationId(result.data.id);
    return result.data.id;
  };

  const toggleMultiSelectValue = (current: FieldValue, optionValue: string): FieldValue => {
    const next = new Set(Array.isArray(current) ? current : []);
    if (next.has(optionValue)) {
      next.delete(optionValue);
    } else {
      next.add(optionValue);
    }
    return [...next];
  };

  const setFieldAnswer = (key: string, value: FieldValue): void => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveAndSubmit = async (submitAfterSave = true) => {
    if (!selectedOption) return;

    setIsLoading(true);
    setError(null);
    setInfoMessage(null);

    try {
      const regId = await ensureRegistration();
      if (!regId) {
        setIsLoading(false);
        return;
      }

      const update: Record<string, unknown> = {};
      const customAnswers: Record<string, RegistrationPayloadValue> = {};

      for (const item of selectedOption.form_items) {
        if (item.type === "break" || item.type === "title") continue;

        if (item.type === "custom") {
          const key = toAnswerKey(item);
          if (!key) continue;
          const value = fieldValues[key] ?? "";
          const inputType = resolveFieldType("custom", null, item.custom_input_type);
          const options = getItemOptions(inputType, item.custom_options);
          const validationError = validateFieldValue({
            label: item.label || "Custom question",
            inputType,
            required: item.state === "required",
            options,
            value,
          });
          if (validationError) {
            setError(validationError);
            setIsLoading(false);
            return;
          }
          customAnswers[key] = value;
          continue;
        }

        if (item.type !== "field" || !item.field_key) continue;

        const def = REGISTRATION_FIELD_DEFS[item.field_key];
        const label = item.label || def.label;
        const value = fieldValues[item.field_key] ?? "";
        const inputType = resolveFieldType("field", item.field_key, item.custom_input_type);
        const options = getItemOptions(inputType, item.custom_options, def.options);

        const validationError = validateFieldValue({
          label,
          inputType,
          required: item.state === "required",
          options,
          value,
        });
        if (validationError) {
          setError(validationError);
          setIsLoading(false);
          return;
        }

        const column = REGISTRATION_DB_COLUMN_BY_FIELD[item.field_key];
        if (!column) continue;

        if (Array.isArray(value)) {
          update[column] = value.join(",");
        } else if (typeof value === "boolean") {
          update[column] = value;
        } else {
          update[column] = value.trim() || null;
        }
      }

      customAnswers.registration_option_id = selectedOption.id;
      customAnswers.registration_option_name = selectedOption.name;
      customAnswers.registration_product_ids = selectedOption.linked_product_ids;
      customAnswers.registration_primary_product_id =
        selectedOption.linked_product_ids[0] ?? "";

      update.registration_custom_answers = customAnswers;

      const saveResult = await saveRegistrationStep(regId, update);
      if (!saveResult.success) {
        setError(saveResult.error ?? "Failed to save registration.");
        setIsLoading(false);
        return;
      }
      setTravelOpsClassification(extractTravelOpsClassification(saveResult.data));

      if (!submitAfterSave) {
        setInfoMessage("Draft saved. Travel guidance refreshed below.");
        setIsLoading(false);
        return;
      }

      if (acceptedLegalIds.size < legalDocs.length) {
        setError("All legal documents must be accepted before submitting.");
        setIsLoading(false);
        return;
      }

      const submitResult = await submitRegistration(regId);
      if (!submitResult.success) {
        setError(submitResult.error ?? "Failed to submit registration.");
        setIsLoading(false);
        return;
      }

      setSubmitted(true);
    } finally {
      setIsLoading(false);
    }
  };

  const canRequestTravelException =
    !!error &&
    /outside the policy window/i.test(error) &&
    !!(registrationId || existingRegistration?.id);

  const handleRequestTravelException = async () => {
    const reason = exceptionReason.trim();
    if (!reason) {
      setError("Please provide a brief reason for the travel-window exception request.");
      return;
    }

    setIsRequestingException(true);
    try {
      const targetRegistrationId = registrationId || existingRegistration?.id || "";
      if (!targetRegistrationId) {
        setError("Unable to request exception before a registration draft exists.");
        return;
      }
      const result = await requestTravelWindowException(targetRegistrationId, reason);
      if (!result.success) {
        setError(result.error ?? "Failed to request travel-window exception.");
        return;
      }
      setError(
        "Travel-window exception requested. An admin must approve this request before submission."
      );
      setExceptionReason("");
    } finally {
      setIsRequestingException(false);
    }
  };

  if (!selectedOption) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        No structured registration option is configured for this registration type yet.
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold text-gray-900 mb-2">Registration Submitted</h2>
        <p className="text-gray-500">Your registration has been submitted for review.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {infoMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {infoMessage}
        </div>
      ) : null}

      {travelOpsClassification ? (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <p className="font-medium">Travel Ops Guidance</p>
          <p className="mt-1 text-xs">
            Support mode: <span className="font-medium">{travelOpsClassification.effectiveTravelSupportMode}</span>
            {" · "}
            Air travel:{" "}
            <span className="font-medium">
              {travelOpsClassification.airTravelAllowed === null
                ? "unknown"
                : travelOpsClassification.airTravelAllowed
                  ? "allowed"
                  : "not allowed"}
            </span>
            {" · "}
            Travel intake:{" "}
            <span className="font-medium">
              {travelOpsClassification.requiresTravelIntake === null
                ? "default"
                : travelOpsClassification.requiresTravelIntake
                  ? "required"
                  : "optional"}
            </span>
            {" · "}
            Accommodation intake:{" "}
            <span className="font-medium">
              {travelOpsClassification.requiresAccommodationIntake === null
                ? "default"
                : travelOpsClassification.requiresAccommodationIntake
                  ? "required"
                  : "optional"}
            </span>
            {travelOpsClassification.organizationDistanceKm != null
              ? ` · Distance: ~${Math.round(travelOpsClassification.organizationDistanceKm)} km`
              : ""}
          </p>
          <p className="mt-1 text-xs">
            Travel booking/payment:{" "}
            <span className="font-medium">
              {travelOpsClassification.travelBookingOwner}/{travelOpsClassification.travelPaymentOwner}
            </span>
            {" · "}
            Accommodation booking/payment:{" "}
            <span className="font-medium">
              {travelOpsClassification.accommodationBookingOwner}/{travelOpsClassification.accommodationPaymentOwner}
            </span>
          </p>
          {travelOpsClassification.attendeeGuidance.length > 0 ? (
            <ul className="mt-2 space-y-1 text-xs">
              {travelOpsClassification.attendeeGuidance.map((line) => (
                <li key={line}>• {line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {canRequestTravelException ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            Request travel-window exception
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Provide a short reason for admin review.
          </p>
          <textarea
            value={exceptionReason}
            onChange={(event) => setExceptionReason(event.target.value)}
            rows={3}
            className="mt-2 block w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900"
            placeholder="Reason for outside-window travel request..."
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => void handleRequestTravelException()}
              disabled={isRequestingException}
              className="rounded-md bg-[#EE2A2E] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
            >
              {isRequestingException ? "Requesting..." : "Request Exception"}
            </button>
          </div>
        </div>
      ) : null}

      {options.length > 1 ? (
        <label className="block text-sm text-gray-700">
          Registration path
          <select
            value={selectedOption.id}
            onChange={(event) => setOptionId(event.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-600 mb-3">
          Registering <strong>{orgName}</strong> for <strong>{conference.name}</strong>.
        </p>
        <div className="space-y-4">
          {selectedOption.form_items.map((item) => {
            if (item.type === "break") {
              return <hr key={item.id} className="border-gray-200" />;
            }
            if (item.type === "title") {
              return (
                <h3 key={item.id} className="text-sm font-semibold text-gray-900">
                  {item.label}
                </h3>
              );
            }

            const isCustom = item.type === "custom";
            const key = toAnswerKey(item);
            if (!key) return null;

            const fieldKey = isCustom ? null : (key as RegistrationFieldKey);
            const def = fieldKey ? REGISTRATION_FIELD_DEFS[fieldKey] : null;
            const label = isCustom ? item.label || "Custom question" : item.label || def?.label || "Form field";
            const required = item.state === "required";
            const inputType = isCustom
              ? resolveFieldType("custom", null, item.custom_input_type)
              : resolveFieldType("field", fieldKey, item.custom_input_type);
            const optionsForInput = getItemOptions(
              inputType,
              item.custom_options,
              def?.options
            );

            const value = fieldValues[key] ?? "";

            if (inputType === "boolean") {
              return (
                <label key={item.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(event) => setFieldAnswer(key, event.target.checked)}
                  />
                  <span>
                    {label}
                    {required ? " *" : ""}
                  </span>
                </label>
              );
            }

            if (inputType === "select") {
              return (
                <label key={item.id} className="block text-sm text-gray-700">
                  {label}
                  {required ? " *" : ""}
                  <select
                    value={typeof value === "string" ? value : ""}
                    onChange={(event) => setFieldAnswer(key, event.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select…</option>
                    {optionsForInput.map((option) => (
                      <option key={`${key}-${option}`} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              );
            }

            if (inputType === "radio") {
              return (
                <fieldset key={item.id} className="space-y-2">
                  <legend className="text-sm font-medium text-gray-700">
                    {label}
                    {required ? " *" : ""}
                  </legend>
                  <div className="space-y-1">
                    {optionsForInput.map((option) => (
                      <label key={`${key}-${option}`} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="radio"
                          name={`radio-${item.id}`}
                          checked={value === option}
                          onChange={() => setFieldAnswer(key, option)}
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            }

            if (inputType === "multiselect") {
              const checked = Array.isArray(value) ? value : normalizeOptionValues(value);
              return (
                <fieldset key={item.id} className="space-y-2">
                  <legend className="text-sm font-medium text-gray-700">
                    {label}
                    {required ? " *" : ""}
                  </legend>
                  <div className="space-y-1">
                    {optionsForInput.map((option) => {
                      const isChecked = checked.includes(option);
                      return (
                        <label key={`${key}-${option}`} className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() =>
                                setFieldValues((prev) => ({ ...prev, [key]: toggleMultiSelectValue(prev[key] ?? [], option) }))
                              }
                            />
                          <span>{option}</span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              );
            }

            if (inputType === "textarea") {
              return (
                <label key={item.id} className="block text-sm text-gray-700">
                  {label}
                  {required ? " *" : ""}
                  <textarea
                    value={typeof value === "string" ? value : ""}
                    onChange={(event) =>
                      setFieldAnswer(key, event.target.value)
                    }
                    rows={3}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              );
            }

            const htmlType =
              inputType === "phone"
                ? "tel"
                : inputType === "datetime"
                  ? "datetime-local"
                  : inputType === "number"
                    ? "number"
                    : inputType === "email"
                      ? "email"
                      : "text";

            return (
              <label key={item.id} className="block text-sm text-gray-700">
                {label}
                {required ? " *" : ""}
                <input
                  type={htmlType}
                  value={typeof value === "string" ? value : ""}
                  onChange={(event) => setFieldAnswer(key, event.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Legal Acceptance</h3>
        {legalDocs.length === 0 ? (
          <p className="text-sm text-gray-500">No legal documents to accept.</p>
        ) : (
          legalDocs.map((doc) => (
            <div key={doc.id} className="rounded border border-gray-200 p-3">
              <div className="flex items-start justify-between mb-2">
                <p className="text-sm font-medium text-gray-900">{doc.document_type}</p>
                {acceptedLegalIds.has(doc.id) ? <span className="text-xs font-medium text-green-700">Accepted</span> : null}
              </div>
              <div className="max-h-24 overflow-y-auto text-xs text-gray-600 whitespace-pre-wrap">
                {doc.content}
              </div>
              {!acceptedLegalIds.has(doc.id) ? (
                <button
                  type="button"
                  onClick={async () => {
                    const result = await acceptLegalDocument(doc.id);
                    if (result.success) {
                      setAcceptedLegalIds((prev) => new Set([...prev, doc.id]));
                    }
                  }}
                  className="mt-2 text-sm font-medium text-[#EE2A2E] hover:underline"
                >
                  I accept these terms
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void handleSaveAndSubmit(false)}
          disabled={isLoading}
          className="mr-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {isLoading ? "Saving..." : "Save Draft & Refresh Guidance"}
        </button>
        <button
          type="button"
          onClick={() => void handleSaveAndSubmit()}
          disabled={isLoading}
          className="rounded-md bg-[#EE2A2E] px-4 py-2 text-sm font-medium text-white hover:bg-[#b50001] disabled:opacity-50"
        >
          {isLoading ? "Submitting..." : "Save & Submit Registration"}
        </button>
      </div>
    </div>
  );
}
