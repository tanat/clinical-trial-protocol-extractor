# Stage 3 — Two-Stage Cascade

## Why complicate things at all

If a single-pass `generateText({ output: Output.object({ schema: Protocol }) })` already works — why build a pipeline of 5 LLM calls instead of one? This is a serious architectural move and is justified by one specific pain.

Single-pass is one `generateText({ output: Output.object({ schema: Protocol }) })` against the full `Protocol` schema. Input — Detailed Description, 300-2000 words. Output — the full `Protocol` at once: phase, type, outcomes, eligibility criteria, interventions.

The problem is that eligibility criteria is the longest field. A typical Phase 3 trial is 20-40 inclusion criteria and 15-30 exclusion criteria, all mixed in with design, interventions, outcomes. Single-pass asks the model to **simultaneously**:

- find the phase (one line in the first paragraph)
- extract primary outcomes (1-3 items)
- list all interventions (1-5 items with dosages)
- **and** go through all 50+ eligibility criteria

Transformer models work with an "attention budget" — the longer the context and the more tasks at once, the worse the concentration on each. This isn't a myth or "poorly described in the prompt" — it's documented behavior, known as **lost-in-the-middle** on long contexts and **task interference** in multi-objective prompts. On Sonnet 4.6 with its 1M-token window this isn't critical for short inputs anymore, but for long eligibility lists recall still drops — the model misses 20-30% of criteria.

Analogy: ask a cook to simultaneously make a sauce, chop vegetables, and remember guest allergens. One of them gets forgotten. That's why in a kitchen they split roles — we do the same thing.

---

## Cascade architecture

```
text ─► segmentDescription (gateway('openai/gpt-4o-mini'))
        └─► { outcomes, eligibility, interventions, other }
                                │
                                ▼
        Promise.all([
          generateText({ output: Output.object({ schema: OutcomesOnly }),      prompt: sections.outcomes      || text }),
          generateText({ output: Output.object({ schema: EligibilityOnly }),   prompt: sections.eligibility   || text }),
          generateText({ output: Output.object({ schema: InterventionsOnly }), prompt: sections.interventions || text }),
          generateText({ output: Output.object({ schema: HeaderOnly }),        prompt: text }),  ← full text
        ])
                                │
                                ▼
        assemble → Protocol.safeParse
```

Five LLM calls versus one for single-pass. Cost grows ~3-5x in tokens. Latency is roughly equal to the latency of the slowest section call (not the sum) — thanks to `Promise.all`.

You pay in money and complexity for recall on eligibility. On Sonnet 4.6, on our corpus of 25 fixtures, this gives an eligibility F1 lift of ~0.62 → ~0.74. That's the justification.

---

## Stage 1: gpt-4o-mini as a segmenter

File: `extract/segment.ts`

```ts
import { generateText, Output, gateway } from 'ai';

export const Sections = z.object({
  outcomes: z.string(),
  eligibility: z.string(),
  interventions: z.string(),
  other: z.string(),
});

const SEGMENTER_SYSTEM = `You split a clinical-trial detailed description into four buckets:

- outcomes: paragraphs / bullets that describe the trial's primary or secondary endpoints...
- eligibility: paragraphs / bullets that list inclusion or exclusion criteria.
- interventions: paragraphs / bullets that describe the drugs, devices, behavioral programs...
- other: everything else.

Rules:
- Preserve the original wording — copy spans, do not paraphrase.
- Each character of the source belongs to exactly one bucket.
- Empty buckets are fine.
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
```

**Why `gpt-4o-mini` and not Sonnet 4.6 for segmentation:**

- The task is **rough bucket allocation**, not fine extraction. "This paragraph is about eligibility" is a decision at the level of recognizing text structure, not medical understanding.
- gpt-4o-mini is ~10x cheaper than Sonnet. The cascade is already more expensive than single-pass — saving on the segmenter is critical.
- If the segmenter mistakes routing — we have the fallback `|| text` (see below).

**Why all fields are `z.string()` (not `.optional()`):**

OpenAI structured outputs rejects optional properties in strict mode — all fields must be in `required`. So an empty bucket = an empty string `""`, not a missing field. This isn't a Zod quirk, it's a provider constraint.

**Why "preserve the original wording — copy spans, do not paraphrase":**

If the segmenter starts rewriting text — it'll introduce hallucinations. And the section extractors at the next stage won't be able to distinguish "this was in the source" from "this is what the segmenter made up." Hard rule: every character of the source lies in exactly one bucket, no new characters.

---

## Stage 2: four parallel section-scoped calls

File: `extract/cascade.ts`

```ts
import { generateText, Output, gateway } from 'ai';

const SECTION_MODEL = gateway('anthropic/claude-sonnet-4-6');

const OutcomesOnly = z.object({ primaryOutcomes: z.array(PrimaryOutcome) });
const EligibilityOnly = z.object({ eligibilityCriteria: z.array(EligibilityItem) });
const InterventionsOnly = z.object({ interventions: z.array(Intervention) });
const HeaderOnly = z.object({ phase: Phase, studyType: StudyType });

const [outcomesRes, eligibilityRes, interventionsRes, headerRes] = await Promise.all([
  generateText({
    model: SECTION_MODEL,
    output: Output.object({ schema: OutcomesOnly }),
    system: OUTCOMES_PROMPT,
    prompt: sections.outcomes || text,   // ← fallback to full text
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
    system: HEADER_PROMPT,
    prompt: text,  // ← always full text, not sections.other
  }),
]);
```

Three fundamental points in this code, each one worth understanding:

### 1. Schemas are strict subsets of Protocol

`EligibilityOnly` doesn't contain `phase` or `interventions`. The model sees **only** the field it has to fill in. Attention isn't split. The JSON Schema the SDK generates for the model describes one nested array, not five fields of different structure.

This is the main mechanism of the cascade — not segmentation itself, but **schema narrowing**. If we gave `OutcomesOnly` the same `sections.outcomes` but against the full `Protocol` schema — the model would still try to fill in the other fields. So section-scoped schemas are mandatory.

### 2. Fallback `|| text` — insurance against segmenter errors

If the segmenter returned an empty string for `outcomes` (it happens — some studies write endpoints in a "Study Design" paragraph, which the segmenter puts into `other`), the section extractor receives the **full text**.

This isn't optimal (the model sees all the noise again), but it's better than missing the field entirely. The principle: degraded extraction > no extraction. Failure mode without `|| text`: the segmenter mis-routes → the section extractor got `""` → returned an empty array → eval showed 0 for the field → you spend a week thinking the prompt is broken when really the segmenter is.

### 3. `HeaderOnly` always gets the full text

Phase and study type are almost always in the first boilerplate paragraph: "This is a Phase 2, randomized, double-blind...". The segmenter would send this paragraph to `other` (it's not about outcomes/eligibility/interventions). If we passed `sections.other` — there's a chance of getting "all other context" without the key phrase.

Full text for the header is insurance against a segmenter error on the most critical field. Header fields are short, model noise doesn't get in the way.

---

## Assembly and validation

```ts
const assembled: Protocol = {
  phase: headerRes.output.phase,
  studyType: headerRes.output.studyType,
  primaryOutcomes: outcomesRes.output.primaryOutcomes,
  eligibilityCriteria: eligibilityRes.output.eligibilityCriteria,
  interventions: interventionsRes.output.interventions,
};

const parsed = ProtocolSchema.safeParse(assembled);
```

After assembly, the same validation runs as in single-pass: `ProtocolSchema.safeParse`. Including `.refine()` — the cross-field invariant. **The cascade does not bypass schema rules.** If `headerRes` returned `INTERVENTIONAL` and `interventionsRes` returned an empty array — `safeParse` fails with `validationStatus: 'partial'`. That's the right behavior.

`modelId` in meta is written as `'cascade(gpt-4o-mini segmenter, claude-sonnet-4-6 sections)'` — so in SQLite and `results.json` it's clear which mode was used. When filtering logs: `WHERE model LIKE 'cascade%'`.

---

## VCR cache at the level of the whole cascade

Notice — in `extract/cascade.ts` `withVcrCache` wraps the **whole** function (segmenter + 4 section calls), not each call separately:

```ts
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
    const [outcomesRes, ...] = await Promise.all([...]);
    // ...
    return { assembled, tokensIn, tokensOut };
  },
);
```

Why one key for the whole cascade and not 5 separate ones:

- The eval harness runs the same fixture as a whole. If you cache each call separately — the keys get more complex, there's no benefit.
- When `PROMPT_VERSION` changes, ALL 5 calls invalidate together — it's impossible to get a divergence where the segmenter is from old cache and section extractors are new.
- `mode: 'cascade'` in the key separates the cascade cache from the single-pass cache for the same fixture. Otherwise they'd overwrite each other.

---

## Failure mode: the segmenter puts a criterion in `other`

This is the main and **unrecoverable** failure mode of the cascade. Concrete scenario:

A study with mixed text — after the eligibility block comes a paragraph "Patients who do not meet criteria A and B will be excluded from the extension phase." The segmenter classifies it as `other` (it's about design, not eligibility criteria in the formal sense). But it contains an exclusion criterion.

`EligibilityOnly` only gets `sections.eligibility`. This paragraph isn't there. The criterion won't be extracted.

Single-pass with the full text would have seen this information — at least with some chance. The cascade loses it **deterministically**.

This isn't a bug to fix. This is an **architectural trade-off**: the cascade sacrifices recall on edge cases for concentrated attention on normal ones. Run `pnpm eval` and `pnpm eval:cascade`, compare per-trial scores — where the cascade loses, it's usually this exact situation.

DECISIONS.md in the project documents this directly — it's part of the architectural surface, not a hidden defect.

---

## When not to do a cascade

Not every extraction task benefits. A cascade pays off when:

1. **One field is much longer than the others** (like eligibility in our case).
2. **The text is well-structured** into sections that the segmenter model can split.
3. **Token cost isn't critical** — eval runs are rare, prod traffic is small.

Don't do a cascade if:
- All fields are symmetric in complexity → no concentrated bottleneck.
- The text is poorly structured → the segmenter errs often → the `|| text` fallback triggers constantly → you pay for extra calls without benefit.
- The LLM natively supports long context well and single-pass quality is already >0.9 → the cascade adds more noise than it removes.

The practical rule: measure. If the cascade doesn't give +0.05 F1 on the key field — it's not worth it.

---

## Metadata and logging

```ts
const meta = {
  modelChoice: 'sonnet' as const,
  modelId: 'cascade(gpt-4o-mini segmenter, claude-sonnet-4-6 sections)',
  schemaVersion: SCHEMA_VERSION,
  promptVersion: PROMPT_VERSION,
  inputChars: text.length,
  latencyMs: Date.now() - started,
  tokensIn,   // ← sum of all 4 section calls
  tokensOut,
};
```

`tokensIn` and `tokensOut` are **aggregated** across all 4 section calls. The segmenter is **not** included (formally it's a different provider, separate billing — though in practice on a cache hit this doesn't matter). In SQLite this is one row with `model = 'cascade(...)'`.

For cost analysis: one cascade row ≈ 4-5 single-pass rows by call count, but `tokens_in` reflects the real total spend. Query to compare cost:

```sql
SELECT
  CASE WHEN model LIKE 'cascade%' THEN 'cascade' ELSE 'single-pass' END AS mode,
  AVG(tokens_in)  AS avg_tin,
  AVG(tokens_out) AS avg_tout,
  AVG(latency_ms) AS avg_lat
FROM extractions
WHERE per_field_scores IS NOT NULL
GROUP BY mode;
```

---

## What breaks if you don't do X

- **You don't narrow schemas (`OutcomesOnly` etc.).** The cascade loses its point — the model still tries to fill in the full `Protocol`, attention is split.
- **No `|| text` fallback.** One segmenter mishap = the field is empty in eval. Long hours of debugging in the wrong place.
- **You pass `sections.other` to `HeaderOnly` instead of full text.** Phase starts getting lost in ~20% of trials where the boilerplate went into other entirely.
- **The segmenter on Sonnet 4.6 instead of mini.** The cascade cost doubles without a quality improvement — the segmentation task doesn't need a frontier model.
- **You cache each call separately rather than the whole cascade.** Half of the cache invalidations stop being consistent — you get divergences between the segmenter and section extractors when bumping versions.
- **You don't write `'cascade(...)'` in `modelId`.** In SQLite you can't distinguish cascade runs from single-pass for comparison. Cost analysis breaks.

---

## Further reading

- [Vercel AI SDK generateText + Output.object](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text) — identical API for the segmenter and section calls
- [Sonnet 4.6 long-context](https://www.anthropic.com/claude/sonnet) — 1M tokens; the cascade still gives a lift on long lists because of attention concentration, not the context window
- [Lost-in-the-middle (Liu et al.)](https://arxiv.org/abs/2307.03172) — the original paper on attention degradation in long contexts
- [ClinicalTrials.gov API v2](https://clinicaltrials.gov/data-api/api) — structure of `protocolSection.descriptionModule.detailedDescription`
