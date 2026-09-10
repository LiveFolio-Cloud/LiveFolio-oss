/**
 * edit-summary — turns a visual-edit change into a human "line X to line Y"
 * version message.
 *
 * The iframe bridge reports whole-document HTML only (no per-element events),
 * so the ground truth for "what changed" is the line diff between the last
 * saved file (`oldHtml`) and the edited buffer (`newHtml`) — deterministic,
 * no heuristics about element identity.
 *
 * Line anchors: added/updated lines are numbered against the NEW file (the
 * file as it now stands, matching the Code view); removed lines only exist in
 * the old file, so removals keep their OLD-file line numbers.
 *
 * Diff strategy: trim the common prefix/suffix, then align the remaining
 * middle with an exact LCS when it is small enough; larger middles fall back
 * to a greedy lookahead walk (identical anchors within ±LOOKAHEAD lines) so
 * sparse big-document edits still get per-region hunks instead of one giant
 * "Updated lines 1–3000".
 */

export interface EditSummary {
  /** One human phrase per changed region, e.g. ["Updated lines 118–122"]. */
  hunks: string[];
  /** hunks joined, prefixed for use as a version message. */
  message: string;
}

/** Alignment cost cap for the exact LCS pass (~2–3ms on a laptop). */
const LCS_MAX_CELLS = 160_000;
/** Lookahead for the greedy walk's identical-anchor search. */
const LOOKAHEAD = 24;

const NO_CHANGE_MESSAGE = 'Visual edit update';

export function summarizeEdits(oldHtml: string, newHtml: string): EditSummary {
  const a = oldHtml.split('\n');
  const b = newHtml.split('\n');

  // Trim the common prefix…
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  // …and suffix (against the remaining middle only).
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  ) {
    suf++;
  }
  const midA = a.slice(pre, a.length - suf);
  const midB = b.slice(pre, b.length - suf);
  if (midA.length === 0 && midB.length === 0) {
    return { hunks: [], message: NO_CHANGE_MESSAGE };
  }

  const ops = align(midA, midB);
  const hunks = opsToHunks(ops, pre).map(formatHunk);
  const message =
    hunks.length > 0 ? `Visual edit — ${hunks.join('; ')}` : NO_CHANGE_MESSAGE;
  return { hunks, message };
}

type Op = 'eq' | 'del' | 'add';

/** Exact LCS alignment on the middle; greedy lookahead walk beyond the cap. */
function align(midA: string[], midB: string[]): Op[] {
  const cost = midA.length * midB.length;
  if (cost <= LCS_MAX_CELLS) return alignLcs(midA, midB);
  return alignGreedy(midA, midB);
}

/** Classic LCS via full DP over lines, traced back to an op list. */
function alignLcs(midA: string[], midB: string[]): Op[] {
  const n = midA.length;
  const m = midB.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        midA[i - 1] === midB[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (midA[i - 1] === midB[j - 1]) {
      ops.push('eq');
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push('del');
      i--;
    } else {
      ops.push('add');
      j--;
    }
  }
  while (i > 0) {
    ops.push('del');
    i--;
  }
  while (j > 0) {
    ops.push('add');
    j--;
  }
  ops.reverse();
  return ops;
}

/**
 * Greedy walk for huge middles: consume equal lines; on a mismatch, search
 * for the next equal anchor within ±LOOKAHEAD on each side. When anchors
 * exist, the skipped lines are emitted as del/add runs (all deletions first,
 * then additions, which keeps the hunk shape truthful for the labeler).
 */
function alignGreedy(midA: string[], midB: string[]): Op[] {
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      ops.push('eq');
      i++;
      j++;
      continue;
    }
    // Find the nearest future equal line on either side.
    let del = -1;
    let add = -1;
    for (let k = 1; k <= LOOKAHEAD; k++) {
      if (del < 0 && i + k < midA.length && midA[i + k] === midB[j]) del = k;
      if (add < 0 && j + k < midB.length && midB[j + k] === midA[i]) add = k;
      if (del >= 0 || add >= 0) break;
    }
    if (del < 0 && add < 0) {
      // No nearby anchor: treat this line pair as a 1:1 replacement and move
      // on (each step emits del+add; the while condition still converges).
      ops.push('del', 'add');
      i++;
      j++;
      continue;
    }
    if (del >= 0) {
      for (let k = 0; k < del; k++) ops.push('del');
      i += del;
    }
    if (add >= 0) {
      for (let k = 0; k < add; k++) ops.push('add');
      j += add;
    }
  }
  while (i < midA.length) {
    ops.push('del');
    i++;
  }
  while (j < midB.length) {
    ops.push('add');
    j++;
  }
  return ops;
}

interface Hunk {
  kind: 'updated' | 'added' | 'removed';
  /** 1-based file line range — NEW-file numbers except for removals (old-file). */
  start: number;
  end: number;
}

/**
 * Collapse the op list into hunks. Runs of del+add at the same spot read as
 * "updated"; isolated additions as "added"; isolated deletions as "removed"
 * (they only exist in the old file, so they keep old numbering).
 */
function opsToHunks(ops: Op[], pre: number): Hunk[] {
  const hunks: Hunk[] = [];
  let oldIdx = 0; // cursor into the old middle
  let newIdx = 0; // cursor into the new middle
  let i = 0;
  while (i < ops.length) {
    if (ops[i] === 'eq') {
      oldIdx++;
      newIdx++;
      i++;
      continue;
    }
    // A change run: count its dels and adds.
    let dels = 0;
    let adds = 0;
    while (i < ops.length && ops[i] !== 'eq') {
      if (ops[i] === 'del') dels++;
      else adds++;
      i++;
    }
    const oldStart = pre + oldIdx + 1; // first removed old line
    const newStart = pre + newIdx + 1; // first added new line
    oldIdx += dels;
    newIdx += adds;

    if (adds > 0) {
      hunks.push({
        kind: dels > 0 ? 'updated' : 'added',
        start: newStart,
        end: newStart + adds - 1,
      });
    } else {
      hunks.push({ kind: 'removed', start: oldStart, end: oldStart + dels - 1 });
    }
  }
  return hunks;
}

const rangeLabel = (start: number, end: number) =>
  start === end ? `line ${start}` : `lines ${start}–${end}`;

function formatHunk(h: Hunk): string {
  switch (h.kind) {
    case 'added':
      return `Added ${rangeLabel(h.start, h.end)}`;
    case 'removed':
      return `Removed ${rangeLabel(h.start, h.end)}`;
    case 'updated':
      return `Updated ${rangeLabel(h.start, h.end)}`;
  }
}
