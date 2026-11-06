"use server";

/**
 * Self check-in on the attendee's own phone: the link in their check-in email.
 *
 * ⛔ The emailed token IS the authority, exactly as the badge's QR is at the
 * desk; a login is not required (most attendees have never signed in). Every
 * action re-checks that phone check-in is on and that today is a conference
 * day, because the page that showed the button may be hours old.
 *
 * The kiosk does NOT come through here: it is a staff device, and checks in
 * through the desk's own scan route with `self_service` set.
 */

import { getOptionalAuthContext } from "@/lib/auth/guards";
import { runCheckInScan, type CheckInScanResultState } from "@/lib/conference/check-in-scan";
import { recordOwedAgreements } from "@/lib/conference/check-in-agreements";
import { resolveSelfCheckIn } from "@/lib/conference/self-check-in-server";
import { outcomeFor, type SelfCheckInOutcome } from "@/lib/conference/self-check-in";
import type { OwedAgreement } from "@/lib/conference/legal-acceptance";

export type SelfCheckInResult =
  | { success: false; error: string }
  | {
      success: true;
      data: {
        state: CheckInScanResultState;
        owed: OwedAgreement[];
        /** Set once they are in: what to do next. */
        outcome: SelfCheckInOutcome | null;
        note: string | null;
      };
    };

const CLOSED = "Checking in on your phone is not open right now. Please see the registration desk.";

export async function checkMeIn(params: { token: string }): Promise<SelfCheckInResult> {
  const ctx = await resolveSelfCheckIn(params.token);
  if (!ctx) return { success: false, error: "This check-in link does not work. Please see the registration desk." };
  if (!ctx.phoneOpen) return { success: false, error: CLOSED };

  // Who is holding the phone, when they are signed in. Recorded, never required.
  const viewer = await getOptionalAuthContext().catch(() => null);
  const result = await runCheckInScan({
    conferenceId: ctx.conferenceId,
    qrToken: params.token,
    deviceId: "self-phone",
    actor: { route: "phone", userId: viewer?.userId ?? null },
  });
  if (!result.success || !result.data) return { success: false, error: result.error ?? "Check-in failed." };
  const inNow = result.data.state === "valid" || result.data.state === "already_checked_in";
  return {
    success: true,
    data: {
      state: result.data.state,
      owed: result.data.owed ?? [],
      outcome: inNow ? outcomeFor(ctx.settings, "phone", ctx.lastName) : null,
      note: inNow ? ctx.settings.note : null,
    },
  };
}

export async function acceptMyAgreements(params: {
  token: string;
  versionIds: string[];
}): Promise<{ success: true; data: { stillOwed: number } } | { success: false; error: string }> {
  const ctx = await resolveSelfCheckIn(params.token);
  if (!ctx) return { success: false, error: "This check-in link does not work. Please see the registration desk." };
  if (!ctx.phoneOpen) return { success: false, error: CLOSED };
  const viewer = await getOptionalAuthContext().catch(() => null);
  return recordOwedAgreements({
    conferenceId: ctx.conferenceId,
    personId: ctx.personId,
    versionIds: params.versionIds,
    via: "self",
    recordedBy: viewer?.userId ?? null,
  });
}
