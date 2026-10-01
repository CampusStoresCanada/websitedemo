#!/usr/bin/env bash
# ⛔ THE BORROW CHECK. A gate at the moment of invention. No exemptions.
#
# Blocks the creation of ANY new file until the question has been asked out
# loud: is this genuinely novel, or are we borrowing from our own code?
# See the first section of CLAUDE.md.
#
# This exists because the rule was already written down twice — in CLAUDE.md
# and in memory — and was broken three times in one morning regardless. A
# document is context that can be reasoned past. A blocked tool call cannot be.
#
# ⛔ Deliberately NOT scoped. An earlier version exempted tests, migrations and
# scratch files on the reasoning that duplication does its damage in product
# code. That reasoning is the same move the rule exists to stop: a category
# carved out because it "feels different". Every new file asks the question.
#
# ONE keyhole: .claude/.borrow-check-ok. Without it the gate is a wall and
# nothing can ever be created. Recording a path there is meant to be a
# conscious, visible act that stays in the transcript. /dev/null is ignored
# because it is not a file.
#
# Exit 2 = block, and stderr is shown to Claude.

set -euo pipefail

payload="$(cat)"
field() { printf '%s' "$payload" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(''); raise SystemExit
print(d.get('tool_input',{}).get('$1','') or '')
" 2>/dev/null || true; }

tool="$(printf '%s' "$payload" | python3 -c '
import json,sys
try: print(json.load(sys.stdin).get("tool_name",""))
except Exception: print("")' 2>/dev/null || true)"

targets=""
case "$tool" in
  Write|NotebookEdit)
    targets="$(field file_path)"
    [ -z "$targets" ] && targets="$(field notebook_path)"
    ;;
  Bash)
    # Any shell idiom that brings a new file into existence. Heuristic by
    # nature; aimed at reflex rather than at a determined bypass.
    cmd="$(field command)"
    targets="$(printf '%s\n' "$cmd" \
      | grep -oE '([0-9]?>>?|tee([[:space:]]+-a)?|touch|Path\(")[[:space:]]*"?[^ "|;&)]+' 2>/dev/null \
      | sed -E 's/^([0-9]?>>?|tee([[:space:]]+-a)?|touch|Path\(")[[:space:]]*"?//' \
      | sed -E 's/"$//' || true)"
    ;;
  *) exit 0 ;;
esac

[ -z "$targets" ] && exit 0

while IFS= read -r raw; do
  # ⛔ Trim first. macOS sed has no \s, so an untrimmed leading space made
  # "/dev/null" and the keyhole itself fail to match and blocked everything.
  raw="$(printf '%s' "$raw" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  [ -z "$raw" ] && continue
  rel="${raw#"$PWD"/}"

  # Not a file.
  case "$rel" in
    /dev/null|/dev/*|-|"") continue ;;
  esac

  # The only keyhole.
  case "$rel" in
    .claude/.borrow-check-ok) continue ;;
  esac

  # Edits are always fine. This is about CREATION.
  [ -e "$rel" ] && continue

  # ── THE KEYHOLE, with teeth ──────────────────────────────────────
  #
  # A bare path was one `echo` away from meaningless, and the thing being
  # guarded against is precisely the energy spent rationalising creation over
  # adaptation. So the acknowledgement has to be FALSIFIABLE, not declarative.
  #
  # Required line format, exactly:
  #   <path> :: searched=<grep pattern> :: closest=<existing file|NONE> :: because=<store|control|novel>
  #
  ack=""
  if [ -f .claude/.borrow-check-ok ]; then
    ack="$(grep -F -- "$rel :: " .claude/.borrow-check-ok | tail -1 || true)"
  fi

  if [ -n "$ack" ]; then
    searched="$(printf '%s' "$ack" | sed -nE 's/.*:: *searched=([^:]*[^: ]) *::.*/\1/p')"
    closest="$(printf '%s' "$ack" | sed -nE 's/.*:: *closest=([^:]*[^: ]) *::.*/\1/p')"
    because="$(printf '%s' "$ack" | sed -nE 's/.*:: *because=([a-z]+).*/\1/p')"

    # CHECK 1 — the ack is structured. A malformed line proves nothing.
    if [ -z "$searched" ] || [ -z "$closest" ] || [ -z "$because" ]; then
      cat >&2 <<MSG
⛔ BORROW CHECK — the acknowledgement for $rel is malformed, so it proves nothing.

Required, exactly:
  $rel :: searched=<grep pattern you ACTUALLY ran> :: closest=<existing file|NONE> :: because=<store|control|novel>

because=control  -> the difference is a CONTROL on the existing thing. Then do
                    not create this; change the existing thing.
because=store    -> it genuinely needs a different STORE.
because=novel    -> nothing in the repo does this job at all.
MSG
      exit 2
    fi

    # CHECK 2 — "because=control" is a self-refutation. If the difference is a
    # control, the answer is to change what exists, not to add a file.
    if [ "$because" = "control" ]; then
      cat >&2 <<MSG
⛔ BORROW CHECK — you wrote because=control for $rel.

That is the answer: a different CONTROL belongs inside $closest. Creating a new
file for it is the duplication. Go and change $closest instead.
MSG
      exit 2
    fi

    # CHECK 3 — closest= must be real. Naming a file that does not exist is
    # how "I looked" gets asserted without looking.
    if [ "$closest" != "NONE" ] && [ ! -e "$closest" ]; then
      cat >&2 <<MSG
⛔ BORROW CHECK — closest=$closest does not exist, so $rel is not cleared.

Name the real file that comes nearest to doing this job, or NONE — and NONE is
checked below against an actual search.
MSG
      exit 2
    fi

    # CHECK 4 — NONE is falsifiable. The hook runs its OWN search from the
    # words in the new path. If it finds candidates, "nothing does this" is
    # refused and the candidates are put in front of you.
    if [ "$closest" = "NONE" ]; then
      stem="$(basename "$rel" | sed -E 's/\.[a-z]+$//')"
      words="$(printf '%s' "$stem" \
        | sed -E 's/([a-z0-9])([A-Z])/\1 \2/g; s/[-_]/ /g' \
        | tr 'A-Z' 'a-z' \
        | tr ' ' '\n' \
        | grep -vE '^(the|a|an|new|and|for|to|of|is|it|page|index|utils?|helpers?|types?|lib)$' \
        | grep -E '.{4,}' || true)"
      hits=""
      while IFS= read -r w; do
        [ -z "$w" ] && continue
        found="$(find components lib app -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null \
          | grep -iF -- "$w" | grep -vF -- "$rel" | head -4 || true)"
        [ -n "$found" ] && hits="$hits$found"$'\n'
      done <<< "$words"
      hits="$(printf '%s' "$hits" | sort -u | grep -v '^$' | head -8 || true)"

      if [ -n "$hits" ]; then
        cat >&2 <<MSG
⛔ BORROW CHECK — you claimed closest=NONE for $rel, and a search disagrees.

These already exist and share its vocabulary. Open them before claiming nothing
does this job:

$hits

If one of them is nearest, put it in closest= and decide store-vs-control. If
you have genuinely read these and none of them is related, say so to the user
in the conversation and have THEM confirm it is novel — then re-record with
closest=NONE after that exchange.
MSG
        exit 2
      fi
    fi

    # Cleared. Logged on the way through, so every claim stays auditable.
    printf '%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ack" >> .claude/.borrow-check-log 2>/dev/null || true
    continue
  fi

  cat >&2 <<MSG
⛔ BORROW CHECK — blocked creating a NEW file: $rel

STOP. Do not write this. Ask the user, in the conversation, FIRST:

    "Is this genuinely novel, or are we borrowing from our own code?"

Name the thing that already does this job. Appointing a person to a job is
AssignPanel in the admin console. Flagging something is the toolkit. Writing
org data is updateField. A second surface for a verb that already has one is a
defect even when it works, because nobody can tell which one is real.

You will have a good reason. The reason is the symptom: every duplicate in this
repo was defended by naming a difference that was genuinely true. Naming a
difference feels like analysis, so it passes for a reason. The test is whether
that difference needs a different STORE or just a different CONTROL. It is
almost always the control.

A leftover artifact looking for a job is the same trap: if the thing it was
built for is gone, delete it. Do not find it new work.

Only once the user has confirmed it is genuinely new, and only after you have
actually searched:
    echo "$rel :: searched=<pattern you ran> :: closest=<existing file|NONE> :: because=<store|novel>" >> .claude/.borrow-check-ok

because=control is rejected on purpose: if the difference is a control, change
the existing thing instead of adding this one.
MSG
  exit 2
done <<< "$targets"

exit 0
