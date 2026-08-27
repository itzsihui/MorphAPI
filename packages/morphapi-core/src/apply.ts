/**
 * Surgically replace a character span in source text (formatting-preserving outside the span).
 */
export function applySpanReplacement(
  source: string,
  start: number,
  end: number,
  replacement: string
): string {
  if (start < 0 || end > source.length || start > end) {
    throw new Error(`Invalid span [${start}, ${end}] for source length ${source.length}`);
  }
  return source.slice(0, start) + replacement + source.slice(end);
}
