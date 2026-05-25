import { NextResponse } from 'next/server';
import { z } from 'zod';

import { fetchTrial } from '@/ingest/fetch-trial';
import { extractProtocol, type ModelChoice } from '@/extract/extract';

export const runtime = 'nodejs';

const Body = z
  .object({
    text: z.string().min(20).optional(),
    trialId: z
      .string()
      .regex(/^NCT\d{8}$/, 'expected NCT followed by 8 digits')
      .optional(),
    model: z.enum(['sonnet', 'gpt-mini', 'gemini']).optional(),
  })
  .refine((b) => Boolean(b.text || b.trialId), {
    message: 'provide one of `text` or `trialId`',
    path: ['text'],
  });

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  let inputText = body.text ?? '';
  let resolvedTrialId: string | null = body.trialId ?? null;

  if (body.trialId && !inputText) {
    const trial = await fetchTrial(body.trialId);
    inputText = trial.protocolSection?.descriptionModule?.detailedDescription ?? '';
    if (!inputText) {
      return NextResponse.json(
        {
          error: `Trial ${body.trialId} has no detailedDescription. Use a different fixture or supply \`text\`.`,
        },
        { status: 422 },
      );
    }
  }

  const modelChoice: ModelChoice = body.model ?? 'sonnet';
  const result = await extractProtocol(inputText, {
    model: modelChoice,
    trialId: resolvedTrialId,
  });

  return NextResponse.json({
    trialId: resolvedTrialId,
    inputChars: inputText.length,
    ...result,
  });
}
