export type RegistrationFieldKey =
  | "display_name"
  | "contact_email"
  | "phone"
  | "mobile_phone"
  | "organization"
  | "job_title"
  | "dietary_needs"
  | "accessibility_needs"
  | "legal_name"
  | "departure_city"
  | "arrival_date"
  | "departure_date"
  | "travel_mode"
  | "date_of_birth"
  | "known_traveler_number"
  | "passport_number"
  | "passport_expiry"
  | "citizenship"
  | "check_in_date"
  | "check_out_date"
  | "room_occupancy"
  | "room_type_preference"
  | "roommate_preference"
  | "hotel_preference"
  | "hotel_loyalty_number"
  | "special_requests"
  | "waiver_ack"
  | "emergency_contact";

export type RegistrationFieldState = "required" | "optional";
export type RegistrationFieldInputType =
  | "text"
  | "email"
  | "phone"
  | "number"
  | "date"
  | "datetime"
  | "radio"
  | "select"
  | "multiselect"
  | "textarea"
  | "boolean";

export type RegistrationOptionFormItem = {
  id: string;
  type: "field" | "custom" | "break" | "title";
  field_key: RegistrationFieldKey | null;
  label: string;
  state: RegistrationFieldState;
  custom_key?: string;
  custom_input_type?: RegistrationFieldInputType;
  custom_options?: string[];
};

export type RegistrationOption = {
  id: string;
  name: string;
  registration_type: "delegate" | "exhibitor" | "speaker" | "observer" | "staff";
  linked_product_ids: string[];
  form_items: RegistrationOptionFormItem[];
  notes: string;
};

export const REGISTRATION_FIELD_DEFS: Record<
  RegistrationFieldKey,
  {
    label: string;
    inputType: RegistrationFieldInputType;
    options?: string[];
  }
> = {
  display_name: { label: "Preferred name", inputType: "text" },
  contact_email: { label: "Contact email", inputType: "email" },
  phone: { label: "Phone number", inputType: "phone" },
  mobile_phone: { label: "Mobile phone", inputType: "phone" },
  organization: { label: "Organization", inputType: "text" },
  job_title: { label: "Job title", inputType: "text" },
  dietary_needs: { label: "Dietary needs", inputType: "textarea" },
  accessibility_needs: { label: "Accessibility needs", inputType: "textarea" },
  legal_name: { label: "Legal name", inputType: "text" },
  departure_city: { label: "Departure city/airport", inputType: "text" },
  arrival_date: { label: "Arrival date/time", inputType: "datetime" },
  departure_date: { label: "Departure date/time", inputType: "datetime" },
  travel_mode: {
    label: "Travel mode",
    inputType: "select",
    options: ["Air", "Rail", "Bus/Coach", "Personal Vehicle", "Other"],
  },
  date_of_birth: { label: "Date of birth", inputType: "date" },
  known_traveler_number: { label: "Known traveler number", inputType: "text" },
  passport_number: { label: "Passport number", inputType: "text" },
  passport_expiry: { label: "Passport expiry", inputType: "date" },
  citizenship: { label: "Citizenship", inputType: "text" },
  check_in_date: { label: "Request alternate check-in date", inputType: "date" },
  check_out_date: { label: "Request alternate check-out date", inputType: "date" },
  room_occupancy: {
    label: "Room occupancy preference",
    inputType: "select",
    options: ["Single", "Double", "Shared"],
  },
  room_type_preference: {
    label: "Room type preference",
    inputType: "select",
    options: ["Standard", "Accessible", "King", "Two Queen", "Other"],
  },
  roommate_preference: { label: "Roommate preference", inputType: "text" },
  hotel_preference: {
    label: "Hotel preference",
    inputType: "select",
    options: ["Primary Block", "Secondary Block", "No Preference"],
  },
  hotel_loyalty_number: { label: "Hotel loyalty number", inputType: "text" },
  special_requests: { label: "Special requests", inputType: "textarea" },
  waiver_ack: { label: "Waiver acknowledgment", inputType: "boolean" },
  emergency_contact: { label: "Emergency contact", inputType: "text" },
};

export const REGISTRATION_DB_COLUMN_BY_FIELD: Partial<Record<RegistrationFieldKey, string>> = {
  display_name: "delegate_name",
  contact_email: "delegate_email",
  phone: "delegate_work_phone",
  mobile_phone: "mobile_phone",
  job_title: "delegate_title",
  dietary_needs: "dietary_restrictions",
  accessibility_needs: "accessibility_needs",
  legal_name: "legal_name",
  departure_city: "preferred_departure_airport",
  travel_mode: "travel_mode",
  date_of_birth: "date_of_birth",
  emergency_contact: "emergency_contact_name",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export function parseRegistrationOptions(
  value: unknown
): RegistrationOption[] {
  if (!Array.isArray(value)) return [];
  const parsed: RegistrationOption[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const registration_type = raw.registration_type;
    if (
      registration_type !== "delegate" &&
      registration_type !== "exhibitor" &&
      registration_type !== "speaker" &&
      registration_type !== "observer" &&
      registration_type !== "staff"
    ) {
      continue;
    }
    const form_items_raw = Array.isArray(raw.form_items) ? raw.form_items : [];
    const form_items: RegistrationOptionFormItem[] = form_items_raw
      .filter(isRecord)
      .map((item, idx) => {
        const type =
          item.type === "field" ||
          item.type === "custom" ||
          item.type === "break" ||
          item.type === "title"
            ? item.type
            : "title";
        const field_key =
          typeof item.field_key === "string" && item.field_key in REGISTRATION_FIELD_DEFS
            ? (item.field_key as RegistrationFieldKey)
            : null;
        const state =
          item.state === "required" || item.state === "optional" ? item.state : "optional";
        return {
          id: typeof item.id === "string" ? item.id : `item-${idx + 1}`,
          type,
          field_key,
          label:
            typeof item.label === "string" && item.label.trim().length > 0
              ? item.label
              : "Legacy custom prompt (unsupported)",
          state,
          custom_key:
            typeof item.custom_key === "string" && item.custom_key.trim().length > 0
              ? item.custom_key.trim()
              : undefined,
        custom_input_type:
            item.custom_input_type === "text" ||
            item.custom_input_type === "email" ||
            item.custom_input_type === "phone" ||
            item.custom_input_type === "number" ||
            item.custom_input_type === "date" ||
            item.custom_input_type === "datetime" ||
            item.custom_input_type === "radio" ||
            item.custom_input_type === "select" ||
            item.custom_input_type === "multiselect" ||
            item.custom_input_type === "textarea" ||
            item.custom_input_type === "boolean"
              ? item.custom_input_type
              : undefined,
          custom_options: Array.isArray(item.custom_options)
            ? item.custom_options.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
            : undefined,
        };
      });
    parsed.push({
      id: typeof raw.id === "string" ? raw.id : `option-${parsed.length + 1}`,
      name: typeof raw.name === "string" ? raw.name : `Option ${parsed.length + 1}`,
      registration_type,
      linked_product_ids: asStringArray(raw.linked_product_ids),
      form_items,
      notes: typeof raw.notes === "string" ? raw.notes : "",
    });
  }
  return parsed;
}
