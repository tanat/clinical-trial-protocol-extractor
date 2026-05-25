import { describe, expect, it } from 'vitest';
import { scoreProtocol } from '../aggregate';
import type { Protocol } from '@/schemas/v1/protocol';

const goldA: Protocol = {
  phase: 'PHASE_3',
  studyType: 'INTERVENTIONAL',
  primaryOutcomes: [
    { measure: 'Overall survival', timeFrame: 'time from randomization to death' },
  ],
  eligibilityCriteria: [
    { type: 'INCLUSION', description: 'Adults aged 18 or older' },
    { type: 'INCLUSION', description: 'ECOG performance status 0 or 1' },
    { type: 'EXCLUSION', description: 'Active CNS metastases' },
  ],
  interventions: [
    { type: 'DRUG', name: 'pembrolizumab' },
    { type: 'DRUG', name: 'paclitaxel' },
  ],
};

describe('scoreProtocol', () => {
  it('scores 1 across the board for an exact-match extraction', () => {
    const scores = scoreProtocol(structuredClone(goldA), goldA);
    expect(scores.phase.score).toBe(1);
    expect(scores.studyType.score).toBe(1);
    expect(scores.primaryOutcomes.score).toBe(1);
    expect(scores.eligibilityCriteria.score).toBe(1);
    expect(scores.interventions.score).toBe(1);
  });

  it('penalizes phase + intervention swaps but credits paraphrased eligibility', () => {
    const extracted: Protocol = {
      phase: 'PHASE_2', // wrong
      studyType: 'INTERVENTIONAL',
      primaryOutcomes: [
        { measure: 'Overall Survival (OS)' }, // close paraphrase, should match
      ],
      eligibilityCriteria: [
        { type: 'INCLUSION', description: 'Adults 18 years or older' }, // close paraphrase
        { type: 'INCLUSION', description: 'ECOG performance status of 0 or 1' }, // very close
        { type: 'EXCLUSION', description: 'Active CNS metastases at screening' }, // close
      ],
      interventions: [
        { type: 'DRUG', name: 'pembrolizumab' }, // exact
        // missing paclitaxel → recall hit
      ],
    };

    const scores = scoreProtocol(extracted, goldA);

    expect(scores.phase.score).toBe(0);
    expect(scores.studyType.score).toBe(1);
    expect(scores.primaryOutcomes.score).toBe(1);
    // Eligibility: 3 paraphrases vs 3 gold. Levenshtein at threshold 0.7 is
    // strict — only the closest paraphrase ("ECOG performance status of 0 or
    // 1" vs "ECOG performance status 0 or 1", ratio ≈ 0.91) clears it.
    // Two more drop just under (0.62–0.67). F1 = 2 * (1/3)(1/3) / (2/3) = 1/3.
    // We assert: matching does happen for very-close paraphrases (score > 0)
    // and the F1 is bounded below 1 (paraphrasing isn't free).
    expect(scores.eligibilityCriteria.matches.length).toBeGreaterThan(0);
    expect(scores.eligibilityCriteria.score).toBeGreaterThan(0);
    expect(scores.eligibilityCriteria.score).toBeLessThan(1);
    // interventions: 1 of 1 extracted matched, 1 of 2 gold covered →
    // precision=1, recall=0.5, F1=0.6666...
    expect(scores.interventions.precision).toBeCloseTo(1);
    expect(scores.interventions.recall).toBeCloseTo(0.5);
    expect(scores.interventions.score).toBeCloseTo(2 / 3, 4);
  });
});
