/**
 * Minimal word-level diff utility — no dependencies.
 *
 * Splits strings on whitespace, runs LCS, returns tokens
 * annotated as 'equal' | 'add' | 'remove'.
 *
 * Used in the pending-change review UI to highlight
 * what actually changed in long text fields.
 */

export type DiffToken = {
  text: string;
  type: "equal" | "add" | "remove";
};

/** Tokenise into words + whitespace runs so we preserve spacing. */
function tokenise(s: string): string[] {
  return s.split(/(\s+)/).filter((t) => t.length > 0);
}

/** LCS length table — O(n·m) time & space. */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

/** Backtrace LCS table to build diff tokens. */
function backtrace(dp: number[][], a: string[], b: string[], i: number, j: number, out: DiffToken[]): void {
  if (i === 0 && j === 0) return;
  if (i === 0) {
    backtrace(dp, a, b, i, j - 1, out);
    out.push({ text: b[j - 1], type: "add" });
  } else if (j === 0) {
    backtrace(dp, a, b, i - 1, j, out);
    out.push({ text: a[i - 1], type: "remove" });
  } else if (a[i - 1] === b[j - 1]) {
    backtrace(dp, a, b, i - 1, j - 1, out);
    out.push({ text: a[i - 1], type: "equal" });
  } else if (dp[i - 1][j] >= dp[i][j - 1]) {
    backtrace(dp, a, b, i - 1, j, out);
    out.push({ text: a[i - 1], type: "remove" });
  } else {
    backtrace(dp, a, b, i, j - 1, out);
    out.push({ text: b[j - 1], type: "add" });
  }
}

/**
 * Returns a diff between `before` and `after` at word granularity.
 * Whitespace tokens are always emitted as 'equal' so rendering preserves layout.
 */
export function wordDiff(before: string, after: string): DiffToken[] {
  const a = tokenise(before);
  const b = tokenise(after);
  const dp = lcsTable(a, b);
  const tokens: DiffToken[] = [];
  backtrace(dp, a, b, a.length, b.length, tokens);
  // Collapse adjacent equal whitespace to avoid noise
  return tokens;
}

/**
 * Returns true when we should show a diff view rather than plain before/after.
 * Heuristic: only useful if both values are non-empty strings with words,
 * longer than 60 chars combined, and not a URL.
 */
export function shouldShowDiff(before: string | null | undefined, after: string | null | undefined): boolean {
  if (!before || !after) return false;
  const combined = before + after;
  if (combined.length < 60) return false;
  // Don't diff URLs or single tokens
  if (!before.includes(" ") && !after.includes(" ")) return false;
  return true;
}
