import { generateText, Output, gateway } from 'ai';
import { z } from 'zod';
import type { Protocol } from '@/schemas/v1/protocol';

const JudgeResult = z.object({
  score: z.number().min(0).max(1),
  reason: z.string().max(150),
});

// Haiku is cheapest and fast enough for scoring
const JUDGE_MODEL = gateway('anthropic/claude-haiku-4-5-20251001');

async function judgeMatch(field: string, extracted: string, gold: string): Promise<number> {
  const { output } = await generateText({
    model: JUDGE_MODEL,
    output: Output.object({ schema: JudgeResult }),
    prompt: `Does the extracted ${field} match the ground truth?

Extracted: "${extracted}"
Ground truth: "${gold}"

Score: 1.0 = same meaning (paraphrases OK), 0.5 = partially correct, 0.0 = wrong or unrelated.
Be strict about numeric thresholds and factual accuracy. Lenient about phrasing.`,
  });
  return output.score;
}

async function judgeListF1<T>(
  field: string,
  extracted: T[],
  gold: T[],
  toString: (x: T) => string,
): Promise<{ score: number; precision: number; recall: number; type: 'llm-judge' }> {
  if (extracted.length === 0 && gold.length === 0)
    return { score: 1, precision: 1, recall: 1, type: 'llm-judge' };
  if (extracted.length === 0) return { score: 0, precision: 1, recall: 0, type: 'llm-judge' };
  if (gold.length === 0) return { score: 0, precision: 0, recall: 1, type: 'llm-judge' };

  // Build score matrix in parallel — n*m calls to Haiku
  const scoreMatrix = await Promise.all(
    extracted.map((e) =>
      Promise.all(gold.map((g) => judgeMatch(field, toString(e), toString(g)))),
    ),
  );

  // Greedy matching: each gold item matches at most one extracted (score >= 0.5)
  const matchedGold = new Set<number>();
  let tp = 0;
  for (let i = 0; i < extracted.length; i++) {
    for (let j = 0; j < gold.length; j++) {
      if (!matchedGold.has(j) && scoreMatrix[i][j] >= 0.5) {
        tp++;
        matchedGold.add(j);
        break;
      }
    }
  }

  const precision = tp / extracted.length;
  const recall = tp / gold.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { score: f1, precision, recall, type: 'llm-judge' };
}

export async function judgeProtocol(
  extracted: Protocol,
  gold: Protocol,
): Promise<Record<string, { score: number; type: string; precision?: number; recall?: number }>> {
  const exPo = extracted.primaryOutcomes ?? [];
  const exEl = extracted.eligibilityCriteria ?? [];
  const exIn = extracted.interventions ?? [];
  const goPo = gold.primaryOutcomes ?? [];
  const goEl = gold.eligibilityCriteria ?? [];
  const goIn = gold.interventions ?? [];

  const [phaseScore, studyTypeScore, outcomes, eligibility, interventions] = await Promise.all([
    judgeMatch('trial phase', extracted.phase, gold.phase),
    judgeMatch('study type', extracted.studyType, gold.studyType),
    judgeListF1('primary outcome', exPo, goPo, (o) => o.measure),
    judgeListF1(
      'eligibility criterion',
      exEl,
      goEl,
      (e) => `${e.type}: ${e.description}`,
    ),
    judgeListF1('intervention', exIn, goIn, (i) => `${i.type} ${i.name}`),
  ]);

  return {
    phase: { score: phaseScore, type: 'llm-judge' },
    studyType: { score: studyTypeScore, type: 'llm-judge' },
    primaryOutcomes: outcomes,
    eligibilityCriteria: eligibility,
    interventions,
  };
}
