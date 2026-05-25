import type {
  EligibilityItem,
  Intervention,
  PrimaryOutcome,
  Protocol,
} from '@/schemas/v1/protocol';
import { scoreExact } from './exact';
import { scoreListF1, type ListScoreResult } from './list';
import { stringSimilarity } from './similarity';

export const SIMILARITY_THRESHOLD = 0.7;

export type ExactFieldScore = { score: 0 | 1; type: 'exact' };
export type ListFieldScore = { score: number; type: 'f1'; precision: number; recall: number; matches: Array<[number, number, number]> };

export type PerFieldScores = {
  phase: ExactFieldScore;
  studyType: ExactFieldScore;
  primaryOutcomes: ListFieldScore;
  eligibilityCriteria: ListFieldScore;
  interventions: ListFieldScore;
};

function outcomeSimilarity(a: PrimaryOutcome, b: PrimaryOutcome): number {
  return stringSimilarity(a.measure, b.measure);
}

function eligibilitySimilarity(a: EligibilityItem, b: EligibilityItem): number {
  // Type mismatch is a hard block — an inclusion paraphrased as an exclusion
  // is wrong even if the words match.
  if (a.type !== b.type) return 0;
  return stringSimilarity(a.description, b.description);
}

function interventionSimilarity(a: Intervention, b: Intervention): number {
  const nameSim = stringSimilarity(a.name, b.name);
  // 0.7 weight on name + 0.3 weight on type so a perfect name match doesn't
  // require type agreement (DRUG vs OTHER are common LLM swaps), but a type
  // match still nudges the score up toward the threshold.
  const typeBonus = a.type === b.type ? 1 : 0;
  return 0.7 * nameSim + 0.3 * typeBonus;
}

function listScoreToField(r: ListScoreResult): ListFieldScore {
  return {
    score: r.f1,
    type: 'f1',
    precision: r.precision,
    recall: r.recall,
    matches: r.matches,
  };
}

export function scoreProtocol(extracted: Protocol, gold: Protocol): PerFieldScores {
  // Guard: model may return null/undefined for list fields even though the schema says array.
  const exPo = extracted.primaryOutcomes ?? [];
  const exEl = extracted.eligibilityCriteria ?? [];
  const exIn = extracted.interventions ?? [];
  const goPo = gold.primaryOutcomes ?? [];
  const goEl = gold.eligibilityCriteria ?? [];
  const goIn = gold.interventions ?? [];
  return {
    phase: { score: scoreExact(extracted.phase, gold.phase), type: 'exact' },
    studyType: { score: scoreExact(extracted.studyType, gold.studyType), type: 'exact' },
    primaryOutcomes: listScoreToField(
      scoreListF1(exPo, goPo, outcomeSimilarity, SIMILARITY_THRESHOLD),
    ),
    eligibilityCriteria: listScoreToField(
      scoreListF1(exEl, goEl, eligibilitySimilarity, SIMILARITY_THRESHOLD),
    ),
    interventions: listScoreToField(
      scoreListF1(exIn, goIn, interventionSimilarity, SIMILARITY_THRESHOLD),
    ),
  };
}
