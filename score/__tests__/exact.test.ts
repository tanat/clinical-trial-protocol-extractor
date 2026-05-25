import { describe, expect, it } from 'vitest';
import { scoreExact } from '../exact';

describe('scoreExact', () => {
  it('returns 1 for identical primitive values', () => {
    expect(scoreExact('PHASE_3', 'PHASE_3')).toBe(1);
    expect(scoreExact(42, 42)).toBe(1);
    expect(scoreExact(true, true)).toBe(1);
  });

  it('returns 0 for different values', () => {
    expect(scoreExact('PHASE_3', 'PHASE_2')).toBe(0);
    expect(scoreExact(1, 2)).toBe(0);
  });

  it('is case- and whitespace-insensitive for strings', () => {
    expect(scoreExact('  Phase 3  ', 'phase 3')).toBe(1);
    expect(scoreExact('Phase 3', 'Phase 4')).toBe(0);
  });
});
