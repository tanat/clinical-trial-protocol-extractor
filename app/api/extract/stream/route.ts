import { streamText, Output, gateway } from 'ai';
import { z } from 'zod';
import { Phase, StudyType, EligibilityItem, PrimaryOutcome, Intervention } from '@/schemas/v1/protocol';
import { extractionSystemPrompt } from '@/extract/prompt';
import { fetchTrial } from '@/ingest/fetch-trial';

export const runtime = 'nodejs';

// No .refine() and no .min(1) — partial objects during streaming can't satisfy invariants
export const ProtocolStream = z.object({
  phase: Phase,
  studyType: StudyType,
  primaryOutcomes: z.array(PrimaryOutcome),
  eligibilityCriteria: z.array(EligibilityItem),
  interventions: z.array(Intervention),
});

const Body = z.object({
  text: z.string().optional(),
  trialId: z.string().optional(),
});

export async function POST(req: Request) {
  const body = Body.parse(await req.json());

  let inputText = body.text ?? '';
  if (body.trialId && !inputText) {
    const trial = await fetchTrial(body.trialId);
    inputText = trial.protocolSection?.descriptionModule?.detailedDescription ?? '';
    if (!inputText) {
      return new Response(JSON.stringify({ error: 'No detailedDescription' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const result = streamText({
    model: gateway('anthropic/claude-sonnet-4-6'),
    output: Output.object({ schema: ProtocolStream }),
    system: extractionSystemPrompt,
    prompt: inputText,
  });

  return result.toTextStreamResponse();
}
