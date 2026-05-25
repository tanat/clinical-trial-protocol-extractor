// Eval harness: extracts every fixture, scores against the normalized ground
// truth, aggregates per-field, and APPENDS one entry to evals/results.json.
//
// CLI:
//   tsx evals/harness.ts                       # default model+mode
//   tsx evals/harness.ts --mode=cascade        # set in Phase 12
//   tsx evals/harness.ts --model=gpt-mini      # comparison model
//   tsx evals/harness.ts --limit=2             # debug: only first 2 fixtures
//
// Append-only — never overwrites existing entries. Re-run on every prompt /
// schema change so the diff in evals/results.json is the regression history.

import { promises as fs } from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// Load .env / .env.local before any LLM calls — tsx doesn't do this automatically.
for (const envFile of ['.env', '.env.local']) {
  const envPath = path.resolve(process.cwd(), envFile);
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { extractProtocol, type ModelChoice } from '@/extract/extract';
import type { Protocol } from '@/schemas/v1/protocol';
import { Protocol as ProtocolSchema, SCHEMA_VERSION } from '@/schemas/v1/protocol';
import { PROMPT_VERSION } from '@/extract/prompt';
import { scoreProtocol, type PerFieldScores } from '@/score/aggregate';
import { logExtraction } from '@/extract/log';
import type { RawTrial } from '@/ingest/types';

const FIXTURES_DIR = path.resolve(process.cwd(), 'fixtures/trials');
const RESULTS_PATH = path.resolve(process.cwd(), 'evals/results.json');

type Mode = 'single-pass' | 'cascade';
type Scorer = 'levenshtein' | 'llm';

type CliArgs = { mode: Mode; model: ModelChoice; limit: number; scorer: Scorer };

function parseArgs(argv: string[]): CliArgs {
  let mode: Mode = 'single-pass';
  let model: ModelChoice = 'sonnet';
  let limit = Number.POSITIVE_INFINITY;
  let scorer: Scorer = 'levenshtein';
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.+)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (k === 'mode') {
      if (v !== 'single-pass' && v !== 'cascade') throw new Error(`bad --mode=${v}`);
      mode = v;
    } else if (k === 'model') {
      if (v !== 'sonnet' && v !== 'gpt-mini') throw new Error(`bad --model=${v}`);
      model = v;
    } else if (k === 'limit') {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`bad --limit=${v}`);
      limit = n;
    } else if (k === 'scorer') {
      if (v !== 'levenshtein' && v !== 'llm') throw new Error(`bad --scorer=${v}`);
      scorer = v;
    } else {
      throw new Error(`unknown flag --${k}`);
    }
  }
  return { mode, model, limit, scorer };
}

async function listFixtureIds(): Promise<string[]> {
  const entries = await fs.readdir(FIXTURES_DIR);
  return entries
    .filter((n) => /^NCT\d{8}\.json$/.test(n))
    .map((n) => n.replace(/\.json$/, ''))
    .sort();
}

async function readRaw(id: string): Promise<RawTrial> {
  return JSON.parse(await fs.readFile(path.join(FIXTURES_DIR, `${id}.json`), 'utf8')) as RawTrial;
}

async function readNormalized(id: string): Promise<Protocol | null> {
  try {
    const obj = JSON.parse(await fs.readFile(path.join(FIXTURES_DIR, `${id}.normalized.json`), 'utf8'));
    // Try strict parse — but accept the partial shape too (e.g., CHS has 0
    // primary outcomes, which trips .min(1)). The harness scores against
    // whatever is there.
    const r = ProtocolSchema.safeParse(obj);
    return r.success ? r.data : (obj as Protocol);
  } catch {
    return null;
  }
}

type PerTrialResult =
  | {
      trialId: string;
      ok: true;
      perField: PerFieldScores;
      latencyMs: number;
      tokensIn: number | null;
      tokensOut: number | null;
      validationStatus: 'valid' | 'invalid' | 'partial';
    }
  | { trialId: string; ok: false; error: string };

function meanByField(rows: PerTrialResult[]): Record<keyof PerFieldScores, number> {
  const ok = rows.filter((r): r is Extract<PerTrialResult, { ok: true }> => r.ok);
  const fields: Array<keyof PerFieldScores> = [
    'phase',
    'studyType',
    'primaryOutcomes',
    'eligibilityCriteria',
    'interventions',
  ];
  const out = {} as Record<keyof PerFieldScores, number>;
  for (const f of fields) {
    if (ok.length === 0) {
      out[f] = 0;
      continue;
    }
    const sum = ok.reduce((acc, r) => acc + r.perField[f].score, 0);
    out[f] = sum / ok.length;
  }
  return out;
}

(async () => {
  const args = parseArgs(process.argv);
  const ids = (await listFixtureIds()).slice(0, args.limit);
  if (ids.length === 0) {
    console.error('No fixtures found in fixtures/trials/.');
    process.exit(1);
  }

  console.log(
    `Eval run: mode=${args.mode} model=${args.model} scorer=${args.scorer} schema=${SCHEMA_VERSION} prompt=${PROMPT_VERSION} fixtures=${ids.length}`,
  );

  const perTrial: PerTrialResult[] = [];

  for (const id of ids) {
    process.stdout.write(`  ${id} ... `);
    try {
      const raw = await readRaw(id);
      const text = raw.protocolSection?.descriptionModule?.detailedDescription ?? '';
      if (!text) {
        process.stdout.write('SKIP (no detailedDescription)\n');
        perTrial.push({ trialId: id, ok: false, error: 'no detailedDescription' });
        continue;
      }
      const gold = await readNormalized(id);
      if (!gold) {
        process.stdout.write('SKIP (no normalized.json)\n');
        perTrial.push({ trialId: id, ok: false, error: 'no normalized ground truth' });
        continue;
      }

      // The harness writes its own log row with per-field scores attached, so
      // it tells extract not to log on its own. The cascade module is loaded
      // lazily because it only exists once Phase 12 lands.
      let result;
      if (args.mode === 'cascade') {
        const { extractCascade } = await import('@/extract/cascade');
        result = await extractCascade(text, { trialId: id, log: false });
      } else {
        result = await extractProtocol(text, { model: args.model, trialId: id, log: false });
      }

      const extractedParsed = ProtocolSchema.safeParse(result.extraction);
      const extracted: Protocol | null = extractedParsed.success
        ? extractedParsed.data
        : (result.extraction as Protocol);

      let perField: PerFieldScores | Record<string, unknown>;
      if (args.scorer === 'llm') {
        const { judgeProtocol } = await import('@/score/llm-judge');
        perField = await judgeProtocol(extracted as Protocol, gold);
      } else {
        perField = scoreProtocol(extracted as Protocol, gold);
      }

      const getScore = (field: keyof PerFieldScores) =>
        (perField as Record<string, { score: number }>)[field]?.score ?? 0;

      perTrial.push({
        trialId: id,
        ok: true,
        perField: perField as PerFieldScores,
        latencyMs: result.meta.latencyMs,
        tokensIn: result.meta.tokensIn,
        tokensOut: result.meta.tokensOut,
        validationStatus: result.validationStatus,
      });

      logExtraction({
        trialId: id,
        schemaVersion: result.meta.schemaVersion,
        promptVersion: result.meta.promptVersion,
        model: result.meta.modelId,
        inputChars: result.meta.inputChars,
        outputJson: result.extraction,
        validationStatus: result.validationStatus,
        validationErrors: result.validationErrors ?? null,
        perFieldScores: perField as unknown as Record<string, unknown>,
        latencyMs: result.meta.latencyMs,
        tokensIn: result.meta.tokensIn,
        tokensOut: result.meta.tokensOut,
      });

      process.stdout.write(
        `${result.validationStatus}  phase=${getScore('phase').toFixed(2)} st=${getScore('studyType').toFixed(2)} ` +
          `out=${getScore('primaryOutcomes').toFixed(2)} ` +
          `el=${getScore('eligibilityCriteria').toFixed(2)} ` +
          `int=${getScore('interventions').toFixed(2)} ` +
          `(${result.meta.latencyMs}ms)\n`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`ERROR: ${msg}\n`);
      perTrial.push({ trialId: id, ok: false, error: msg });
    }
  }

  const aggregate = meanByField(perTrial);

  const entry = {
    runId: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    promptVersion: PROMPT_VERSION,
    model: args.mode === 'cascade' ? 'cascade(gpt-4o-mini segmenter, claude-sonnet-4-6 sections)' : args.model === 'sonnet' ? 'claude-sonnet-4-6' : 'gpt-4o-mini',
    mode: args.mode,
    perTrial,
    aggregate,
  };

  // Append-only: read existing array, push, write.
  let existing: unknown = [];
  try {
    const buf = await fs.readFile(RESULTS_PATH, 'utf8');
    existing = JSON.parse(buf);
  } catch {
    existing = [];
  }
  if (!Array.isArray(existing)) {
    throw new Error(`evals/results.json is not an array; refusing to overwrite`);
  }
  existing.push(entry);
  await fs.writeFile(RESULTS_PATH, JSON.stringify(existing, null, 2) + '\n', 'utf8');

  console.log('\nAggregate per-field means:');
  for (const [f, v] of Object.entries(aggregate)) {
    console.log(`  ${f.padEnd(22)} ${v.toFixed(3)}`);
  }
  console.log(`\nWrote entry ${existing.length} to ${path.relative(process.cwd(), RESULTS_PATH)}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
