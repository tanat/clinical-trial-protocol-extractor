import { promises as fs } from 'node:fs';
import path from 'node:path';

export type FieldScoreSummary = number;

export type EvalEntry = {
  runId: string;
  schemaVersion: string;
  promptVersion: string;
  model: string;
  mode: 'single-pass' | 'cascade';
  perTrial: Array<
    | {
        trialId: string;
        ok: true;
        perField: {
          phase: { score: 0 | 1; type: 'exact' };
          studyType: { score: 0 | 1; type: 'exact' };
          primaryOutcomes: { score: number; type: 'f1'; precision: number; recall: number; matches: Array<[number, number, number]> };
          eligibilityCriteria: { score: number; type: 'f1'; precision: number; recall: number; matches: Array<[number, number, number]> };
          interventions: { score: number; type: 'f1'; precision: number; recall: number; matches: Array<[number, number, number]> };
        };
        latencyMs: number;
        tokensIn: number | null;
        tokensOut: number | null;
        validationStatus: 'valid' | 'invalid' | 'partial';
      }
    | { trialId: string; ok: false; error: string }
  >;
  aggregate: {
    phase: number;
    studyType: number;
    primaryOutcomes: number;
    eligibilityCriteria: number;
    interventions: number;
  };
};

const RESULTS_PATH = path.resolve(process.cwd(), 'evals/results.json');

export async function loadResults(): Promise<EvalEntry[]> {
  try {
    const buf = await fs.readFile(RESULTS_PATH, 'utf8');
    const arr = JSON.parse(buf);
    if (!Array.isArray(arr)) return [];
    return arr as EvalEntry[];
  } catch {
    return [];
  }
}
