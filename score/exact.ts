// Exact-match score for enums / scalars. 1 if equal, 0 otherwise.
// Strings are compared case-insensitively after trimming so "Phase 3" and
// "PHASE_3" don't get a 0 just because of formatting noise — but the canonical
// inputs from the schema (Zod enums) are already normalized, so in practice
// this is just `===`.
export function scoreExact<T>(extracted: T, gold: T): 0 | 1 {
  if (extracted === gold) return 1;
  if (typeof extracted === 'string' && typeof gold === 'string') {
    return extracted.trim().toLowerCase() === gold.trim().toLowerCase() ? 1 : 0;
  }
  return 0;
}
