import { describe, expect, it } from 'vitest';
import { scoreListF1 } from '../list';
import { stringSimilarity } from '../similarity';

const sim = (a: string, b: string) => stringSimilarity(a, b);

describe('scoreListF1', () => {
  it('identical lists score F1 = 1', () => {
    const a = ['Adults 18+', 'No prior treatment', 'ECOG 0-1'];
    const r = scoreListF1(a, a, sim, 0.7);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.f1).toBe(1);
    expect(r.matches.length).toBe(3);
  });

  it('disjoint lists score F1 = 0', () => {
    const r = scoreListF1(['lorem ipsum'], ['totally unrelated criterion'], sim, 0.7);
    expect(r.precision).toBe(0);
    expect(r.recall).toBe(0);
    expect(r.f1).toBe(0);
  });

  it('one matched + one unmatched on each side gives F1 < 1', () => {
    const extracted = ['Adults 18+', 'fictional made-up criterion'];
    const gold = ['Adults 18+', 'totally different ground-truth item'];
    const r = scoreListF1(extracted, gold, sim, 0.7);
    expect(r.precision).toBeCloseTo(0.5);
    expect(r.recall).toBeCloseTo(0.5);
    expect(r.f1).toBeCloseTo(0.5);
  });

  it('paraphrases above threshold do match (Hungarian assignment)', () => {
    // A close paraphrase: one extra word, identical otherwise. Levenshtein
    // ratio is well above 0.7.
    const r = scoreListF1(
      ['Adults aged 18 or older'],
      ['Adults aged 18 years or older'],
      sim,
      0.7,
    );
    expect(r.matches.length).toBe(1);
    expect(r.f1).toBe(1);
  });

  it('paraphrases below threshold do NOT match', () => {
    const r = scoreListF1(['short'], ['a much longer eligibility description that has very few characters in common'], sim, 0.7);
    expect(r.matches.length).toBe(0);
    expect(r.f1).toBe(0);
  });

  it("avoids double-counting: one gold cannot match two extracted", () => {
    // Two near-duplicate extractions, one gold. Hungarian assigns to one
    // pair, the other extracted is unmatched → precision 0.5, recall 1.
    const r = scoreListF1(
      ['Adults aged 18 or older', 'Adults 18 or older'],
      ['Adults aged 18 or older'],
      sim,
      0.7,
    );
    expect(r.matches.length).toBe(1);
    expect(r.precision).toBeCloseTo(0.5);
    expect(r.recall).toBeCloseTo(1);
    // F1 = 2 * 0.5 * 1 / 1.5 = 0.6666...
    expect(r.f1).toBeCloseTo(2 / 3);
  });

  it('empty extracted vs non-empty gold: precision=1, recall=0, F1=0', () => {
    const r = scoreListF1<string>([], ['something'], sim, 0.7);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(0);
    expect(r.f1).toBe(0);
  });

  it('both empty: F1 = 1 (vacuous match)', () => {
    const r = scoreListF1<string>([], [], sim, 0.7);
    expect(r.f1).toBe(1);
  });
});
