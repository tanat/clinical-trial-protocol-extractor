# Architecture — Clinical Trial Protocol Extractor

> Technical decisions and their rationale. This file is living; update it as reality kicks the initial assumptions into shape.

---

## Stack

| Layer | Technology | Version / comment |
|-------|------------|----------------------|
| Framework | Next.js App Router | Next 16, React 19, Server Components |
| Language | TypeScript strict | `"strict": true` mandatory |
| Styling | Tailwind CSS + shadcn/ui | No custom designs |
| AI SDK | Vercel AI SDK | `ai@^6` (provides `gateway`, `Output.object`, `generateText`, `streamText`), `@ai-sdk/react@^3`. All providers — Anthropic, OpenAI, and Google/Gemini — are routed through `gateway()` |
| Schema validation | Zod 4 | discriminated unions, `.refine()` for cross-field invariants |
| Primary model | Claude Sonnet 4.6 | `gateway('anthropic/claude-sonnet-4-6')` |
| Segmenter | OpenAI `gpt-4o-mini` | `gateway('openai/gpt-4o-mini')` — cheap coarse routing for cascade mode |
| Judge model | Claude Haiku 4.5 | `gateway('anthropic/claude-haiku-4-5-20251001')` — LLM-as-judge scorer |
| Comparison model | Gemini 2.5 Flash | `gateway('google/gemini-2.5-flash')` — also routes through the gateway on the single `AI_GATEWAY_API_KEY` |
| Embeddings | OpenAI `text-embedding-3-small` | semantic search index |
| VCR cache | `lib/vcr.ts` | hash-keyed on-disk replay for eval reruns, gated by `EVAL_VCR=1` |
| Observability log | better-sqlite3 | one row per LLM call |
| Fixtures storage | JSON files | committed in `fixtures/trials/` |
| Deploy | Vercel free tier | env: `AI_GATEWAY_API_KEY` (required — single key covers all providers) |

**Intentionally not used:** PostgreSQL, Redis, S3, queues, any test framework beyond `vitest` for scorer tests, any authentication.

---

## Data source

ClinicalTrials.gov API v2:

```
GET https://clinicaltrials.gov/api/v2/studies/{NCT_ID}?format=json
```

Returns a single JSON. Fields we care about:

| Path | What it is | Used as |
|------|------------|------------------|
| `protocolSection.descriptionModule.detailedDescription` | Free text | **Input** for extraction |
| `protocolSection.designModule.phases` | Array of phase enum | Ground truth |
| `protocolSection.designModule.studyType` | Enum | Ground truth |
| `protocolSection.outcomesModule.primaryOutcomes` | Array of objects | Ground truth |
| `protocolSection.eligibilityModule.eligibilityCriteria` | Text "Inclusion: … Exclusion: …" | Ground truth (requires parsing) |
| `protocolSection.armsInterventionsModule.interventions` | Array of objects | Ground truth |

Ground-truth fields need some normalization before comparison — most notably `eligibilityCriteria`, which arrives as a single text blob and must be parsed into individual criteria. That's `scripts/normalize-ground-truth.ts`, which writes `{NCT_ID}.normalized.json` next to each raw response.

---

## Data flow

```
                    ClinicalTrials.gov API v2
                              │ (one-time fetch)
                              ▼
                  ingest/fetch-trial.ts ──── fixtures/trials/{NCT_ID}.json
                                                  │
                              ┌───────────────────┴───────────────────┐
                              ▼                                       ▼
                  Detailed Description                    Ground truth fields
                              │                                       │
            ┌─────────────────┴─────────────────┐                     │
            ▼                                   ▼                     │
   extract/extract.ts                  extract/cascade.ts             │
   (single-pass)                       (segment + 4× parallel)        │
            │                                   │                     │
            └─────────────────┬─────────────────┘                     │
                              ▼                                       │
                      extraction JSON                                 │
                              │                                       │
                              ▼                                       ▼
                      score/aggregate.ts ◄─────────────────────────────
                      (exact + Hungarian F1)
                              │
                              ▼
                      evals/results.json (append-only)
                              │
                              ▼
                      logs/extractions.sqlite (one row per LLM call)
```

For the UI flow, three additional surfaces hang off the same data:

- **`/api/extract/stream`** — `streamText({ output: Output.object({ schema }) })` server-side; the client iterates `partialOutputStream` and the JSON tree renders partial fields as they're generated.
- **`/research`** — `generateText` with `tools: { listTrials, lookupTrial }` (Zod schemas passed straight into `inputSchema`) and `stopWhen: stepCountIs(5)`; the agent decides which fixtures to look up and answers from their structured form.
- **`/search`** — semantic search over `fixtures/embeddings.json` (pre-computed `text-embedding-3-small` embeddings + cosine similarity).

---

## Repo structure

```
clinical-trial-protocol-extractor/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                          # main extractor UI
│   ├── extractor.tsx                     # client component (standard + stream modes)
│   ├── eval/page.tsx                     # eval results dashboard
│   ├── eval/trial-breakdown.tsx          # per-trial diff component
│   ├── research/page.tsx                 # tool-calling research assistant
│   ├── search/page.tsx                   # semantic search
│   └── api/
│       ├── extract/route.ts              # POST → single-pass generateText + Output.object
│       ├── extract/stream/route.ts       # POST → streamText + Output.object (text stream)
│       ├── research/route.ts             # POST → generateText with tools
│       ├── search/route.ts               # POST → embedding lookup
│       └── ground-truth/[nctId]/route.ts # GET → normalized fixture
│
├── schemas/v1/
│   └── protocol.ts                       # Protocol + Phase + StudyType + EligibilityItem + ... + SCHEMA_VERSION
│
├── ingest/
│   ├── fetch-trial.ts                    # GET /api/v2/studies/{id}, caches to disk
│   ├── normalize.ts                      # raw API JSON → Protocol ground truth
│   └── types.ts                          # permissive RawTrial type
│
├── fixtures/
│   ├── README.md                         # rationale per NCT
│   └── trials/
│       ├── NCT*.json                     # 25 raw API responses (committed)
│       └── NCT*.normalized.json          # 25 normalized ground-truth shapes
│
├── extract/
│   ├── prompt.ts                         # extractionSystemPrompt + PROMPT_VERSION
│   ├── extract.ts                        # extractProtocol() — single-pass
│   ├── segment.ts                        # gpt-4o-mini segmenter (Sections schema)
│   ├── cascade.ts                        # extractCascade() — 4× parallel section calls
│   └── log.ts                            # writes to logs/extractions.sqlite
│
├── score/
│   ├── exact.ts                          # enum scorer
│   ├── similarity.ts                     # normalized Levenshtein ratio
│   ├── list.ts                           # F1 with inline Hungarian assignment
│   ├── aggregate.ts                      # scoreProtocol() per-field combiner
│   ├── llm-judge.ts                      # alternative scorer using Claude Haiku
│   └── __tests__/                        # vitest — exact, list, aggregate
│
├── lib/
│   ├── embeddings.ts                     # embed / embedMany / cosineSimilarity
│   ├── fixtures.ts                       # fixture listing / read helpers
│   ├── vcr.ts                            # withVcrCache() — on-disk eval replay, EVAL_VCR=1
│   ├── eval-results.ts                   # read evals/results.json
│   └── utils.ts                          # cn() classnames helper
│
├── evals/
│   ├── harness.ts                        # pnpm eval — --mode, --model, --scorer, --limit
│   ├── results.json                      # append-only run history
│   ├── cache/                            # VCR cache files (gitignored)
│   └── README.md                         # entry schema + threshold sensitivity
│
├── logs/
│   └── extractions.sqlite                # gitignored, created by extract/log.ts
│
├── scripts/
│   ├── fetch-fixtures.ts                 # populate fixtures/trials/
│   ├── normalize-ground-truth.ts         # write *.normalized.json
│   └── build-embedding-index.ts          # write fixtures/embeddings.json
│
├── ARCHITECTURE.md                       # this file
├── DECISIONS.md                          # three architectural calls
└── README.md                             # entrypoint
```

---

## Schemas (v1)

```ts
// schemas/v1/protocol.ts
import { z } from 'zod';

export const SCHEMA_VERSION = 'v1.0.0' as const;

export const Phase = z.enum([
  'EARLY_PHASE_1', 'PHASE_1', 'PHASE_1_2', 'PHASE_2',
  'PHASE_2_3', 'PHASE_3', 'PHASE_4', 'NA',
]);

export const StudyType = z.enum([
  'INTERVENTIONAL', 'OBSERVATIONAL', 'EXPANDED_ACCESS',
]);

export const EligibilityItem = z.object({
  type: z.enum(['INCLUSION', 'EXCLUSION']),
  description: z.string().min(3),
  category: z.enum(['DEMOGRAPHIC', 'MEDICAL', 'PROCEDURAL', 'OTHER']).optional(),
});

export const PrimaryOutcome = z.object({
  measure: z.string(),
  timeFrame: z.string().optional(),
  description: z.string().optional(),
});

export const Intervention = z.object({
  type: z.enum(['DRUG', 'DEVICE', 'BEHAVIORAL', 'PROCEDURE', 'OTHER']),
  name: z.string(),
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
  .refine(
    (p) => (p.studyType === 'INTERVENTIONAL' ? p.interventions.length > 0 : true),
    { message: 'Interventional studies must have at least one intervention' },
  );
```

`.refine()` catches the cross-field invariants the model loves to break (`INTERVENTIONAL` with no interventions is a classic hallucination).

### A separate `ProtocolStream` for streaming

The stream route (`app/api/extract/stream/route.ts`) defines a parallel schema without `.refine()` and without `.min(1)` on `primaryOutcomes`. Partial objects in flight from `streamText({ output: Output.object(...) })` (consumed on the client via `partialOutputStream`) can't satisfy cross-field invariants or array-length constraints, so the streaming schema is strictly looser. The full `Protocol.safeParse()` runs on the final object on the client only after streaming completes.

---

## Extraction modes

### Single-pass (`extract/extract.ts`)

One `generateText({ output: Output.object({ schema: Protocol }) })` call against the full `Protocol` schema. The Zod schema is converted to JSON Schema by `Output.object` and used both as the constrained-generation grammar on the model side and as the validation layer on the application side (`safeParse` on `result.output`). The whole call is wrapped in `withVcrCache(...)` so that on `EVAL_VCR=1` reruns the same input + version pair returns at $0 / ~0 ms.

Three result states the harness handles:

```
generateText({ output: Output.object(...) })
        ──► success  → raw = result.output
        ──► NoObjectGeneratedError → model returned malformed JSON
                                     (status: 'invalid')

Protocol.safeParse(raw)
  ├── success: true  → status: 'valid'    ✅
  └── success: false → status: 'partial'  ⚠️  (JSON shape OK, .refine() failed)
```

### Two-stage cascade (`extract/cascade.ts`)

```
text ─► segmentDescription (gateway('openai/gpt-4o-mini'))
        └─► { outcomes, eligibility, interventions, other }
                                │
                                ▼
        Promise.all([
          generateText({ output: Output.object({ schema: OutcomesOnly }),      prompt: sections.outcomes      || text }),
          generateText({ output: Output.object({ schema: EligibilityOnly }),   prompt: sections.eligibility   || text }),
          generateText({ output: Output.object({ schema: InterventionsOnly }), prompt: sections.interventions || text }),
          generateText({ output: Output.object({ schema: HeaderOnly }),        prompt: text }),  // full text, not sections.other
        ])
                                │
                                ▼
        assemble into Protocol → safeParse
```

All five calls (segmenter + four section extractors) are wrapped in a single `withVcrCache` boundary keyed by `mode: 'cascade'` — that way a rerun replays the assembled output atomically, never a half-segmenter / half-section mix.

The segmenter copies spans verbatim (no paraphrasing) and assigns each character of the source to exactly one bucket. Section-scoped schemas are strict subsets of the full `Protocol`. `HeaderOnly` (phase + studyType) gets the full original text because trial phase is almost always stated in the first-paragraph boilerplate the segmenter would file under `other`.

Five LLM calls per trial vs. one for single-pass; latency ≈ slowest single call thanks to `Promise.all`.

### Streaming (`app/api/extract/stream/route.ts` + Stream mode toggle)

```
client                                        server
──────                                        ──────
fetch POST /api/extract/stream             ── streamText({ output: Output.object({ schema: ProtocolStream }), ... })
   │                                                       │
   │ ◄────────── text-stream chunks  ─────────────────────┘
   │   client iterates partialOutputStream
   │   (each emit: DeepPartial<Protocol> rebuilt incrementally)
   │
   ▼
JsonTree re-renders on every chunk
```

`streamText` returns via `result.toTextStreamResponse()` and the client consumes `partialOutputStream`. Schema validation runs on the final object, not on partials.

---

## Eval rubric

### Per-field scoring (default: `pnpm eval`)

| Field | Score type | Formula |
|-------|------------|---------|
| `phase` | exact | `1` if `==`, else `0` |
| `studyType` | exact | `1` if `==`, else `0` |
| `primaryOutcomes` | F1 (Hungarian) | bipartite match by `measure` similarity ≥ 0.7 |
| `eligibilityCriteria` | F1 (Hungarian) | bipartite match by `description` similarity ≥ 0.7 (type lock: INCLUSION vs EXCLUSION must match) |
| `interventions` | F1 (Hungarian) | bipartite match by `0.7·name + 0.3·type` similarity ≥ 0.7 |

String similarity = `1 - levenshtein(a, b) / max(len(a), len(b))` after lowercasing and whitespace-collapse.

The Hungarian routine is ~80 lines of inline code in `score/list.ts` — no `munkres-js` dependency, since the bipartite sizes never exceed low tens. Both `precision` and `recall` come out of the matched-count over the two list sizes; F1 is the harmonic mean.

### Alternative: LLM-as-judge (`pnpm eval:judge`)

```
for each (extracted_item, gold_item):
   score = (await generateText({
     model: gateway('anthropic/claude-haiku-4-5-20251001'),
     output: Output.object({ schema: { score: 0..1, reason: string } }),
     prompt: "Does the extracted ${field} match the ground truth? …"
   })).output.score

then run the same Hungarian-style greedy matching over score ≥ 0.5
```

Slower (≈n×m Haiku calls per list field) and ~$0.01/trial, but handles paraphrases and word-order swaps naturally. The harness writes the `scorer` flag into every row so `levenshtein` and `llm` runs can be diff-ed in `results.json`.

### Aggregate

For v1, each per-field aggregate is the simple mean of that field's score across `perTrial` entries with `ok: true`. Failed extractions surface in `perTrial` with `ok: false` and an `error` message; they're excluded from the means. If we move to a weighted aggregate later, [`evals/README.md`](./evals/README.md) is where it gets documented.

---

## Tool use — research assistant

`app/api/research/route.ts` wires `generateText` with two tools:

```ts
tools: {
  listTrials:  tool({ inputSchema: z.object({ _placeholder: z.string().optional() }),
                      execute: async () => /* read fixtures dir */ }),
  lookupTrial: tool({ inputSchema: z.object({ nctId: z.string() }),
                      execute: async ({ nctId }) => /* fetchTrial + normalizeProtocol */ }),
},
stopWhen: stepCountIs(5),
```

Zod schemas are passed directly as `inputSchema`; the loop terminator is `stopWhen: stepCountIs(N)`.

The route returns `result.text` plus a flattened list of every tool call (`s.toolCalls` across `result.steps`), so the UI can show *which* fixtures the agent consulted.

---

## Semantic search — RAG

`scripts/build-embedding-index.ts` runs `embedMany({ model: text-embedding-3-small, values: [...] })` once over the 25 fixture descriptions and writes `fixtures/embeddings.json` (`Record<NCT_ID, { title, embedding: number[] }>`). The index is gitignored — it's ~1.5 MB and regenerable.

`/api/search` embeds the user query at request time, then computes cosine similarity against all stored embeddings (pure JS, no vector DB — the corpus is small enough that brute-force is faster than any index overhead). Returns top-K with `{ nctId, title, similarity }`.

---

## Architectural decisions

The three calls below also live in [DECISIONS.md](./DECISIONS.md) — copied here for self-contained reading.

### 1. Two-stage cascade vs single-pass extraction

Ship single-pass first; add cascade as an opt-in mode behind `pnpm eval:cascade`. The single-pass baseline is what makes "does cascade help?" answerable. Cascade should win on eligibility recall because that's the field where single-pass spreads its attention budget thinnest. The 25-fixture eval is the referee.

Cost: 5 LLM calls per trial vs 1, and a new failure mode where the segmenter mis-routes an eligibility sentence into `other`. The segmenter is on `gpt-4o-mini` (cheap routing) and only the section extractors are on Sonnet.

### 2. Hungarian assignment vs set overlap for list F1

Bipartite one-to-one matching with a similarity threshold, instead of greedy nearest-neighbour. Set overlap inflates precision by letting one ground-truth criterion match every nearby extraction. Hungarian forces uniqueness; the threshold drops weak pairs.

Cost: ~80 lines of inline Hungarian (no `munkres-js`) and a hyperparameter (the threshold). Locked at 0.7 — the floor where the close-paraphrase unit test still passes; documented in `evals/README.md`. Levenshtein is brittle on word reorderings; the LLM-as-judge scorer exists partly to cross-check those cases.

### 3. Versioned schemas + pinned prompts

`SCHEMA_VERSION` and `PROMPT_VERSION` go into every SQLite row and every `results.json` entry. New prompt = new version, even for a typo. `schemas/v1/` is frozen; if the schema needs to change, copy to `v2/` and pin the new prompt to it.

Cost: migration overhead on every change. The benefit is that `git diff evals/results.json` is the regression timeline, and any old SQLite log row stays interpretable with the schema version it points to.

---

## Observability

`logs/extractions.sqlite`:

```sql
CREATE TABLE IF NOT EXISTS extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,                    -- ISO 8601
  trial_id TEXT,                       -- NCT ID, NULL for ad-hoc input
  schema_version TEXT NOT NULL,        -- e.g. 'v1.0.0'
  prompt_version TEXT NOT NULL,        -- e.g. 'v1.2.0'
  model TEXT NOT NULL,                 -- e.g. 'claude-sonnet-4-6' or 'cascade(...)'
  input_chars INTEGER NOT NULL,
  output_json TEXT NOT NULL,           -- raw extraction
  validation_status TEXT NOT NULL,     -- 'valid' | 'invalid' | 'partial'
  validation_errors TEXT,              -- JSON array, NULL if valid
  per_field_scores TEXT,               -- JSON, NULL if no ground truth
  latency_ms INTEGER NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL
);

CREATE INDEX idx_extractions_trial ON extractions(trial_id);
CREATE INDEX idx_extractions_prompt ON extractions(prompt_version);
CREATE INDEX idx_extractions_ts ON extractions(ts);
```

Logging is wrapped in `try/catch` inside `extract/log.ts` — a failure to insert a row must never break the extraction itself. The eval harness sets `log: false` on its inner `extractProtocol` call so the row it writes carries `per_field_scores` (the inner call has no ground truth to score against).

**Questions these 13 columns answer:**

- Systematically weak fields → bottom deciles of `per_field_scores` for a given key
- Regression timeline → group by `prompt_version`
- Cost-vs-quality → `tokens_in × price`, `tokens_out × price`
- Latency-vs-input-length → scatter of `latency_ms` against `input_chars`

`evals/results.json` — append-only, one object per `pnpm eval` run. Schema in [`evals/README.md`](./evals/README.md). Every meaningful prompt or schema change re-runs the harness and commits the new entry in the same change. Regressions are visible in the commit diff.

---

## Provider routing — `gateway()` for every provider

All model traffic — Anthropic, OpenAI, and Google/Gemini — is routed through Vercel AI Gateway:

```ts
import { gateway } from 'ai';
gateway('anthropic/claude-sonnet-4-6')
gateway('openai/gpt-4o-mini')
gateway('anthropic/claude-haiku-4-5-20251001')
gateway('google/gemini-2.5-flash')
```

Practical consequences:

- One env var (`AI_GATEWAY_API_KEY`) instead of one per provider — the single key covers every provider, including Gemini.
- `gateway()` ships in `ai@^6`; no per-provider packages are needed (no `@ai-sdk/google`, no direct `google('…')`).
- Gateway adds per-request observability, model fallback, and a single billing surface; the key is required because this project doesn't fall back to direct provider SDKs.
- `GOOGLE_GENERATIVE_AI_API_KEY` is **not** needed — Gemini also routes through the gateway on `AI_GATEWAY_API_KEY`.

---

## VCR cache (`lib/vcr.ts`)

A small ~60-line wrapper that caches `(object, tokensIn, tokensOut)` tuples on disk under `evals/cache/<sha256>.json`. Gated by `EVAL_VCR=1` — the live app never sets it. Key layout:

```
sha256(model | promptVersion | schemaVersion | mode | sha256(inputText))
```

Bumping `PROMPT_VERSION` or `SCHEMA_VERSION` auto-invalidates the cache. Both `extract/extract.ts` (single-pass) and `extract/cascade.ts` (whole 5-call cascade) wrap their LLM work in `withVcrCache(...)`. `pnpm eval:cached` and `pnpm eval:cascade:cached` set the env var.

When VCR is the right tool, and when not: see the header comment in `lib/vcr.ts`. Short version — it's fine for deterministic extraction over a fixed corpus, wrong for streaming time-to-first-field measurements, and dangerous for agent loops with drifting tool results.
