/**
 * Destination handling for the Circle session bridge
 * (app/api/circle/member-space).
 *
 * Circle's /session/cookies exchange sets a browser session and then always
 * lands on the community root. Measured 2026-10-05 against the live
 * community: access_token plus each of post_login_redirect, redirect_url,
 * return_to, redirect, next, redirect_to and continue all returned
 * `https://memberspace.campusstores.ca/`, byte-identical to the control with
 * no parameter at all. Presenting the token on a content URL instead bounces
 * to /users/sign_in. There is no server-side way to land a member on a
 * specific post, which is why the bridge renders an interstitial that lets
 * the cookie exchange finish in an iframe before navigating.
 *
 * See scripts/probe-circle-session-redirect.sh to re-measure.
 */

/**
 * Where inside Circle to land after the session cookie is set, from the
 * caller's ?to= (e.g. "/c/announcements-f3687d/some-post" in a campaign
 * CTA). Anything that isn't a plain path on Circle's own host is dropped
 * rather than rejected — a bad destination should still get the member into
 * Circle, just at the root.
 *
 * This feeds a navigation issued after an authenticated token mint, so the
 * check is allow-list shaped: exactly one leading slash and nothing that can
 * be re-parsed into a host.
 */
export function sanitizeDestination(raw: string | null): string | null {
  if (!raw) return null;
  // "//evil.com" is protocol-relative and "https://evil.com" is absolute;
  // both must fail. Requiring a single leading slash rejects each.
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  // Browsers normalize backslashes to forward slashes, so "/\evil.com"
  // becomes "//evil.com" once navigated.
  if (raw.includes("\\")) return null;
  // Control characters (raw or percent-encoded CR/LF) would split a header.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  if (/%0[ad]/i.test(raw)) return null;
  return raw;
}

/**
 * The community's own origin, taken from the configured cookie-exchange
 * template rather than a second env var that could drift out of step with
 * it. Returns null when the template is missing or unparseable.
 */
export function communityOriginFromTemplate(template: string | undefined): string | null {
  if (!template) return null;
  try {
    return new URL(template.replace("{token}", "x")).origin;
  } catch {
    return null;
  }
}

/** Minimal HTML attribute escaping for values interpolated into the interstitial. */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * JSON for embedding inside an inline <script>. JSON.stringify does not
 * escape "<", so a value containing "</script>" would close the block and
 * everything after it would parse as markup. sanitizeDestination permits
 * such a path (one leading slash, no backslash, no control characters), so
 * this is reachable, not theoretical.
 */
export function jsonForScriptTag(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

/**
 * Circle's cookie exchange always lands on the community root and honours no
 * destination parameter (measured — see lib/circle/destination.ts). So when a
 * caller asks for a specific post, let the exchange run to completion inside
 * an iframe, then navigate the top window to where they actually wanted to
 * go. The iframe is a document navigation rather than a fetch, which matters:
 * Circle sends no access-control-allow-origin for our origin, so a fetch to
 * the same endpoint would be blocked. The session cookie is SameSite=None,
 * so it sets inside the frame.
 *
 * The token sits in the frame's src rather than the top-level address bar,
 * which keeps it out of browser history and the Referer of the destination
 * page. The response is no-store for the same reason.
 */
export function renderBridgeInterstitial(exchangeUrl: string, finalUrl: string): string {
  const exchange = escapeHtmlAttribute(exchangeUrl);
  const destination = escapeHtmlAttribute(finalUrl);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Opening Circle</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2328;background:#fff}
  .b{text-align:center;padding:2rem}
  .s{width:28px;height:28px;margin:0 auto 1rem;border:3px solid #e5e7eb;border-top-color:#B92026;
     border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  @media (prefers-reduced-motion:reduce){.s{animation:none}}
  a{color:#B92026}
  iframe{position:absolute;width:0;height:0;border:0;visibility:hidden}
</style>
</head>
<body>
<div class="b">
  <div class="s"></div>
  <p>Opening Circle…</p>
  <noscript><p><a href="${destination}">Continue to Circle</a></p></noscript>
</div>
<iframe src="${exchange}" title="" aria-hidden="true" tabindex="-1"></iframe>
<script>
(function(){
  var dest = ${jsonForScriptTag(finalUrl)};
  var went = false;
  function go(){ if(went) return; went = true; window.location.replace(dest); }
  var f = document.querySelector('iframe');
  if (f) { f.addEventListener('load', function(){ setTimeout(go, 150); }); }
  // The frame can fail silently (blocked third-party context, network error),
  // so never leave the member staring at a spinner.
  setTimeout(go, 4000);
})();
</script>
</body>
</html>`;
}
