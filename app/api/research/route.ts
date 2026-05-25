import { generateText, tool, stepCountIs, gateway } from 'ai';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fetchTrial } from '@/ingest/fetch-trial';
import { normalizeProtocol } from '@/ingest/normalize';

export const runtime = 'nodejs';

const FIXTURES_DIR = path.resolve(process.cwd(), 'fixtures/trials');

const Body = z.object({ question: z.string().min(5) });

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'provide question (min 5 chars)' }, { status: 400 });
  }

  const result = await generateText({
    model: gateway('anthropic/claude-sonnet-4-6'),
    system: `You are a clinical trial research assistant with access to a corpus of 25 clinical trials.
Use the available tools to look up trial information before answering.
Always cite which trials you consulted by NCT ID. Be concise and factual.`,
    prompt: body.question,
    tools: {
      listTrials: tool({
        description: 'List all NCT IDs available in the corpus',
        inputSchema: z.object({ _placeholder: z.string().optional() }),
        execute: async (_args) => {
          const entries = await fs.readdir(FIXTURES_DIR);
          return entries
            .filter((n) => /^NCT\d{8}\.json$/.test(n))
            .map((n) => n.replace('.json', ''))
            .sort();
        },
      }),
      lookupTrial: tool({
        description:
          'Get structured protocol fields for a clinical trial by NCT ID. Returns phase, studyType, primaryOutcomes, eligibilityCriteria, interventions.',
        inputSchema: z.object({
          nctId: z.string().describe('NCT ID, e.g. NCT03737981'),
        }),
        execute: async ({ nctId }) => {
          const raw = await fetchTrial(nctId);
          const normalized = normalizeProtocol(raw);
          return {
            nctId,
            briefTitle: raw.protocolSection?.identificationModule?.briefTitle ?? '',
            ...normalized,
          };
        },
      }),
    },
    stopWhen: stepCountIs(5),
  });

  return NextResponse.json({
    answer: result.text,
    toolCalls: result.steps
      .flatMap((s) => s.toolCalls ?? [])
      .map((tc) => ({ tool: tc.toolName, args: 'input' in tc ? tc.input : {} })),
    steps: result.steps.length,
  });
}
