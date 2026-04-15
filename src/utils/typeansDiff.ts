/**
 * Character-by-character diff for type-in-the-answer cards.
 * Matches Anki desktop's color-coded diff display:
 * - Green (#0a0) for correct characters
 * - Red (#f00) for incorrect characters typed
 * - Grey (#888) with strikethrough for missing characters
 */

type DiffEntry =
  | { type: "correct"; value: string }
  | { type: "incorrect"; typed: string; expected: string }
  | { type: "missing"; value: string }
  | { type: "extra"; value: string };

/**
 * Compute a character-level diff between the typed and expected strings.
 * Uses a simple LCS (Longest Common Subsequence) approach to align characters.
 */
export function computeDiff(typed: string, expected: string): DiffEntry[] {
  const lcs = computeLCS(typed, expected);
  const entries: DiffEntry[] = [];

  let ti = 0; // typed index
  let ei = 0; // expected index
  let li = 0; // lcs index

  while (ti < typed.length || ei < expected.length) {
    if (li < lcs.length) {
      const lcsChar = lcs[li]!;

      // Advance through typed chars not in LCS (extra/incorrect)
      let extraTyped = "";
      while (ti < typed.length && typed[ti] !== lcsChar) {
        extraTyped += typed[ti];
        ti++;
      }

      // Advance through expected chars not in LCS (missing)
      let missingExpected = "";
      while (ei < expected.length && expected[ei] !== lcsChar) {
        missingExpected += expected[ei];
        ei++;
      }

      // Pair up extra typed with missing expected as "incorrect"
      if (extraTyped.length > 0 && missingExpected.length > 0) {
        const minLen = Math.min(extraTyped.length, missingExpected.length);
        entries.push({
          type: "incorrect",
          typed: extraTyped.slice(0, minLen),
          expected: missingExpected.slice(0, minLen),
        });
        if (extraTyped.length > minLen) {
          entries.push({ type: "extra", value: extraTyped.slice(minLen) });
        }
        if (missingExpected.length > minLen) {
          entries.push({ type: "missing", value: missingExpected.slice(minLen) });
        }
      } else if (extraTyped.length > 0) {
        entries.push({ type: "extra", value: extraTyped });
      } else if (missingExpected.length > 0) {
        entries.push({ type: "missing", value: missingExpected });
      }

      // The matching LCS character
      entries.push({ type: "correct", value: lcsChar });
      ti++;
      ei++;
      li++;
    } else {
      // No more LCS chars — remaining typed are extra, remaining expected are missing
      let extraTyped = "";
      while (ti < typed.length) {
        extraTyped += typed[ti];
        ti++;
      }
      let missingExpected = "";
      while (ei < expected.length) {
        missingExpected += expected[ei];
        ei++;
      }

      if (extraTyped.length > 0 && missingExpected.length > 0) {
        const minLen = Math.min(extraTyped.length, missingExpected.length);
        entries.push({
          type: "incorrect",
          typed: extraTyped.slice(0, minLen),
          expected: missingExpected.slice(0, minLen),
        });
        if (extraTyped.length > minLen) {
          entries.push({ type: "extra", value: extraTyped.slice(minLen) });
        }
        if (missingExpected.length > minLen) {
          entries.push({ type: "missing", value: missingExpected.slice(minLen) });
        }
      } else if (extraTyped.length > 0) {
        entries.push({ type: "extra", value: extraTyped });
      } else if (missingExpected.length > 0) {
        entries.push({ type: "missing", value: missingExpected });
      }
    }
  }

  return entries;
}

/**
 * Compute the Longest Common Subsequence of two strings.
 */
function computeLCS(a: string, b: string): string {
  const m = a.length;
  const n = b.length;

  // DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to find LCS
  let result = "";
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result = a[i - 1] + result;
      i--;
      j--;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

/**
 * Render a diff as HTML matching Anki desktop's display.
 * Shows two rows: the typed answer (with correct/incorrect/extra highlighting)
 * and the expected answer (with correct/missing highlighting).
 */
export function renderDiffHtml(typed: string, expected: string): string {
  if (typed === expected) {
    return `<div id="typeans" class="typeans-correct">${escapeHtml(expected)}</div>`;
  }

  const diff = computeDiff(typed, expected);

  // Build the "typed" row showing what was typed
  let typedRow = "";
  for (const entry of diff) {
    switch (entry.type) {
      case "correct":
        typedRow += `<span class="typeGood">${escapeHtml(entry.value)}</span>`;
        break;
      case "incorrect":
        typedRow += `<span class="typeBad">${escapeHtml(entry.typed)}</span>`;
        break;
      case "extra":
        typedRow += `<span class="typeBad">${escapeHtml(entry.value)}</span>`;
        break;
      case "missing":
        typedRow += `<span class="typeMissed">-</span>`;
        break;
    }
  }

  // Build the "expected" row
  let expectedRow = "";
  for (const entry of diff) {
    switch (entry.type) {
      case "correct":
        expectedRow += `<span class="typeGood">${escapeHtml(entry.value)}</span>`;
        break;
      case "incorrect":
        expectedRow += `<span class="typeBad">${escapeHtml(entry.expected)}</span>`;
        break;
      case "missing":
        expectedRow += `<span class="typeMissed">${escapeHtml(entry.value)}</span>`;
        break;
      case "extra":
        // Extra typed chars don't appear in expected row
        break;
    }
  }

  return `<div id="typeans"><div class="typeans-row">${typedRow}</div><hr><div class="typeans-row">${expectedRow}</div></div>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Strip HTML tags from a string and decode HTML entities.
 * Used to get the plain-text expected answer from a field value.
 */
export function stripHtmlForComparison(html: string): string {
  // Remove HTML tags
  let text = html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "");
  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
  return text.trim();
}
