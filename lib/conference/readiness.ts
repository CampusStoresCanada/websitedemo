export type ConferenceReadinessInput = {
  personKind: string | null;
  displayName: string | null;
  contactEmail: string | null;
  assignmentStatus: string | null;
  travelMode: string | null;
  roadOriginAddress: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  dataQualityFlags: string[] | null;
};

export type ConferenceReadinessSnapshot = {
  missing: string[];
  blockers: string[];
  isReady: boolean;
};

export function computeConferenceReadiness(
  input: ConferenceReadinessInput
): ConferenceReadinessSnapshot {
  const missing: string[] = [];

  if (!input.displayName?.trim()) missing.push("Display name");
  if (!input.contactEmail?.trim()) missing.push("Contact email");
  if (!input.travelMode?.trim()) missing.push("Travel mode");
  if (input.travelMode === "road" && !input.roadOriginAddress?.trim()) {
    missing.push("Road origin address");
  }

  const requiresEmergencyContact =
    input.assignmentStatus === "assigned" &&
    (input.personKind === "delegate" || input.personKind === "observer");
  if (requiresEmergencyContact) {
    if (!input.emergencyContactName?.trim()) missing.push("Emergency contact name");
    if (!input.emergencyContactPhone?.trim()) missing.push("Emergency contact phone");
  }

  const blockers = (input.dataQualityFlags ?? []).filter((flag) => flag.trim().length > 0);

  return {
    missing,
    blockers,
    isReady: missing.length === 0 && blockers.length === 0,
  };
}
