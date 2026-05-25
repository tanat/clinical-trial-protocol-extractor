// Two-stage cascade — stage 2: section-scoped generateObject calls against
// schemas that only model the field each section is supposed to populate.
// We then reassemble into a full Protocol so the eval rubric is unchanged.
//
// The "other" bucket is the only place phase / studyType can come from
// (those are usually stated in the trial header, not in outcomes /
// eligibility / interventions paragraphs). We include the full original
// text alongside the "other" bucket to give the model the boilerplate
// context that names the phase.

import { generateText, Output, gateway } from 'ai';
import { z } from 'zod';

import { segmentDescription } from './segment';
import {
  Phase,
  StudyType,
  PrimaryOutcome,
  EligibilityItem,
  Intervention,
  Protocol as ProtocolSchema,
  SCHEMA_VERSION,
} from '@/schemas/v1/protocol';
import type { Protocol } from '@/schemas/v1/protocol';
import { PROMPT_VERSION } from './prompt';
import type { ExtractionResult, ExtractOptions } from './extract';
import { logExtraction } from './log';
import { withVcrCache, fingerprintInput } from '@/lib/vcr';

const SECTION_MODEL = gateway('anthropic/claude-sonnet-4-6');

// Section schemas — strict subsets of the full Protocol so the model can
// focus on one field at a time.
const OutcomesOnly = z.object({ primaryOutcomes: z.array(PrimaryOutcome) });
const EligibilityOnly = z.object({ eligibilityCriteria: z.array(EligibilityItem) });
const InterventionsOnly = z.object({ interventions: z.array(Intervention) });
const HeaderOnly = z.object({ phase: Phase, studyType: StudyType });

const OUTCOMES_PROMPT = `Extract every primary outcome (a.k.a. primary endpoint) named in the text. Each outcome is { measure, timeFrame?, description? }. measure is the named endpoint. timeFrame is the assessment window, if stated. description is a one-sentence elaboration if present. Drop secondary outcomes. Return an empty array if no primary outcome is named.`;
const ELIGIBILITY_PROMPT = `Extract every eligibility criterion as { type, description, category? }. type is INCLUSION or EXCLUSION. Rewrite long sentences but preserve meaning, numeric thresholds, and abbreviations as written. category is DEMOGRAPHIC, MEDICAL, PROCEDURAL, or OTHER (omit if unclear).`;
const INTERVENTIONS_PROMPT = `Extract every concrete intervention as { type, name, dosage? }. type is DRUG, DEVICE, BEHAVIORAL, PROCEDURE, or OTHER. name is the agent or program as written. dosage is route + amount + schedule if stated; omit otherwise. If no intervention is named, return an empty array.`;
const HEADER_PROMPT = `Pick the trial phase and studyType. phase is one of EARLY_PHASE_1, PHASE_1, PHASE_1_2, PHASE_2, PHASE_2_3, PHASE_3, PHASE_4, NA. studyType is INTERVENTIONAL, OBSERVATIONAL, or EXPANDED_ACCESS. If the text does not state a phase, use NA. If interventions are clearly being assigned to participants, use INTERVENTIONAL.`;

export async function extractCascade(
  text: string,
  opts?: ExtractOptions,
): Promise<ExtractionResult> {
  const started = Date.now();
  let tokensIn = 0;
  let tokensOut = 0;

  // VCR cache wraps the whole 5-call cascade (segmenter + 4 sections). On a
  // cache hit we skip the segment + four-fan-out entirely; on miss the inner
  // closure runs as before. See lib/vcr.ts for the cache key shape and
  // EVAL_VCR=1 toggle.
  const { value: assembledBundle } = await withVcrCache(
    {
      model: 'cascade(gpt-4o-mini+claude-sonnet-4-6)',
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      fingerprint: fingerprintInput(text),
      mode: 'cascade',
    },
    async () => {
      const sections = await segmentDescription(text);
      const [outcomesRes, eligibilityRes, interventionsRes, headerRes] = await Promise.all([
        generateText({
          model: SECTION_MODEL,
          output: Output.object({ schema: OutcomesOnly }),
          system: OUTCOMES_PROMPT,
          prompt: sections.outcomes || text,
        }),
        generateText({
          model: SECTION_MODEL,
          output: Output.object({ schema: EligibilityOnly }),
          system: ELIGIBILITY_PROMPT,
          prompt: sections.eligibility || text,
        }),
        generateText({
          model: SECTION_MODEL,
          output: Output.object({ schema: InterventionsOnly }),
          system: INTERVENTIONS_PROMPT,
          prompt: sections.interventions || text,
        }),
        generateText({
          model: SECTION_MODEL,
          output: Output.object({ schema: HeaderOnly }),
          // Header is usually stated in boilerplate at the start; give the
          // model the original text rather than the segmenter's "other"
          // bucket alone.
          system: HEADER_PROMPT,
          prompt: text,
        }),
      ]);

      let tIn = 0;
      let tOut = 0;
      for (const r of [outcomesRes, eligibilityRes, interventionsRes, headerRes]) {
        tIn += r.usage.inputTokens ?? 0;
        tOut += r.usage.outputTokens ?? 0;
      }

      const assembled: Protocol = {
        phase: headerRes.output.phase,
        studyType: headerRes.output.studyType,
        primaryOutcomes: outcomesRes.output.primaryOutcomes,
        eligibilityCriteria: eligibilityRes.output.eligibilityCriteria,
        interventions: interventionsRes.output.interventions,
      };

      return { assembled, tokensIn: tIn, tokensOut: tOut };
    },
  );

  const assembled = assembledBundle.assembled;
  tokensIn = assembledBundle.tokensIn;
  tokensOut = assembledBundle.tokensOut;

  const parsed = ProtocolSchema.safeParse(assembled);
  const meta = {
    modelChoice: 'sonnet' as const,
    modelId: 'cascade(gpt-4o-mini segmenter, claude-sonnet-4-6 sections)',
    schemaVersion: SCHEMA_VERSION,
    promptVersion: PROMPT_VERSION,
    inputChars: text.length,
    latencyMs: Date.now() - started,
    tokensIn,
    tokensOut,
  };

  const result: ExtractionResult = parsed.success
    ? { extraction: parsed.data, validationStatus: 'valid', meta }
    : {
        extraction: assembled,
        validationStatus: 'partial',
        validationErrors: parsed.error.issues.map((i) => ({
          path: i.path.join('.') || '(root)',
          message: i.message,
        })),
        meta,
      };

  if (opts?.log !== false) {
    try {
      logExtraction({
        trialId: opts?.trialId ?? null,
        schemaVersion: meta.schemaVersion,
        promptVersion: meta.promptVersion,
        model: meta.modelId,
        inputChars: meta.inputChars,
        outputJson: result.extraction,
        validationStatus: result.validationStatus,
        validationErrors: result.validationErrors ?? null,
        perFieldScores: null,
        latencyMs: meta.latencyMs,
        tokensIn: meta.tokensIn,
        tokensOut: meta.tokensOut,
      });
    } catch (err) {
      console.warn('[log] failed to write cascade row:', err);
    }
  }

  return result;
}
