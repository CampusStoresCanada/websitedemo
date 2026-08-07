import { NextRequest, NextResponse } from "next/server";
import { listConditions, createCondition } from "@/lib/comms/conditions/store";
import type { ConditionOperator, ConditionSubjectKey } from "@/lib/comms/conditions/registry";

/**
 * GET  /api/admin/comms/conditions — list saved conditions for the "Insert Conditional" picker.
 * POST /api/admin/comms/conditions — create a new saved condition, returns its key.
 */
export async function GET() {
  const conditions = await listConditions();
  return NextResponse.json({ conditions });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    label: string;
    subject: ConditionSubjectKey;
    referenceId?: string;
    field: string;
    operator: ConditionOperator;
    value?: string;
  };

  if (!body.label || !body.subject || !body.field || !body.operator) {
    return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
  }

  const result = await createCondition(body);
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
