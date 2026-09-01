import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='getClaims']",
          message:
            "Use centralized auth guards from lib/auth/guards.ts instead of direct getClaims() in feature code.",
        },
        {
          // Template-literal form: `db.from(`entity_balance_seats`)`. AST-wise a
          // TemplateLiteral has no `.value`, so the selector below misses it
          // entirely — a backtick is a typo, not a deliberate bypass.
          selector:
            "CallExpression[callee.property.name='from'][arguments.0.type='TemplateLiteral'][arguments.0.quasis.0.value.raw='entity_balance_seats']",
          message:
            "Use loadSeatHoldings() from lib/conference/seats.ts. Seat reads have one shape; if it cannot answer your question, widen it there so every caller gets the fix.",
        },
        {
          // Reverse embedded join: reaching seats through another table's
          // select string, e.g. .from("conference_people").select("...entity_balance_seats(...)").
          selector:
            "CallExpression[callee.property.name='select'][arguments.0.value=/entity_balance_seats/]",
          message:
            "Reaching entity_balance_seats through an embedded join is still a seat read. Use loadSeatHoldings() from lib/conference/seats.ts.",
        },
        {
          // "Who has assigned seats and what type are they?" has ONE answer.
          // Before the rule there were 19 query sites in 12 files, in eight
          // different shapes — including two spellings of the same join.
          selector:
            "CallExpression[callee.property.name='from'][arguments.0.value='entity_balance_seats']",
          message:
            "Use loadSeatHoldings() from lib/conference/seats.ts. Seat reads have one shape; if it cannot answer your question, widen it there so every caller gets the fix.",
        },
        {
          // conference_registrations is the v2 person-monolith: 68 columns,
          // 0 rows, and NO writer anywhere — not in app code, not in a DB
          // function. v3 split it into conference_people, entity_balance_seats,
          // the entity graph and organizations.procurement_info.
          //
          // It stayed load-bearing because six tables FK'd to it, so the
          // scheduler asked a dead table who was coming, got nobody, and raised
          // INSUFFICIENT_ACTIVE_REGISTRATIONS while people sat named on seats.
          // The meeting system now keys on seats.
          //
          // ⛔ Never write to it, and do not add a reader. If you need a fact
          // about a person at a conference, it is on the seat, on
          // conference_people, or on the org — not here.
          selector:
            "CallExpression[callee.property.name='from'][arguments.0.value='conference_registrations']",
          message:
            "conference_registrations is the retired v2 monolith (0 rows, no writer). Who is coming = a named seat: loadSeatHoldings() / loadMeetingCandidates(). Per-person conference facts live on conference_people; match signal on organizations.procurement_info.",
        },
      ],
    },
  },
  {
    files: ["lib/supabase/middleware.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // lib/conference/seats.ts is the single intended exemption — it IS the
    // canonical reader. Everything below it is grandfathered: these predate the
    // rule and still carry their own seat query. Delete a line as you migrate
    // it to loadSeatHoldings(); never add one.
    files: [
      "lib/conference/seats.ts",
      "lib/actions/conference-entity-commerce.ts",
      "lib/actions/conference-entities.ts",
      "lib/actions/conference-access.ts",
      "lib/actions/conference-legal.ts",
      "lib/actions/conference-commerce.ts",
      "lib/conference/registration-mint.ts",
      "lib/conference/legal-acceptance.ts",
      "lib/conference/checklist-checks.ts",
      "lib/comms/audience.ts",
      "lib/stripe/webhook-processing.ts",
      // ── conference_registrations readers, not yet ported ──────────────────
      // The MEETING system (scheduler, swaps, schedule service/ops/matrix,
      // person-agenda) came off it and is deliberately NOT listed — it had to
      // migrate or fail lint. These are separate subsystems; porting each is
      // its own job. Same ratchet: delete a line as you migrate it.
      "lib/actions/conference-legal.ts",
      "lib/actions/conference-people.ts",
      "lib/actions/conference-registration.ts",
      "lib/actions/conference-staff.ts",
      "lib/actions/conference-travel-import.ts",
      "lib/ops/alerts.ts",
      "app/admin/ops/page.tsx",
      // ⚠️ Globbed with ** — a literal "[year]" is read as a glob character
      // class, so the bracketed route path silently matches nothing.
      "app/conference/**/register/page.tsx",
      "app/conference/**/schedule/page.tsx",
    ],
    rules: {
      // ⚠️ NOT "off" — that would also drop the getClaims rule in these files.
      // Restate only the rule these are grandfathered against.
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='getClaims']",
          message:
            "Use centralized auth guards from lib/auth/guards.ts instead of direct getClaims() in feature code.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
