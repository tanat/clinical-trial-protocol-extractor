import { get as levenshteinDistance } from 'fast-levenshtein';

// Normalized Levenshtein ratio in [0, 1]. 1 = identical, 0 = no shared chars.
// Inputs are lower-cased and whitespace-collapsed first so "Adults  18+" and
// "adults 18+" don't lose points to formatting noise.
export function stringSimilarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (x.length === 0 && y.length === 0) return 1;
  const max = Math.max(x.length, y.length);
  if (max === 0) return 0;
  const d = levenshteinDistance(x, y, { useCollator: false });
  return 1 - d / max;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
