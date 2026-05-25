// Two-stage cascade — stage 1: segment the detailed description into the
// four buckets the section-scoped extractors care about. We keep the
// segmenter on gpt-4o-mini because the job is coarse routing, not fine
// extraction, and we want it cheap.

import { generateText, Output, gateway } from 'ai';
import { z } from 'zod';

// All fields are required strings — OpenAI structured outputs reject optional
// properties (those with .default()) because they'd be absent from "required".
export const Sections = z.object({
  outcomes: z.string(),
  eligibility: z.string(),
  interventions: z.string(),
  other: z.string(),
});
export type Sections = z.infer<typeof Sections>;

const SEGMENTER_SYSTEM = `You split a clinical-trial detailed description into four buckets:

- outcomes: paragraphs / bullets that describe the trial's primary or secondary endpoints (what the trial measures and over what time frame).
- eligibility: paragraphs / bullets that list inclusion or exclusion criteria.
- interventions: paragraphs / bullets that describe the drugs, devices, behavioral programs, procedures, or arms of the trial.
- other: everything else (background, design rationale, sponsor info, statistical methods that aren't outcomes per se, follow-up logistics).

Rules:
- Preserve the original wording — copy spans, do not paraphrase.
- Each character of the source belongs to exactly one bucket. If a paragraph mixes topics, put it in the topic that dominates the paragraph.
- Empty buckets are fine — return an empty string for buckets that have no relevant text.
- Do not add any text the source does not contain.`;

export async function segmentDescription(text: string): Promise<Sections> {
  const result = await generateText({
    model: gateway('openai/gpt-4o-mini'),
    output: Output.object({ schema: Sections }),
    system: SEGMENTER_SYSTEM,
    prompt: text,
  });
  return result.output;
}
