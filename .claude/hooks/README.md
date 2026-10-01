# borrow-check

`borrow-check.sh` runs on `PreToolUse` for `Write` and `Bash` and blocks the
creation of any NEW file until the question has been asked out loud: *is this
genuinely novel, or are we borrowing from our own code?*

See the first section of `CLAUDE.md` for the rule and why it exists.

## Clearing a path

`.claude/.borrow-check-ok` is the only keyhole. One line per path:

```
<path> :: searched=<pattern you actually ran> :: closest=<existing file|NONE> :: because=<store|novel>
```

Four checks run against it:

1. **Structured.** Missing any field and it proves nothing — blocked.
2. **`because=control` is rejected.** If the difference is a control, it belongs
   inside the existing thing. That answer forbids the file.
3. **`closest=` must exist on disk.** You cannot name an imaginary neighbour.
4. **`closest=NONE` is falsifiable.** The hook searches the repo using the words
   in the new path's own name. If it finds candidates, NONE is refused and the
   candidates are printed. Claiming nothing exists requires the user to confirm
   it in conversation first.

Cleared claims append to `.claude/.borrow-check-log`, so every "this is new"
stays auditable.

## Notes

- Editing an existing file is never blocked. This is about CREATION.
- Nothing is exempt by category — not tests, not migrations, not scratch files.
  An earlier version exempted those, which is the same "it feels different"
  move the rule exists to stop.
- `Bash` coverage is heuristic: `touch`, `>`, `>>`, `tee`, heredocs and
  `pathlib.Path(...).write_text`. A determined bypass exists. This is aimed at
  reflex, which is what the failure actually was.
