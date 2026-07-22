/**
 * Cross-component signal for "the conference cart changed" — lets the
 * header's cart button update its count (and animate) immediately after an
 * add-to-cart action elsewhere on the page, without a full navigation or a
 * separate toast/modal. Client-only; no server imports.
 *
 * Carries the organization id the cart change was for. The header derives
 * which org's cart to poll from `?org=` in the URL, falling back to the
 * viewer's primary org — but pages like /org/[slug] never set `?org=`, so
 * without this, adding an item for an org that isn't the viewer's primary
 * org left the header silently polling (and linking to) the wrong org's
 * cart. The header remembers the most recently dispatched org id and
 * prefers it over the primary-org fallback.
 */
export const CONFERENCE_CART_UPDATED_EVENT = "conference-cart:updated";

export interface ConferenceCartUpdatedDetail {
  organizationId?: string;
}

export function dispatchConferenceCartUpdated(organizationId?: string): void {
  window.dispatchEvent(
    new CustomEvent<ConferenceCartUpdatedDetail>(CONFERENCE_CART_UPDATED_EVENT, {
      detail: { organizationId },
    })
  );
}
