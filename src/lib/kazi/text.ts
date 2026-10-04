const STOPWORDS = new Set(
  `a an and are as at be by for from has have in is it its of on or that the to was were will with you your we our this these those their they them he she his her not no yes can may must should would could about across after against all also any because been before being between both but each few more most other over own same so some such than then there through under until up very what when where which while who whom why how into out off only per via etc`.split(
    /\s+/,
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s/-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[.\-/]+|[.\-/]+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

export function termSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

/** Fraction of `needles` terms that appear in `haystack`. */
export function coverage(needles: string[], haystack: string): { matched: string[]; missing: string[]; ratio: number } {
  const hay = termSet(haystack);
  const hayText = haystack.toLowerCase();
  const matched: string[] = [];
  const missing: string[] = [];
  for (const n of needles) {
    const toks = tokenize(n);
    const hit = toks.length > 0 && (hayText.includes(n.toLowerCase()) || toks.every((t) => hay.has(t)));
    (hit ? matched : missing).push(n);
  }
  return { matched, missing, ratio: needles.length ? matched.length / needles.length : 0 };
}

export function overlapScore(a: string, b: string): number {
  const sa = termSet(a);
  const sb = termSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let hits = 0;
  for (const t of sa) if (sb.has(t)) hits++;
  return hits / Math.min(sa.size, sb.size);
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

export function collapseWhitespace(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
