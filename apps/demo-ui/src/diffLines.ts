/**
 * Content-aware compare for side-by-side demos.
 *
 * Ignores whitespace, wrapping, commas, comments, and variable renames.
 * Highlights only real shape/API differences, at token granularity so
 * e.g. `OpenAI(key)` vs `OpenAI({ apiKey: key })` is obvious.
 */

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function compact(s: string): string {
  return stripComments(s)
    .replace(/\s+/g, "")
    .replace(/,(?=[}\]]|$)/g, "");
}

/** Mask lowercase identifiers so `openai` vs `client` counts as the same. */
function shapeKey(s: string): string {
  return compact(s).replace(/\b[a-z_][A-Za-z0-9_]*\b/g, "#");
}

function isCommentOnlyLine(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  if (t.startsWith("//")) return true;
  if (t.startsWith("/*") || t.startsWith("*") || t === "*/") return true;
  return false;
}

function isStructuralNoise(fp: string): boolean {
  return fp.length === 0 || /^[{}();,\[\].#]+$/.test(fp);
}

export type DiffSeg = { text: string; changed: boolean };

/** Same length as input; lowercase idents → `#` so renames don't shift indices. */
function maskKeepLen(s: string): string {
  return s.replace(/\b[a-z_][A-Za-z0-9_]*\b/g, (id) => "#".repeat(id.length));
}

/**
 * Highlight the contiguous span that actually differs (API shape), ignoring
 * variable renames. E.g. left `(key)` vs right `({ apiKey: key })`.
 */
export function tokenDiffSegments(mine: string, theirs: string): DiffSeg[] {
  const a = maskKeepLen(mine);
  const b = maskKeepLen(theirs);
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let hiA = a.length - 1;
  let hiB = b.length - 1;
  while (hiA >= lo && hiB >= lo && a[hiA] === b[hiB]) {
    hiA--;
    hiB--;
  }
  const end = hiA + 1;
  if (end <= lo) {
    return [{ text: mine, changed: false }];
  }
  return [
    { text: mine.slice(0, lo), changed: false },
    { text: mine.slice(lo, end), changed: true },
    { text: mine.slice(end), changed: false },
  ].filter((s) => s.text.length > 0);
}

function linePresentInOther(line: string, otherCompact: string, otherShape: string): boolean {
  const fp = compact(line);
  const sk = shapeKey(line);
  if (isStructuralNoise(fp) && isStructuralNoise(sk)) return true;
  if (fp.length >= 3 && otherCompact.includes(fp)) return true;
  // rename-only / wrap-only: same shape appears in the other file
  if (sk.length >= 5 && otherShape.includes(sk)) return true;
  return false;
}

const STOP_IDENTS = new Set([
  "return",
  "await",
  "const",
  "let",
  "var",
  "function",
  "async",
  "export",
  "import",
  "from",
  "type",
  "new",
  "if",
  "else",
  "for",
  "while",
  "switch",
  "case",
  "break",
  "default",
  "true",
  "false",
  "null",
  "undefined",
  "process",
  "env",
]);

/** Identifiers worth matching on (API methods, types) — not keywords / locals. */
function significantIdents(line: string): Set<string> {
  const out = new Set<string>();
  for (const m of line.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
    const t = m[0];
    if (t.length <= 2 || STOP_IDENTS.has(t)) continue;
    // Prefer API-ish tokens: camelCase with upper, or known short methods
    if (/[A-Z]/.test(t) || t.length >= 5) out.add(t);
  }
  return out;
}

function identOverlap(a: string, b: string): number {
  const left = significantIdents(a);
  const right = significantIdents(b);
  let n = 0;
  for (const t of left) if (right.has(t)) n++;
  return n;
}

function shapePrefixShared(a: string, b: string): number {
  const sk = shapeKey(a);
  const ok = shapeKey(b);
  let shared = 0;
  const lim = Math.min(sk.length, ok.length);
  for (let i = 0; i < lim; i++) {
    if (sk[i] === ok[i]) shared++;
    else break;
  }
  return shared;
}

/** Score how well two lines are the "same edit site" (not just both start with return). */
function lineMatchScore(
  left: string,
  right: string,
  leftLine?: number,
  rightLine?: number
): number {
  const shared = shapePrefixShared(left, right);
  const overlap = identOverlap(left, right);
  let score =
    shared +
    overlap * 20 +
    (compact(left).includes("OpenAI") && compact(right).includes("OpenAI")
      ? 20
      : 0) +
    (shapeKey(left).includes("new#") && shapeKey(right).includes("new#")
      ? 5
      : 0);
  // Prefer same relative line when files share structure (envelope api.ts L9↔L9)
  if (leftLine != null && rightLine != null) {
    const dist = Math.abs(leftLine - rightLine);
    score += Math.max(0, 12 - dist);
  }
  return score;
}

function bestMatchLine(line: string, otherLines: string[]): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (let j = 0; j < otherLines.length; j++) {
    const o = otherLines[j];
    if (isCommentOnlyLine(o) || !o.trim()) continue;
    if (!shapeKey(o)) continue;
    const score = lineMatchScore(line, o, undefined, j + 1);
    const ratio = score / Math.max(shapeKey(line).length, shapeKey(o).length, 1);
    if (
      score > bestScore &&
      (shapePrefixShared(line, o) > 4 ||
        identOverlap(line, o) > 0 ||
        score > 10)
    ) {
      bestScore = score;
      best = o;
      void ratio;
    }
  }
  return best;
}

/**
 * Per-line token segments for `code`. Lines with no semantic diff are omitted
 * (render plain). Lines with diffs include `changed: true` spans.
 */
export function lineDiffAnnotations(
  code: string | null | undefined,
  other: string | null | undefined
): Map<number, DiffSeg[]> {
  const map = new Map<number, DiffSeg[]>();
  if (!code || !other) return map;

  const otherCompact = compact(other);
  const otherShape = shapeKey(other);
  const otherLines = other.split("\n");
  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentOnlyLine(line)) continue;
    if (isStructuralNoise(compact(line))) continue;
    if (linePresentInOther(line, otherCompact, otherShape)) continue;

    const match = bestMatchLine(line, otherLines);
    const segs = match
      ? tokenDiffSegments(line, match)
      : [{ text: line, changed: true }];

    if (!segs.some((s) => s.changed)) continue; // rename-only
    map.set(i + 1, segs);
  }

  return map;
}

/** @deprecated use lineDiffAnnotations — kept for any callers */
export function differingLineNumbers(
  code: string | null | undefined,
  other: string | null | undefined
): Set<number> {
  return new Set(lineDiffAnnotations(code, other).keys());
}

export type ContrastPair = {
  leftLine: number;
  rightLine: number;
  leftSegs: DiffSeg[];
  rightSegs: DiffSeg[];
  leftText: string;
  rightText: string;
};

/** Paired left/right contrasts for the summary list. */
export function collectContrasts(
  withoutCode: string | null,
  withCode: string | null,
  limit = 6
): ContrastPair[] {
  if (!withoutCode || !withCode) return [];

  const leftAnn = lineDiffAnnotations(withoutCode, withCode);
  const rightLines = withCode.split("\n");
  const leftLines = withoutCode.split("\n");
  const usedRight = new Set<number>();
  const pairs: ContrastPair[] = [];

  const leftNums = [...leftAnn.keys()].sort((a, b) => a - b);
  for (const ln of leftNums) {
    if (pairs.length >= limit) break;
    const text = leftLines[ln - 1] ?? "";
    let bestIdx = -1;
    let bestScore = -1;
    for (let j = 0; j < rightLines.length; j++) {
      if (usedRight.has(j)) continue;
      const o = rightLines[j];
      if (isCommentOnlyLine(o)) continue;
      const score = lineMatchScore(text, o, ln, j + 1);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }
    // Require real API-token overlap or a strong shape match — not "both say return"
    const rightText = bestIdx >= 0 ? rightLines[bestIdx] ?? "" : "";
    const overlap = bestIdx >= 0 ? identOverlap(text, rightText) : 0;
    const shared = bestIdx >= 0 ? shapePrefixShared(text, rightText) : 0;
    if (bestIdx < 0 || bestScore < 8 || (overlap === 0 && shared < 10)) {
      continue;
    }
    usedRight.add(bestIdx);
    const leftSegs = tokenDiffSegments(text, rightText);
    const rightSegs = tokenDiffSegments(rightText, text);
    if (!leftSegs.some((s) => s.changed) && !rightSegs.some((s) => s.changed)) {
      continue;
    }
    pairs.push({
      leftLine: ln,
      rightLine: bestIdx + 1,
      leftText: text,
      rightText,
      leftSegs,
      rightSegs,
    });
  }

  return pairs;
}
