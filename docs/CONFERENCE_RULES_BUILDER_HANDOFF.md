# Conference Rules Builder Handoff (Technical)

## Scope
Replace the current conference rules authoring experience with a canvas-first rules builder that supports explicit logic construction by non-technical admins.

## Primary implementation files
- `/Users/Work/Documents/csc-website/websitedemo/components/admin/conference/ConferenceRulesBuilder.tsx`
- `/Users/Work/Documents/csc-website/websitedemo/components/admin/conference/ConferenceDashboard.tsx`
- `/Users/Work/Documents/csc-website/websitedemo/app/admin/conference/[id]/page.tsx`
- `/Users/Work/Documents/csc-website/websitedemo/lib/conference/rules-engine.ts`
- `/Users/Work/Documents/csc-website/websitedemo/lib/actions/conference-rules-engine.ts`

## Current implementation status
- Current canvas renders step cards: `Trigger`, `Conditions`, `Action`.
- Add-step flow uses template modal with insertion guardrails.
- Conditions are currently represented as nested groups and flattened chain helpers in UI.
- Inspector handles most configuration details.
- File lint status: passing for `ConferenceRulesBuilder.tsx`.

## Product requirements
1. Canvas-first editing
- Core rule construction must happen on the canvas.
- Inspector must only edit selected node details.

2. Explicit logic model
- Admin must explicitly construct logic sequence.
- No hidden/inferred operators or automatic condition grouping.
- Display model should read as `WHEN` trigger, `IF` condition chain, `THEN` action outcomes.

3. User-driven add behavior
- Additions occur only from `+` controls.
- No auto-added next steps.
- User chooses the inserted element type at each add point.

4. Step deletion safety
- Delete applies only to selected step.
- Two-tap confirm on same control with short timeout.

5. Non-technical language
- Use plain language labels.
- Avoid typed slugs/IDs where possible; use selectors/pickers.

6. Product-level rules
- Rule applicability must support registration product-level targeting.

## Functional rule domains
1. Access and visibility
- Eligibility gating.
- Hide ineligible products from purchaser view where applicable.

2. Pricing
- Price override and discount outcomes.

3. Travel operations
- Travel support modes (managed, reimbursement/partial, unmanaged, none).
- Travel requirement outcomes (air travel allowed, intake required, accommodation intake required).
- Distance/rule-based policy handling (e.g. radius-based restrictions).

4. Export readiness
- Rule outcomes should support downstream travel/lodging/airline partner workflows.

## Known fixes already applied
- Resolved prior build parse error in `ConferenceRulesBuilder.tsx` ternary block.
- Resolved prior runtime `Cannot access 'persist' before initialization` in builder component.

## Rebuild plan
### Phase 1: Node model and canvas contract
1. Introduce explicit canvas node types:
- trigger
- condition
- logic_operator
- action

2. Make `+` insertion explicit:
- At each insertion point, open an add menu with allowed node types for that position.
- Do not insert any step automatically.

3. Keep inspector scoped:
- Only selected node content and editable fields.

### Phase 2: Authoring UX
1. Render full rule sentence on canvas using node sequence.
2. Show inline validity states per node (missing required fields, invalid operator placement, etc.).
3. Keep action targeting as selector-based inputs.

### Phase 3: Domain templates + outcomes
1. Add optional starter templates for common policy patterns.
2. Support visibility, pricing, and travel outcomes as first-class action types.
3. Add export-oriented output mapping hooks for partner handoff workflows.

## Acceptance criteria
1. Admin can build a complete rule from canvas controls without inspector-first workflow.
2. No hidden logic inference exists in final builder behavior.
3. All added steps are user-initiated from `+`.
4. Rule chain is readable on canvas (`WHEN/IF/.../THEN`).
5. Selected-step deletion cannot remove unintended steps.
6. Product-level targeting is configurable via pickers.

## Implementation constraints
1. Workspace is heavily dirty; do not revert unrelated files.
2. Keep changes localized to conference rules modules unless required by type boundaries.
3. Validate each phase with lint/build checks.

## Validation commands
```bash
cd /Users/Work/Documents/csc-website/websitedemo
npx eslint components/admin/conference/ConferenceRulesBuilder.tsx
npm run dev
```
