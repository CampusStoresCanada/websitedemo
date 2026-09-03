#!/bin/bash
#
# The nightly match run, on the Mac Studio.
#
# ⛔ This cannot live on Vercel. The engine embeds against a local model on this
# machine, which nothing in the datacentre can reach. So the compute is here and
# the WATCHING is there: `evaluateMatchRunStale` in lib/ops/alerts.ts notices when
# this machine has not reported in and asks a human to run it again.
#
# ⚠️ "Overnight in a datacentre isn't overnight on a work computer." This machine
# reboots for updates, sleeps, and gets shut. A missed night is normal. The job is
# built to be safely re-runnable at any hour rather than to be reliable at 3am.
#
# Install:   ./scripts/local/match-nightly.sh --install
# Run now:   ./scripts/local/match-nightly.sh
# Uninstall: ./scripts/local/match-nightly.sh --uninstall

set -uo pipefail

# ⛔ launchd hands a job an EMPTY PATH — not your shell's. Every interactive test
# passes and the 3am run dies with "npx: command not found" (exit 127), which is
# indistinguishable at a glance from the Full Disk Access failure (126) that
# preceded it. Homebrew on Apple Silicon lives in /opt/homebrew/bin; Intel and
# nvm installs are listed too so this does not silently depend on one machine.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/current/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="ca.campusstores.match-nightly"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/csc-match"
LOG="$LOG_DIR/match-nightly.log"

# The model the stored vectors were built with, and its width. ⛔ Changing either
# means every existing vector is incomparable — re-embed the corpus deliberately
# rather than letting a run quietly mix two spaces.
MODEL="nomic-embed-text"
EXPECTED_DIMS=768

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
    <string>${REPO}/scripts/local/match-nightly.sh</string>
  </array>
  <!-- 03:15 local. Late enough that the machine is idle, early enough that a
       failure is visible before anyone needs the numbers. -->
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>15</integer></dict>
  <!-- ⚠️ The whole point: if the Mac was asleep or off at 03:15, run at the next
       opportunity instead of silently skipping the night. -->
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
PLIST_EOF
  launchctl unload "$PLIST" 2>/dev/null
  launchctl load "$PLIST" && echo "installed ${LABEL} — runs 03:15 daily, logs to ${LOG}"
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

# ⛔ Pull named variables ONE AT A TIME. Do not source this file, and do not
# source a grep of it either: .env.local holds a multi-line value (a private
# key), so the first line of it matches `KEY=` and opens a quote that never
# closes — which kills the whole sourced block and leaves EVERY variable unset.
# The first version of this script did exactly that and failed with
# "supabaseUrl is required", which reads like a code fault rather than an
# env-parsing one.
if [[ ! -f .env.local ]]; then
  echo "no .env.local — cannot reach Supabase"; exit 1
fi

read_env() {
  local line
  line="$(grep -m1 "^$1=" .env.local || true)"
  [[ -z "$line" ]] && return 1
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"      # strip surrounding double quotes
  line="${line%\'}"; line="${line#\'}"      # or single
  printf '%s' "$line"
}

for var in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY CIRCLE_API_KEY \
           CIRCLE_COMMUNITY_ID CIRCLE_GHOST_KEY OLLAMA_URL; do
  value="$(read_env "$var")" && export "$var=$value"
done

# ⚠️ Fail here, loudly, rather than three minutes into an embedding run with a
# stack trace that blames the database client.
for required in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
  if [[ -z "${!required:-}" ]]; then
    echo "$required missing from .env.local — cannot run"; exit 1
  fi
done

# ⛔ Check the tools BEFORE doing any work. Without this the run gets as far as
# starting ollama, embedding a dimension probe and reporting "ready", then dies on
# the first npx — so the log's last cheerful line is a success message and the
# failure reads like a late, mysterious crash rather than a missing binary.
MISSING=""
for tool in node npx curl ollama; do
  command -v "$tool" >/dev/null 2>&1 || MISSING="$MISSING $tool"
done
if [[ -n "$MISSING" ]]; then
  echo "missing from PATH:$MISSING"
  echo "PATH was: $PATH"
  echo "nothing run — fix the PATH above rather than the caller"
  exit 1
fi

# ⚠️ Start ollama if it is not already serving. After a reboot nothing has
# launched it, and the run would otherwise fail on every request with a
# connection refused that reads like a code fault.
if ! curl -sf --max-time 5 "${OLLAMA_URL:-http://localhost:11434}/api/tags" >/dev/null; then
  echo "ollama not responding — starting it"
  nohup ollama serve >/dev/null 2>&1 &
  for _ in $(seq 1 30); do
    curl -sf --max-time 2 "${OLLAMA_URL:-http://localhost:11434}/api/tags" >/dev/null && break
    sleep 1
  done
  if ! curl -sf --max-time 5 "${OLLAMA_URL:-http://localhost:11434}/api/tags" >/dev/null; then
    echo "ollama would not start — leaving the run for a human"; exit 1
  fi
fi

# ⛔ A running server is NOT a usable model. `ollama serve` is "Excel is open" —
# the model is named per request, and if `nomic-embed-text` is not downloaded on
# this machine every embed call fails with a model-not-found that looks nothing
# like the actual problem. An OS reinstall, a cleared disk or a pruned model
# store all produce a perfectly healthy server with nothing in it.
if ! curl -sf --max-time 10 "${OLLAMA_URL:-http://localhost:11434}/api/tags" | grep -q "$MODEL"; then
  echo "$MODEL not present — pulling it (first run may take a few minutes)"
  if ! ollama pull "$MODEL"; then
    echo "could not pull $MODEL — leaving the run for a human"; exit 1
  fi
fi

# ⚠️ Prove it can actually embed before spending minutes gathering a corpus. A
# model can be listed and still fail to load — wrong architecture after an
# upgrade, a truncated download. One request costs nothing and turns a confusing
# late failure into an obvious early one.
DIMS="$(curl -sf --max-time 60 "${OLLAMA_URL:-http://localhost:11434}/api/embed" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"$MODEL\",\"input\":\"probe\"}" \
  | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["embeddings"][0]))' 2>/dev/null)"

if [[ -z "$DIMS" ]]; then
  echo "$MODEL is present but would not embed — leaving the run for a human"; exit 1
fi

# ⛔ Dimensions must match what the stored vectors were built with. Two models
# are silently incomparable: cosine between them is noise that still returns a
# plausible number. `poolSignals` drops mismatched widths rather than mixing
# them, so the failure would be a quietly emptier run, not an error.
if [[ "$DIMS" != "$EXPECTED_DIMS" ]]; then
  echo "$MODEL returned ${DIMS} dimensions, expected ${EXPECTED_DIMS} — the model changed under us."
  echo "Refusing to run: vectors from a different model cannot be compared with the ones already stored."
  exit 1
fi
echo "$MODEL ready (${DIMS} dimensions)"

# Refresh the community first: comments are incremental and cheap (a handful of
# requests once the cache is warm), and a stale corpus is a silently worse run.
# ⛔ Refresh the POSTS corpus first. Without this the run scores whatever asks
# existed the day the cache was last built by hand — the cache sat two days stale
# while comments refreshed nightly, so the newest question was never looked at and
# the screen said "not scored yet" about it forever. A tool for fresh questions
# that cannot see fresh questions is worse than no tool.
npx tsx scripts/circle-embed.mts --fetch-only || echo "corpus refresh failed — continuing on the cached corpus"

npx tsx scripts/circle-comments.mts || echo "comment refresh failed — continuing on the cached corpus"

# ⛔ --write records the run; it NEVER promotes. What the site serves stays a
# human decision.
npx tsx scripts/match-space.mts --write
STATUS=$?

# Keep the log readable: the last ~2000 lines is several weeks of runs.
if [[ -f "$LOG" ]]; then
  tail -n 2000 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
fi

if [[ $STATUS -ne 0 ]]; then
  echo "run FAILED (exit $STATUS) — the unfinished row is what the Vercel watchdog will see"
fi
exit $STATUS
