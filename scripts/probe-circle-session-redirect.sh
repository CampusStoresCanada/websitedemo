#!/usr/bin/env bash
# Probe how Circle's session-cookie exchange handles a destination.
#
# Circle documents /session/cookies as landing on the community root, and
# documents no redirect parameter. This checks whether an undocumented one
# works anyway, and whether a token can be presented on a content URL
# directly (which would be one hop instead of two).
#
# Prints only HTTP status and Location. The access token is never echoed.
#
#   bash scripts/probe-circle-session-redirect.sh
set -uo pipefail
cd "$(dirname "$0")/.."

COMMUNITY="https://memberspace.campusstores.ca"
DEST="/c/announcements-f3687d/rush-is-over-was-yours-normal"
EMAIL="${1:-google@campusstores.ca}"

HT=$(grep '^CIRCLE_HEADLESS_AUTH_TOKEN=' .env.local | sed 's/^[^=]*=//' | tr -d '"'"'"'')
[ -n "$HT" ] || { echo "CIRCLE_HEADLESS_AUTH_TOKEN not in .env.local"; exit 1; }

TOKEN=$(curl -s -X POST "https://app.circle.so/api/v1/headless/auth_token" \
  -H "Authorization: Bearer $HT" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null)

[ -n "$TOKEN" ] || { echo "Could not mint a member token for $EMAIL"; exit 1; }
echo "Minted a token for $EMAIL (not shown). Probing..."
echo

probe() {
  local label="$1" url="$2"
  local out status loc
  out=$(curl -s -o /dev/null -D - "$url")
  status=$(printf '%s' "$out" | grep -i '^HTTP/' | tail -1 | tr -d '\r')
  loc=$(printf '%s' "$out" | grep -i '^location:' | tail -1 | tr -d '\r' \
        | sed -E 's/(access_token|post_login_redirect)=[^&]*/\1=<redacted>/g')
  printf '%-16s %s\n' "$label" "$status"
  if [ -n "$loc" ]; then
    printf '%-16s %s\n' "" "$loc"
    case "$loc" in
      */users/sign_in*) printf '%-16s     (bounced to Circle login, not authenticated)\n' "" ;;
      *rush-is-over-was-yours-normal*) printf '%-16s >>> LANDS ON THE POST\n' "" ;;
    esac
  fi
  echo
}

# Best case: token presented straight on the content URL, one hop.
probe "on-content-url" "$COMMUNITY$DEST?access_token=$TOKEN"

# Undocumented redirect parameter candidates on the cookie exchange.
for p in post_login_redirect redirect_url return_to redirect next redirect_to continue; do
  probe "$p" "$COMMUNITY/session/cookies?access_token=$TOKEN&$p=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$DEST")"
done

# Control: no destination at all. Expect the community root.
probe "control" "$COMMUNITY/session/cookies?access_token=$TOKEN"

echo "Any line marked LANDS ON THE POST is the parameter to use."
echo "If only 'control' behaves and everything else matches it, no redirect"
echo "parameter exists and the interstitial is the way."
