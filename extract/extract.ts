import { generateText, Output, NoObjectGeneratedError, gateway } from 'ai';
import type { LanguageModel } from 'ai';
import { z } from 'zod';

import { Protocol, SCHEMA_VERSION } from '@/schemas/v1/protocol';
import type { Protocol as ProtocolT } from '@/schemas/v1/protocol';
import { extractionSystemPrompt, PROMPT_VERSION } from './prompt';
import { logExtraction } from './log';
import { withVcrCache, fingerprintInput } from '@/lib/vcr';

export type ModelChoice = 'sonnet' | 'gpt-mini' | 'gemini';

export const MODEL_IDS: Record<ModelChoice, string> = {
  sonnet: 'claude-sonnet-4-6',
  'gpt-mini': 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
};

function model(choice: ModelChoice): LanguageModel {
  if (choice === 'gpt-mini') return gateway(`openai/${MODEL_IDS['gpt-mini']}`);
  if (choice === 'gemini') return gateway(`google/${MODEL_IDS.gemini}`);
  return gateway(`anthropic/${MODEL_IDS.sonnet}`);
}

export type ValidationStatus = 'valid' | 'invalid' | 'partial';

export type ExtractionResult = {
  extraction: ProtocolT | unknown;
  validationStatus: ValidationStatus;
  validationErrors?: Array<{ path: string; message: string }>;
  meta: {
    modelChoice: ModelChoice;
    modelId: string;
    schemaVersion: typeof SCHEMA_VERSION;
    promptVersion: typeof PROMPT_VERSION;
    inputChars: number;
    latencyMs: number;
    tokensIn: number | null;
    tokensOut: number | null;
  };
};

function zodIssuesToErrors(err: z.ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((i) => ({
    path: i.path.join('.') || '(root)',
    message: i.message,
  }));
}

export type ExtractOptions = {
  model?: ModelChoice;
  // When provided, the row written to logs/extractions.sqlite carries this
  // trial_id. Eval harness sets it; ad-hoc text input through the API leaves
  // it null.
  trialId?: string | null;
  // Set false from the eval harness if the eval is going to write its own
  // row with per-field scores attached.
  log?: boolean;
};

export async function extractProtocol(
  text: string,
  opts?: ExtractOptions,
): Promise<ExtractionResult> {
  const choice: ModelChoice = opts?.model ?? 'sonnet';
  const m = model(choice);
  const started = Date.now();

  let raw: unknown;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;

  try {
    // VCR cache layer: when EVAL_VCR=1 (eval harness sets this), persist the
    // raw + usage tuple keyed by (model, prompt/schema versions, input). Repeat
    // runs over the same fixture corpus on the same prompt are then $0. The
    // cache is gitignored under evals/cache/.
    const { value: cached } = await withVcrCache(
      {
        model: MODEL_IDS[choice],
        promptVersion: PROMPT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        fingerprint: fingerprintInput(text),
        mode: 'single',
      },
      async () => {
        const result = await generateText({
          model: m,
          output: Output.object({ schema: Protocol }),
          system: extractionSystemPrompt,
          prompt: text,
        });
        return {
          object: result.output,
          tokensIn: result.usage.inputTokens ?? null,
          tokensOut: result.usage.outputTokens ?? null,
        };
      },
    );
    raw = cached.object;
    tokensIn = cached.tokensIn;
    tokensOut = cached.tokensOut;
  } catch (err) {
    // The provider may reject the schema or return malformed JSON. AI SDK
    // throws NoObjectGeneratedError with the raw text for that case; we
    // attach the partial output if present so the API caller can show it.
    if (NoObjectGeneratedError.isInstance(err)) {
      const usage = err.usage;
      tokensIn = usage?.inputTokens ?? null;
      tokensOut = usage?.outputTokens ?? null;
      raw = (err as { object?: unknown }).object ?? (err as { text?: string }).text ?? null;
      const result: ExtractionResult = {
        extraction: raw,
        validationStatus: 'invalid',
        validationErrors: [{ path: '(model)', message: err.message }],
        meta: {
          modelChoice: choice,
          modelId: MODEL_IDS[choice],
          schemaVersion: SCHEMA_VERSION,
          promptVersion: PROMPT_VERSION,
          inputChars: text.length,
          latencyMs: Date.now() - started,
          tokensIn,
          tokensOut,
        },
      };
      maybeLog(result, opts);
      return result;
    }
    throw err;
  }

  const parsed = Protocol.safeParse(raw);
  const meta = {
    modelChoice: choice,
    modelId: MODEL_IDS[choice],
    schemaVersion: SCHEMA_VERSION,
    promptVersion: PROMPT_VERSION,
    inputChars: text.length,
    latencyMs: Date.now() - started,
    tokensIn,
    tokensOut,
  } as const;

  const result: ExtractionResult = parsed.success
    ? { extraction: parsed.data, validationStatus: 'valid', meta }
    : {
        extraction: raw,
        validationStatus: 'partial',
        validationErrors: zodIssuesToErrors(parsed.error),
        meta,
      };
  maybeLog(result, opts);
  return result;
}

function maybeLog(result: ExtractionResult, opts: ExtractOptions | undefined): void {
  if (opts?.log === false) return;
  try {
    logExtraction({
      trialId: opts?.trialId ?? null,
      schemaVersion: result.meta.schemaVersion,
      promptVersion: result.meta.promptVersion,
      model: result.meta.modelId,
      inputChars: result.meta.inputChars,
      outputJson: result.extraction,
      validationStatus: result.validationStatus,
      validationErrors: result.validationErrors ?? null,
      perFieldScores: null,
      latencyMs: result.meta.latencyMs,
      tokensIn: result.meta.tokensIn,
      tokensOut: result.meta.tokensOut,
    });
  } catch (err) {
    // Logging failure must never break the extraction itself. Surface to
    // stderr so the operator notices once.
    console.warn('[log] failed to write extraction row:', err);
  }
}
