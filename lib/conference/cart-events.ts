/**
 * Cross-component signal for "the conference cart changed" — lets the
 * header's cart button update its count (and animate) immediately after an
 * add-to-cart action elsewhere on the page, without a full navigation or a
 * separate toast/modal. Client-only; no server imports.
 */
export const CONFERENCE_CART_UPDATED_EVENT = "conference-cart:updated";

export function dispatchConferenceCartUpdated(): void {
  window.dispatchEvent(new Event(CONFERENCE_CART_UPDATED_EVENT));
}
