# Stage 2 — Schema as Contract

## Why factor the schema out as a separate artifact

When you write a regular API endpoint, the response schema exists **in three places at once**: in the TypeScript type, in the OpenAPI/JSON Schema for the client, in runtime validation. Usually that's three different files, and they drift — someone updated the TS type, didn't update the OpenAPI, the client broke.

In AI code the situation is worse: the schema is also needed by the **model**, and the model doesn't "see" it as code — it gets the JSON Schema through the provider API. If you keep the types in one place, the prompt schema in another, and the validator in a third — something is guaranteed to drift somewhere.

Zod gives you one source of truth for all four roles:

| Role | Who consumes | Where it comes from |
|------|----------------|--------------|
| TS type | Your code (UI, API, eval) | `z.infer<typeof Protocol>` |
| JSON Schema | The LLM provider (for constrained decoding) | The SDK converts Zod automatically |
| Runtime validation | After `generateText({ output: Output.object(...) })` | `Protocol.safeParse(raw)` |
| Documentation / contract | Another engineer reading the code | The `schemas/v1/protocol.ts` file itself |

Analogy: a schema is like a `.proto` file in the gRPC world, but without a separate codegen step. One file — and the types, the validator, and the contract with the model.

---

## The full Protocol schema

File: `schemas/v1/protocol.ts`

```ts
import { z } from 'zod';

export const SCHEMA_VERSION = 'v1.0.0' as const;

export const Phase = z.enum([
  'EARLY_PHASE_1', 'PHASE_1', 'PHASE_1_2', 'PHASE_2',
  'PHASE_2_3', 'PHASE_3', 'PHASE_4', 'NA',
]);

export const StudyType = z.enum(['INTERVENTIONAL', 'OBSERVATIONAL', 'EXPANDED_ACCESS']);

export const EligibilityType = z.enum(['INCLUSION', 'EXCLUSION']);
export const EligibilityCategory = z.enum(['DEMOGRAPHIC', 'MEDICAL', 'PROCEDURAL', 'OTHER']);

export const EligibilityItem = z.object({
  type: EligibilityType,
  description: z.string().min(3),
  category: EligibilityCategory.optional(),
});

export const PrimaryOutcome = z.object({
  measure: z.string().min(1),
  timeFrame: z.string().optional(),
  description: z.string().optional(),
});

export const InterventionType = z.enum(['DRUG', 'DEVICE', 'BEHAVIORAL', 'PROCEDURE', 'OTHER']);

export const Intervention = z.object({
  type: InterventionType,
  name: z.string().min(1),
  dosage: z.string().optional(),
});

export const Protocol = z
  .object({
    phase: Phase,
    studyType: StudyType,
    primaryOutcomes: z.array(PrimaryOutcome).min(1),
    eligibilityCriteria: z.array(EligibilityItem),
    interventions: z.array(Intervention),
  })
  .refine((p) => (p.studyType === 'INTERVENTIONAL' ? p.interventions.length > 0 : true), {
    message: 'Interventional studies must have at least one intervention',
    path: ['interventions'],
  });
```

All components are exported individually — not for cosmetics, but so the cascade can do `z.object({ primaryOutcomes: z.array(PrimaryOutcome) })` without copy-pasting definitions.

---

## `z.enum()` instead of `z.string()` — why this is critical

ClinicalTrials.gov returns phase as `["PHASE2"]`. The model sees "This is a Phase 2..." in the text and has to pick one of a closed set of values.

If you write `phase: z.string()`:
- The model will return `"Phase 2"`, `"phase II"`, `"2"`, `"PHASE 2"` — all different strings, one concept.
- In eval `extracted.phase === gold.phase` gives 0 for all three.
- SQLite stores unpredictable strings, aggregation is impossible.

If you write `phase: z.enum(['PHASE_2', ...])`:
- In JSON Schema this becomes `{ "enum": ["EARLY_PHASE_1", ...] }`.
- The provider (OpenAI, Anthropic, Google — all top 3 as of 2026) constrained-decodes the response: the model **physically cannot** generate a token leading outside the enum.
- The TypeScript type narrows to `'EARLY_PHASE_1' | 'PHASE_1' | ...` — the IDE autocompletes, an exhaustive switch is checked at compile time.

`'NA'` in the enum isn't "don't know." It's an **explicit value** for observational studies and trials without a phase. Without it, the model would hallucinate the nearest phase number ("probably Phase 1 since it's just starting"). A closed set plus an explicit escape hatch is the only reliable pattern.

| | `z.string()` | `z.enum(['PHASE_2', ...])` |
|---|---|---|
| What the model gets in JSON Schema | `{ "type": "string" }` | `{ "enum": ["EARLY_PHASE_1", ...] }` |
| What the model writes | `"Phase 2"`, `"phase II"` | `"PHASE_2"` |
| Exact match in eval against gold `"PHASE_2"` | 0 | 1 |
| TS type | `string` | union of 8 literals |

---

## Field by field

### `studyType: StudyType` — three values, not a free string

`EXPANDED_ACCESS` — only when the description literally says "compassionate use" or "expanded access." Without an explicit value in the enum, the model would confuse it with `OBSERVATIONAL` (both are not INTERVENTIONAL). The prompt nails this down directly: "EXPANDED_ACCESS only when the description literally says compassionate / expanded-access use."

This illustrates the principle: **enum values must cover all valid cases, including edge cases, otherwise the model will pick the semantically nearest one**, not the "correct" one.

### `primaryOutcomes: z.array(PrimaryOutcome).min(1)` — why `.min(1)`

A debatable constraint. Some studies don't name a primary outcome in the Detailed Description (it might be in another API module). `.min(1)` means an extraction with an empty array will fail `safeParse` → `validationStatus: 'partial'`.

This is **intentional**. We want the model to **search** for an outcome, not return an empty array at the slightest uncertainty. The prompt says: "if the description does not name a primary endpoint, return an empty array — do not invent one." Meanwhile, `.min(1)` catches such cases as `partial` — we get the signal "this extraction is incomplete" instead of silently accepting `[]` as a valid result.

Failure mode: if in your corpus the percentage of trials without a primary outcome > 30%, `.min(1)` will swamp metrics with a huge number of `partial`. In that case — drop `.min(1)`, add a separate metric "frac_with_outcome."

### `eligibilityCriteria: z.array(EligibilityItem)` — no `.min()`

The opposite here: studies without criteria in the Detailed Description are legitimate (they're in `eligibilityModule`). An empty array is a valid outcome.

`description: z.string().min(3)` — not `.min(1)`. A length of 3 characters filters out garbage like `{ type: 'INCLUSION', description: '-' }` that the model returns for bullet lists with no text.

`category: EligibilityCategory.optional()` — evaluating the category is harder than extracting the criterion. The prompt says "omit if unclear." `.optional()` makes the field optional in JSON Schema — the model doesn't have to invent a value.

`type` is NOT optional. INCLUSION vs EXCLUSION is a structural distinction; without it a criterion is meaningless. In scoring (`score/aggregate.ts`) this is used as a "type lock": INCLUSION can't match against EXCLUSION even on a perfect text match. More on this in stage 4.

### `interventions` — asymmetry between type and name

```ts
const Intervention = z.object({
  type: InterventionType,         // required
  name: z.string().min(1),         // required
  dosage: z.string().optional(),   // optional
});
```

Models often confuse `DRUG` and `OTHER` (for example, is "investigational compound" a DRUG or OTHER?). Scoring accounts for this: `0.7 * nameSim + 0.3 * typeBonus`. Name matters more than type. This is an explicit architectural choice: an error in the type is punished less than an error in the name.

`dosage` is optional — most observational studies don't have specific dosages; don't make required what's frequently absent in the source.

---

## `.refine()` — cross-field invariant

```ts
.refine(
  (p) => (p.studyType === 'INTERVENTIONAL' ? p.interventions.length > 0 : true),
  { message: 'Interventional studies must have at least one intervention',
    path: ['interventions'] },
)
```

JSON Schema can formally express this via `if/then/else`, but providers support it unevenly and the SDK doesn't use it. Zod `.refine()` is the only reliable path.

This is exactly the class of error the model regularly makes: it sees a randomized controlled trial, correctly classifies it as `INTERVENTIONAL`, but doesn't find a concrete drug name in the text and returns an empty `interventions`. Without `.refine()` such an extraction would pass as `'valid'`, even though it's semantically inconsistent.

An important point: `Output.object({ schema })` **doesn't know** about `.refine()`. The constrained decoding guarantees JSON shape, but not cross-field rules. So in `extract.ts` after a successful `generateText` we still do `Protocol.safeParse(raw)` (where `raw = result.output`) — that's where `.refine()` fires. The result is `validationStatus: 'partial'`.

The prompt duplicates the rule **in words**: "A study with studyType=INTERVENTIONAL must have at least one item in interventions. If you cannot find one, set studyType=OBSERVATIONAL." That's instruction for the model — we lower the percentage of `partial` at the source so `.refine()` catches the residual cases, not half the runs.

Failure mode without `.refine()`: production silently accepts contradictory extractions. A month later eval on a new prompt version shows the same numbers. Only when manually reviewing fixtures do you notice "half our interventional trials have no interventions."

---

## SCHEMA_VERSION — why version the schema

```ts
export const SCHEMA_VERSION = 'v1.0.0' as const;
```

This constant goes into every SQLite row:

```sql
schema_version TEXT NOT NULL  -- 'v1.0.0'
```

And into every `evals/results.json` entry:

```json
{ "schemaVersion": "v1.0.0", "promptVersion": "v1.0.0", ... }
```

Without versioning, the failure scenario is obvious: you add `sponsor: z.string().optional()` to Protocol. SQLite has 500 rows of `output_json` without that field. The query `SELECT json_extract(output_json, '$.sponsor') FROM extractions` returns `null` for half and an empty string for the other half. Unclear: did the model not find a sponsor, or was this row written before the field existed?

With versioning: `WHERE schema_version = 'v1.1.0'` — only rows after the change. Clean.

Harder case: you add `primaryOutcomes: z.array(PrimaryOutcome).min(1)` — rows with empty arrays are now unparseable against the new schema. `SCHEMA_VERSION` on the row indicates which schema applied at the time of writing, so you can pick the right parser.

A rule that's hard-coded in the project: **any Zod schema change is a new version**. The `schemas/v1/` schema is frozen. New schema → `schemas/v2/protocol.ts`. This is discipline, not automatic.

Failure mode without a version: migration 6 months later — you can't tell which rows correspond to which schema version. Eval run history becomes useless.

---

## The VCR cache uses the version as part of the key

The cache key in `lib/vcr.ts`:

```ts
sha256(model | promptVersion | schemaVersion | mode | sha256(text))
```

Bump `SCHEMA_VERSION` → new keys → the old cache is ignored. This is automatic invalidation: you change the schema and you know that a repeat eval will actually hit the model, not return stale cached objects.

---

## What breaks if you don't do X

- **You replaced `z.enum()` with `z.string()`.** The model returns different phrasings of the same value. Exact-match eval drops from 1.0 to 0.3 even though extraction quality didn't change. The metric is useless.
- **You omitted `.refine()`.** Contradictory extractions pile up silently. In the UI the user sees "INTERVENTIONAL trial, no interventions" — that's the signature of a bug in your system, not in the data.
- **You didn't bump `SCHEMA_VERSION` on change.** Old SQLite rows are now unparseable by the new schema but marked with the same version. `WHERE schema_version = current_version` mixes different formats. Eval reproducibility is broken.
- **You made `interventions` `z.array(Intervention).min(1)` globally.** All observational trials are now `partial`. The noise drowns real regressions.
- **You don't use `.optional()` for rare fields.** The model is forced to invent a value that isn't in the text. `category: 'OTHER'` starts appearing for all criteria — because it's easier for the model to put a placeholder than to violate required.

---

## streamText + Output.object requires a softer schema

A small note on the streaming route (`app/api/extract/stream/route.ts`): there the same object is streamed via `streamText({ output: Output.object({ schema: ProtocolStream }) })`, and the schema **must** be softer. Partial objects in a stream physically cannot satisfy `.refine()` or `.min(1)` — half the fields just aren't there yet. The pattern: one "strict" schema `Protocol` for final validation, one "soft" `ProtocolStream` (no `.refine()`, no `.min(1)`) for the generation itself. The client iterates `partialOutputStream` and validates against the strict schema only for the final object.

---

## Further reading

- [Zod docs](https://zod.dev) — `.refine()`, `z.enum()`, `z.array().min()`, optional fields
- [Vercel AI SDK generateText + Output.object](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text) — how Zod → JSON Schema for the model
- [Structured outputs guide 2026](https://www.buildmvpfast.com/blog/structured-output-llm-json-mode-function-calling-production-guide-2026) — constrained decoding and enum/refine support across providers
- [AI SDK streamText + Output.object](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text) — `partialOutputStream`, why the streaming schema must be softer
