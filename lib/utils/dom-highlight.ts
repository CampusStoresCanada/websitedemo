/**
 * Shared DOM helpers for element highlighting across all toolkit panels
 * (InternalSharePanel, PublicHighlightHandler, future backports).
 */

/**
 * Find a DOM element by CSS selector.
 * Falls back to a Tailwind bracket-escape pass when the raw selector throws
 * (e.g. selectors containing [#hex], [value], etc.).
 */
export function findElementBySelector(selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    try {
      const escaped = selector.replace(
        /\[([^\]]*)\]/g,
        (_, inner) => `\\[${inner.replace(/[#.()\s]/g, (c: string) => `\\${c}`)}\\]`
      );
      return document.querySelector(escaped);
    } catch {
      return null;
    }
  }
}

/**
 * Find a DOM element by searching for a distinctive text excerpt.
 * Uses a TreeWalker over text nodes and returns the parent element of the
 * first match. Tries up to two candidate substrings from the excerpt.
 */
export function findElementByText(text: string): Element | null {
  const raw = text.replace(/\s+/g, " ").trim();
  const candidates = [
    raw.slice(0, 60),
    raw.match(/[A-Za-z][A-Za-z\s'"-]{4,}/)?.[0]?.trim() ?? "",
  ].filter(Boolean);

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node as Text);

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    for (const n of nodes) {
      if (n.textContent?.toLowerCase().includes(lower)) {
        return n.parentElement;
      }
    }
  }
  return null;
}

/**
 * Compute a union bounding rect from a first and optional last element.
 * Returns null if the first element cannot be found.
 */
export function computeUnionRect(
  firstEl: Element,
  lastEl: Element | null
): { top: number; left: number; width: number; height: number } {
  const r1 = firstEl.getBoundingClientRect();
  const r2 = (lastEl ?? firstEl).getBoundingClientRect();

  const top    = Math.min(r1.top,    r2.top)    - 4;
  const left   = Math.min(r1.left,   r2.left)   - 4;
  const right  = Math.max(r1.right,  r2.right)  + 4;
  const bottom = Math.max(r1.bottom, r2.bottom) + 4;

  return { top, left, width: right - left, height: bottom - top };
}
