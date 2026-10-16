# Partner SSO — OpenID Connect Integration Spec

**Status:** v0.1 draft, 2026-09-30. Nothing here is implemented yet. Sections marked
**OPEN** are unresolved decisions, not omissions.

**Audience:** this file serves two readers. Sections 1–9 are the partner-facing
contract and are written to be sent to a partner's engineering team as-is.
Sections 10–12 are ours.

---

## 1. What this is

Campus Stores Canada (CSC) will act as an **OpenID Connect identity provider (IdP)**.
A partner's web portal acts as a **relying party (RP)**.

A member store employee, already signed in at CSC, clicks through to the partner's
portal and arrives authenticated, carrying a verified statement of which store they
work for and whether that store is a current CSC member.

### Division of labour

| Side | Builds |
|---|---|
| CSC | Discovery doc, JWKS, `/authorize`, `/token`, `/userinfo`, membership status endpoint, per-person consent screen, the outbound link |
| Partner | Standard OIDC client registration, JIT account provisioning keyed on `sub`, account linking for existing customers, entitlement refresh |

The partner side is small but it is **not zero**. See §10, which is the part these
integrations usually die on.

---

## 2. Issuer and endpoints

**DECIDED:** the issuer is a dedicated subdomain, not the marketing site.

```
issuer: https://id.campusstores.ca
```

Rationale: `iss` is an exact-match string that every RP hard-codes, and it can never
move without breaking every partner simultaneously. `campusstores.ca` currently 301s
to `www.campusstores.ca`, so neither apex nor www is safe as an issuer — an issuer
must not redirect. A dedicated host also decouples our identity contract from any
future website migration or redirect policy change.

| Purpose | URL |
|---|---|
| Discovery | `https://id.campusstores.ca/.well-known/openid-configuration` |
| JWKS | `https://id.campusstores.ca/.well-known/jwks.json` |
| Token | `https://id.campusstores.ca/token` |
| UserInfo | `https://id.campusstores.ca/userinfo` |
| Membership status | `https://id.campusstores.ca/status` (non-standard, see §8) |
| **Authorization** | `https://www.campusstores.ca/oidc/authorize` |

### Why the authorization endpoint is on a different host

`iss` and the discovery document live on `id.campusstores.ca`. The authorization
endpoint deliberately does not.

`/authorize` is the only endpoint that must read the member's existing CSC login
session. That session cookie is host-scoped to `www.campusstores.ca` and is not sent
to sibling subdomains. The alternative would be widening the cookie to
`.campusstores.ca`, which would hand the session to every present and future
subdomain including `memberspace.campusstores.ca`, a proxied third-party host. Not a
trade worth making to save one hostname.

This is spec-conformant: OIDC Discovery requires that the document live at
`{issuer}/.well-known/openid-configuration` and that its `issuer` value match. The
endpoint URLs *inside* the document may be any HTTPS origin. Clients must read
`authorization_endpoint` from discovery rather than assuming it shares the issuer host.

Signing: **ES256**, keys published at the JWKS URL and rotated on a schedule.
There is no shared secret to verify tokens. Clients must fetch and cache JWKS by
`kid` and must tolerate rotation.

---

## 3. Flow

Authorization Code with PKCE. No implicit flow, no hybrid, no password grant.

```
1. Member clicks "Continue to <Partner>" on their CSC dashboard
     (or hits the partner's own "Sign in with Campus Stores Canada" button)
2. Browser -> GET https://id.campusstores.ca/authorize
     ?client_id=...&redirect_uri=...&response_type=code
     &scope=openid csc.org csc.membership
     &state=...&nonce=...&code_challenge=...&code_challenge_method=S256
3. CSC authenticates the person (or reuses their session), then shows a
     one-time consent screen naming the partner and the scopes (§7)
4. Browser -> partner redirect_uri?code=...&state=...
5. Partner server -> POST /token (back channel, with code_verifier)
     <- id_token (JWT), access_token
6. Partner verifies id_token against JWKS, then provisions or links the
     local account on sub (§4)
```

Requirements on the partner:

- PKCE `S256` is mandatory, including for confidential clients.
- `redirect_uri` is exact-match against registration. No wildcards, no path suffixes.
- `state` and `nonce` are both required and must be validated.
- The ID token must be verified for signature, `iss`, `aud`, `exp`, and `nonce`.

---

## 4. Subject semantics — read this section twice

**`sub` identifies a person at a store, not a person.**

CSC's identity primitive is the pair (person, organization). Our contact records are
keyed that way, and one human can legitimately hold two of them. A buyer who works
two days a week at two different member stores is **two separate customers** to a
partner: different purchasing authority, different shipping address, different
entitlement, possibly different pricing.

Consequences for the partner:

- `sub` is opaque, stable, and pairwise. It is unique per (person, store, client).
  The same human arriving from a second store presents a **different** `sub` and must
  become a **different** local account.
- `sub` is the only correct primary key for the link. It never changes and is never
  reused.
- **Do not key on email.** Email is not an identity key at CSC. It is not unique
  across our records, shared store inboxes are common and legitimate, and it changes
  when people change jobs. `email` is supplied as a convenience claim and is marked
  non-authoritative below. Matching on it will merge two stores' accounts.
- Do not attempt to derive a person's identity across stores. If you need that,
  raise it as a requirement rather than inferring it.

---

## 5. Scopes

| Scope | Grants |
|---|---|
| `openid` | `sub` only. Required. |
| `csc.identity` | Name, email (non-authoritative) |
| `csc.org` | Which store, and its public attributes |
| `csc.membership` | Whether that store is a current CSC member |
| `csc.purchasing` | This person's purchasing authority at that store |

Scopes are least-privilege: request only what the portal actually branches on. A
portal that gates member pricing needs `openid csc.org csc.membership` and nothing
else.

---

## 6. Claims

Custom claims are namespaced URIs to avoid collision with standard claims and with
other IdPs the partner may already consume. All values are flat scalars — no nested
objects — because RP libraries handle nesting inconsistently.

### `openid`

| Claim | Type | Notes |
|---|---|---|
| `sub` | string | Opaque, pairwise, permanent. See §4. |
| `iss` | string | `https://id.campusstores.ca` |
| `aud` | string | Your `client_id` |
| `exp` / `iat` | number | ID token lifetime is 10 minutes. It is a login assertion, not a session. |

### `csc.identity`

| Claim | Type | Notes |
|---|---|---|
| `name` | string | Display name |
| `given_name` / `family_name` | string | May be absent |
| `email` | string | **Non-authoritative.** Present for display and contact only. Never a join key. |
| `email_verified` | boolean | Reflects CSC account verification, not deliverability |

### `csc.org`

| Claim | Type | Notes |
|---|---|---|
| `.../org_id` | string | Opaque, stable, pairwise per client. The store's identifier. |
| `.../org_name` | string | Display name. Changes over time, never a key. |
| `.../org_code` | string | CSC short code for the store |
| `.../org_type` | enum | `member_store` \| `vendor_partner` |
| `.../org_province` | string | Two-letter code |

`org_type` is a contract vocabulary, deliberately not our internal value. Do not
string-match on display text.

### `csc.membership`

| Claim | Type | Notes |
|---|---|---|
| `.../member_entitled` | boolean | **The only claim to branch on.** True means this store is entitled to member treatment right now. |
| `.../member_state` | enum | `current` \| `lapsed`. Coarse, for display. |
| `.../entitlement_asserted_at` | string | RFC 3339. When CSC evaluated this. |

**CSC will not export its internal membership lifecycle.** Our status machine has
seven states and one of them, `grace`, means "member whose renewal is in flight" —
a fully entitled store, mid-cycle. Renewals run August to October, so at any point
in the autumn a large share of legitimate member stores sit in `grace`. Exporting
raw status guarantees a partner reads that as lapsed and blocks real members every
September. We have already had exactly that bug internally, in the partner exports,
where the effect was invisible because nothing errored.

So: `member_entitled` is a boolean we compute, and it is the only thing to gate on.

### `csc.purchasing`

| Claim | Type | Notes |
|---|---|---|
| `.../purchasing_role` | enum | `buyer` \| `viewer` |

`buyer` means this person is an administrator of that store's CSC account and is the
right person to hold ordering rights. `viewer` means staff without that authority.

This is advisory. It reflects CSC account administration, which is not the same
question as who a store has authorised to spend its money. Treat it as a sensible
default for a new account, not as an authorisation decision you can outsource to us.

### Example ID token payload

```json
{
  "iss": "https://id.campusstores.ca",
  "sub": "7Qk2mXv9pR4tLzN8",
  "aud": "acme-order-portal",
  "exp": 1790804400,
  "iat": 1790803800,
  "nonce": "n-0S6_WzA2Mj",
  "name": "Jordan Blake",
  "email": "jblake@example.edu",
  "email_verified": true,
  "https://id.campusstores.ca/org_id": "vB3nQ7rTxK1sD9wF",
  "https://id.campusstores.ca/org_name": "Example University Bookstore",
  "https://id.campusstores.ca/org_code": "EXUB",
  "https://id.campusstores.ca/org_type": "member_store",
  "https://id.campusstores.ca/org_province": "AB",
  "https://id.campusstores.ca/member_entitled": true,
  "https://id.campusstores.ca/member_state": "current",
  "https://id.campusstores.ca/entitlement_asserted_at": "2026-09-30T14:22:05Z",
  "https://id.campusstores.ca/purchasing_role": "buyer"
}
```

---

## 7. Consent

Consent at CSC is **per person**, not per organisation. A store administrator can
confirm the store's own details; they cannot consent on behalf of their staff.

Therefore the first time a given person hands off to a given partner, CSC shows a
consent screen naming the partner and the specific scopes. It is recorded per
(person, store, client) and is revocable by that person at any time. Revoking it
stops future handoffs; it does not reach into the partner's system.

Tokens carry the scopes that were **consented to**, which may be narrower than the
scopes the client registered for. Clients must handle a claim being absent.

---

## 8. Staleness and revocation

This is the highest-risk part of the design and it needs work on both sides.

The failure mode: CSC asserts `member_entitled: true`, the partner creates a local
session, the store then cancels its CSC membership, and the portal goes on extending
member pricing indefinitely because nothing told it otherwise.

Mitigations, all three required, not one:

1. **Short assertion lifetime.** The ID token expires in 10 minutes. It authorises a
   login, not a session. Do not treat claims cached from it as durable facts.
2. **Status endpoint.** `GET /status` with the access token returns current
   `member_entitled`, `member_state`, and `purchasing_role` for that `sub`. Partners
   holding long-lived local sessions must re-check on a cadence — daily at minimum,
   and before any member-priced transaction.
3. **Back-channel push.** CSC will POST to a registered endpoint when a store's
   entitlement changes, so the partner does not have to discover it by polling.

**OPEN:** push payload shape, retry policy, and whether v1 ships push or
status-endpoint-only. Push is the right answer and the harder one.

---

## 9. Not in v1

Stated explicitly so nobody plans around them:

- **SAML.** OIDC only. Raise it early if your portal cannot speak OIDC.
- **Refresh tokens.** Re-authenticate through `/authorize` instead.
- **SCIM or bulk provisioning.** No roster sync. Accounts appear when people arrive.
- **Single logout.** Signing out of CSC does not end the partner session.
- **CSC as sole login.** See §10.

---

## 10. What the partner must build, and why this fails

Two pieces of partner-side work are unavoidable. Both are the reason SSO
integrations stall, so they belong in the first conversation rather than week six.

**JIT provisioning.** On first arrival with an unrecognised `sub`, the portal must
create a local account keyed on that `sub`. CSC cannot do this step.

**Account linking.** No partner will accept CSC as the only login for a store they
have billed for a decade. The realistic first-visit experience for an existing
customer is a linking prompt: "we found an account for Example University Bookstore,
is this you?" That is partner-side work, but the flow has to be designed jointly or
it produces duplicate accounts on day one.

Both mean the honest description of the end state is "one click **after** the first
visit." The first visit involves consent on our side and linking on theirs.

---

## 11. CSC build order

1. **Claim resolver.** `resolvePartnerIdentityClaims({ profileId, organizationId, audience })`
   in `lib/auth/federation/claims.ts`. Built on `getServerAuthState()` plus the
   `user_organizations` row for that org. One function, one file. Every claim any
   partner ever sees comes from here.
2. **Pseudonymous subject table.** `federated_subjects(client_id, organization_id, profile_id, sub)`,
   unique on the triple. **This must land before the first handoff ever goes out** —
   an issued `sub` can never be changed.
3. **Client registry and consent.** `oidc_clients`, `federation_consents`.
4. **OIDC endpoints.** Discovery, JWKS, `/authorize`, `/token`, `/userinfo`. Add
   `jose`; nothing suitable is installed today.
5. **Wire to the existing button.** `lib/partner-links.ts` already defines
   `type: "order_portal"` with `public | member | org_admin` visibility. Today it is
   an inert URL. Let an `order_portal` link optionally carry a `client_id` and that
   existing, already-gated button becomes the handoff.
6. **Status endpoint, push, and the admin surface.** Register the admin page in
   `lib/admin/nav.ts`.

### Hosting facts (measured 2026-09-30)

- DNS for `campusstores.ca` is authoritative on **Cloudflare**
  (`blakely.ns.cloudflare.com`, `johnny.ns.cloudflare.com`). Squarespace is not in
  the DNS path; it only still serves the apex, whose sole job is a 301 to www.
- `www.campusstores.ca` is a verified domain on the Vercel project **`websitedemo`**
  (`prj_hvHzcTEjA23ZOM2GzEah1hnekrec`), CNAME'd to
  `eb8d3b166ef240b4.vercel-dns-016.com`. The apex is *not* a Vercel domain.
- `id.campusstores.ca` must be **DNS-only (grey cloud)** in Cloudflare, not proxied.
  Vercel issues and renews the certificate via ACME, and a Cloudflare-cached JWKS
  served stale through a key rotation would break every partner's signature
  verification at once with no error visible to us.
- `id.campusstores.ca` goes on the same `websitedemo` project. `proxy.ts` already
  branches on `host` for `campusstores.events`; the `id.` host must be gated the
  same way so the rest of the app does not answer on it. **That gate ships with the
  DNS change, not after it** — until it exists, every app route has a second public
  front door.

### Implementation rules

- **`purchasing_role` derives from `user_organizations.role` for that org, never from
  `permissionState`.** Vendor Partner org admins resolve to `partner`, which sits
  *below* `org_admin` on the global ladder — see the comment in
  `lib/auth/permissions.ts`. Reading the ladder here inverts the answer.
- **`member_entitled` derives from `ORG_ACCESS_ACTIVE_STATUSES`** in
  `lib/membership/status.ts`, not from `PUBLIC_LISTABLE_ORG_STATUSES`. The two
  currently hold the same three values and answer different questions; that file
  documents the incident from conflating them. Import the entitlement constant by name.
- **Claims fail closed.** A scope not consented to yields an absent claim, never a
  default. Absent must never read as `true`.
- **Log the handoff as an act**, not as an interpretation: who, when, which client,
  which scopes. Do not write a partner's read of a person back onto our records.
- No signed assertion may be minted from a code path that bypasses the resolver in
  step 1. Consider an eslint gate once the resolver exists.

---

## 12. Open decisions

| # | Decision | Blocks | Owner |
|---|---|---|---|
| 1 | Register and point `id.campusstores.ca` | Everything in §2 | |
| 2 | Push vs status-endpoint-only in v1 (§8) | Partner conversation | |
| 3 | Key custody: `jose` with a rotated env key, or a managed KMS signer | §11 step 4 | |
| 4 | Whether `purchasing_role` ships in v1 at all, given it is advisory (§6) | Claim set freeze | |
| 5 | Which partner is the pilot, and does their portal speak OIDC today | Scope of §9 | |
| 6 | Whether the pilot needs SAML | Build vs buy | |

Decision 5 should be answered before any of §11 is built. A pilot partner whose
portal cannot consume OIDC changes the whole shape.
