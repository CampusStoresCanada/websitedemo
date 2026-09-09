#!/bin/bash
#
# The nightly late-add run, on the Mac Studio.
#
# ⛔ WHY THIS EXISTS AT ALL. Registration closes 2027-01-31; the meeting schedule
# freezes 2027-01-18. So there are thirteen days every year when somebody can
# legitimately register and land with no meetings, because the schedule they
# would have been in was already sent. This job seats them without moving anyone.
#
# ⛔ WHY IT RETRIES NIGHTLY RATHER THAN ON REGISTRATION. Steve: "they still don't
# meet solo. They become a three or wait for another solo add." A lone arrival
# with no under-full room to join cannot be seated at all — until a SECOND
# latecomer arrives and the two can open a room together. The thing that unblocks
# the first person is the second one, so the answer changes on its own and the
# only way to notice is to ask again.
#
# ⛔ IT NEVER SENDS. Persisting a draft is not telling anybody. Steve: "we hold it
# until we want the final answer... we don't ship their schedule ASAP." Sending is
# `--send`, typed by a person who has decided it is time. A job that emailed on
# every run would tell one latecomer their schedule four times in January.
#
# ⚠️ This cannot live on Vercel, for the same reason the match run cannot: the
# solver is deliberately local. Cloud compute is a no when there is local compute
# to spare. The WATCHING can be remote; the work is here.
#
# Install:   ./scripts/local/late-add-nightly.sh --install
# Run now:   ./scripts/local/late-add-nightly.sh
# Uninstall: ./scripts/local/late-add-nightly.sh --uninstall

set -uo pipefail

# ⛔ launchd hands a job an EMPTY PATH — not your shell's. Every interactive test
# passes and the 3am run dies with "npx: command not found" (exit 127). Homebrew
# on Apple Silicon lives in /opt/homebrew/bin; Intel and nvm installs are listed
# so this does not silently depend on one machine.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/current/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="ca.campusstores.late-add-nightly"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/csc-scheduler"
LOG="$LOG_DIR/late-add-nightly.log"

# ⚠️ The conference to extend. A late add is scoped to one conference by
# definition — it extends THAT conference's promoted run — so this is explicit
# rather than "whatever looks current", which would silently follow the wrong
# show the year two overlap.
CONFERENCE_ID="${CSC_CONFERENCE_ID:-7e650b08-51d1-4573-a332-7d6b6fbc50bd}"

# ── install / uninstall ──────────────────────────────────────────────────────
if [[ "${1:-}" == "--install" ]]; then
  mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
  cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${REPO}/scripts/local/late-add-nightly.sh</string>
  </array>
  <!-- 04:30 local — after the match nightly at 03:15, so a late add always
       extends against the freshest scores rather than yesterday's. -->
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>30</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
PLIST_EOF
  launchctl unload "$PLIST" 2>/dev/null
  launchctl load "$PLIST" && echo "installed ${LABEL} — runs 04:30 daily, logs to ${LOG}"
  exit $?
fi

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl unload "$PLIST" 2>/dev/null
  rm -f "$PLIST" && echo "removed ${LABEL}"
  exit 0
fi

# ── the run ──────────────────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"
cd "$REPO" || exit 1
echo "── $(date '+%Y-%m-%d %H:%M:%S') ────────────────────────────────────────"

# ⚠️ Preflight before the work, so a missing tool reads as a missing tool rather
# than as "the scheduler found nobody to seat".
for tool in node npx; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "FATAL: $tool not on PATH — launchd gives an empty PATH, see the export above"
    exit 127
  fi
done

if [[ ! -f "$REPO/.env.local" ]]; then
  echo "FATAL: .env.local missing — the run would fail with 'supabaseUrl is required',"
  echo "       which reads like a code fault rather than a missing file."
  exit 1
fi

# ⛔ --tsconfig tsconfig.scripts.json is REQUIRED. lib/match/read.ts imports
# "server-only", which is not a dependency — Next resolves it internally, so the
# app builds fine and a plain `tsx` dies with MODULE_NOT_FOUND.
#
# ⛔ NOT --send. Persisting is not telling. See the header.
#
# --only-if-changed keeps thirteen quiet nights out of the run list, so the one
# night somebody arrived is visible instead of buried.
npx tsx --tsconfig tsconfig.scripts.json --env-file=.env.local \
  scripts/schedule-search.ts "$CONFERENCE_ID" \
  --extend-active --persist --only-if-changed
STATUS=$?

# ⚠️ exit 2 is a REFUSAL, not a crash: no promoted run yet, before the freeze
# date, or nothing to extend. Those are all correct outcomes for a job that runs
# every night through a window that has not opened yet, and they must not read as
# failures or the log becomes noise nobody checks.
if [[ $STATUS -eq 2 ]]; then
  echo "nothing to do (refused precondition) — see the message above"
  exit 0
fi

if [[ $STATUS -ne 0 ]]; then
  echo "late add FAILED with status $STATUS"
  exit $STATUS
fi

echo "late add complete"
