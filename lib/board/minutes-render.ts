/**
 * Render `data.json` to the website's minutes HTML.
 *
 * Deliberately calls the SKILL's own `scripts/build_html.js` rather than
 * reimplementing it in TypeScript. That script is already pure and
 * dependency-free — the split was made so it could run somewhere other than a
 * Claude session — and a second implementation in `lib/` would be a copy of the
 * rendering rules that drifts from the one CoWork uses.
 *
 * ⚠️ IMPORTED STATICALLY, NOT VIA `createRequire`. A runtime
 * `require(path.join(process.cwd(), …))` looks like it avoids the bundler, but
 * Turbopack still analyses it and fails the production build with
 * `Can't resolve './ROOT/skills/…'` — while `tsc` and `vitest` both pass, since
 * neither resolves it the way the bundler does. A static relative import puts
 * the file in the module graph, which is simpler and needs no file tracing.
 */

import * as buildHtmlModule from "../../skills/csc-board-minutes/scripts/build_html.js";
import type { MinutesData } from "@/lib/board/minutes-schema";

interface BuildHtmlModule {
  buildHtml: (data: unknown) => string;
}

/**
 * The minutes HTML, recap tags included.
 *
 * The tags are part of this output on purpose: they ride into the editor, the
 * human saves, and the save route consumes and strips them exactly as it does
 * for a hand-pasted document. There is no separate path for generated minutes.
 */
export function renderMinutesHtml(data: MinutesData): string {
  const mod = buildHtmlModule as unknown as BuildHtmlModule & { default?: BuildHtmlModule };
  const build = mod.buildHtml ?? mod.default?.buildHtml;
  if (typeof build !== "function") {
    throw new Error("build_html.js did not export buildHtml");
  }
  return build(data);
}
