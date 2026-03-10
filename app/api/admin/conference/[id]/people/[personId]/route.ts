import { NextRequest, NextResponse } from "next/server";
import { requireConferenceOpsAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  applyCanonicalConferencePersonIdentityEdit,
  markConferencePersonCheckedInManual,
  reprintConferenceBadge,
  updateConferencePersonOps,
} from "@/lib/actions/conference-people";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; personId: string }> }
) {
  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: conferenceId, personId } = await context.params;
  const db = createAdminClient();
  const { data: person, error: personError } = await db
    .from("conference_people")
    .select("id")
    .eq("id", personId)
    .eq("conference_id", conferenceId)
    .maybeSingle();
  if (personError) {
    return NextResponse.json(
      { error: `Failed to validate conference person: ${personError.message}` },
      { status: 500 }
    );
  }
  if (!person) {
    return NextResponse.json(
      { error: "Conference person not found for this conference." },
      { status: 404 }
    );
  }

  let payload: {
    op?: "update" | "manual_check_in" | "reprint_badge";
    patch?: Record<string, unknown>;
    reprintReason?: "damaged" | "lost" | "name_change" | "ops_override";
    reprintNote?: string | null;
    transportMethod?: "pdf" | "printer_bridge";
    canonicalPatch?: {
      displayName?: string | null;
      contactEmail?: string | null;
      roleTitle?: string | null;
    };
  };
  try {
    payload = (await request.json()) as {
      op?: "update" | "manual_check_in" | "reprint_badge";
      patch?: Record<string, unknown>;
      reprintReason?: "damaged" | "lost" | "name_change" | "ops_override";
      reprintNote?: string | null;
      transportMethod?: "pdf" | "printer_bridge";
      canonicalPatch?: {
        displayName?: string | null;
        contactEmail?: string | null;
        roleTitle?: string | null;
      };
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (payload.op === "manual_check_in") {
    const result = await markConferencePersonCheckedInManual(personId);
    if (!result.success) {
      const lowerError = result.error?.toLowerCase() ?? "";
      const status =
        lowerError.includes("access required") || lowerError.includes("not authorized")
          ? 403
          : 500;
      return NextResponse.json(
        { error: result.error ?? "Failed to apply manual check-in." },
        { status }
      );
    }
    return NextResponse.json(result.data ?? null);
  }

  if (payload.op === "reprint_badge") {
    if (!payload.reprintReason) {
      return NextResponse.json(
        { error: "reprintReason is required for badge reprints." },
        { status: 400 }
      );
    }
    if (payload.canonicalPatch) {
      const canonicalEdit = await applyCanonicalConferencePersonIdentityEdit(personId, {
        displayName: payload.canonicalPatch.displayName ?? null,
        contactEmail: payload.canonicalPatch.contactEmail ?? null,
        roleTitle: payload.canonicalPatch.roleTitle ?? null,
      });
      if (!canonicalEdit.success) {
        return NextResponse.json(
          { error: canonicalEdit.error ?? "Failed to apply canonical edits before reprint." },
          { status: 500 }
        );
      }
    }

    const result = await reprintConferenceBadge(
      personId,
      payload.reprintReason,
      payload.reprintNote ?? null
    );
    if (!result.success) {
      const lowerError = result.error?.toLowerCase() ?? "";
      const status =
        lowerError.includes("access required") || lowerError.includes("not authorized")
          ? 403
          : 500;
      return NextResponse.json(
        { error: result.error ?? "Failed to reprint badge." },
        { status }
      );
    }
    return NextResponse.json(result.data ?? null);
  }

  const identityKeys = ["display_name", "contact_email", "role_title"];
  const attemptedIdentity = Object.keys(payload.patch ?? {}).filter((key) =>
    identityKeys.includes(key)
  );
  if (attemptedIdentity.length > 0) {
    return NextResponse.json(
      {
        error:
          "Identity fields must be updated via canonicalPatch (canonical-first), not op=update.",
      },
      { status: 400 }
    );
  }

  const result = await updateConferencePersonOps(personId, payload.patch ?? {});
  if (!result.success) {
    const lowerError = result.error?.toLowerCase() ?? "";
    const status =
      lowerError.includes("access required") || lowerError.includes("not authorized")
        ? 403
        : 500;
    return NextResponse.json(
      { error: result.error ?? "Failed to update conference person." },
      { status }
    );
  }
  return NextResponse.json({ success: true });
}
