# Clinical Trial Protocol Extractor

> Extract typed protocol fields from ClinicalTrials.gov free-text descriptions, score the result against the same trial's structured ground truth, and keep the regression timeline in git.

A reference implementation of structured extraction + eval methodology built on the Vercel AI SDK. All model traffic — Anthropic, OpenAI, and Google/Gemini — flows through Vercel AI Gateway (one `AI_GATEWAY_API_KEY`, no per-provider keys). Every meaningful prompt or schema change re-runs the eval harness and **appends** an entry to `evals/results.json`, so the regression history lives in `git diff` rather than a dashboard.

---

## What it does

1. **Fetch** a study from [ClinicalTrials.gov API v2](https://clinicaltrials.gov/data-api/api) (or load a committed fixture).
2. **Extract** a typed `Protocol` object — phase, study type, primary outcomes, eligibility criteria, interventions — by feeding the free-text "Detailed Description" through `generateText({ output: Output.object({ schema }) })` against a versioned Zod schema.
3. **Score** the extraction against the *same trial's* real structured fields (filled in by humans at registration). Per-field scoring uses exact match for enums and **F1 with Hungarian bipartite matching** at a 0.7 Levenshtein-similarity threshold for the list fields.
4. **Log** every LLM call to `logs/extractions.sqlite` (13 columns: ts, model, prompt version, schema version, validation status, latency, tokens, raw output, per-field scores).
5. **Append** each `pnpm eval` run to `evals/results.json` — never overwrites, so regressions show up in commit diffs.

The ground truth isn't synthetic, isn't model-generated, isn't hand-labeled. It's the same JSON the study sponsor entered at registration.

---

## Features

| Feature | Entrypoint | What it demonstrates |
|---------|------------|----------------------|
| **Structured extraction** | `POST /api/extract` | `generateText` + `Output.object({ schema })` + Zod schema with `.refine()` cross-field invariants |
| **Streaming extraction** | `POST /api/extract/stream` + UI Stream mode | `streamText` + `Output.object({ schema })` server-side, iterating `partialOutputStream`; client renders partial JSON as it generates |
| **Two-stage cascade** | `pnpm eval:cascade` | `gateway('openai/gpt-4o-mini')` segments the description into `outcomes / eligibility / interventions / other`, then four parallel section-scoped `generateText({ output: Output.object(...) })` calls assemble the final Protocol |
| **Tool-calling agent** | `/research` page | Multi-step `generateText` with `tools` (`listTrials`, `lookupTrial`), Zod `inputSchema` passed directly, `stopWhen: stepCountIs(5)` |
| **Semantic search (RAG)** | `/search` page + `pnpm build:index` | `text-embedding-3-small` over all 25 fixtures, cosine similarity, top-K retrieval |
| **LLM-as-judge scoring** | `pnpm eval:judge` | Claude Haiku 4.5 (via `gateway('anthropic/...')`) evaluates each extracted/gold pair as an alternative to Levenshtein-based F1 |
| **Per-field offline eval** | `pnpm eval` | 25 fixtures × per-field scorer → append-only `evals/results.json` |
| **VCR cache for eval reruns** | `pnpm eval:cached`, `pnpm eval:cascade:cached` | `lib/vcr.ts` hashes `(model, promptVersion, schemaVersion, input)` to `evals/cache/*.json`. Activated by `EVAL_VCR=1`. Second run over the same corpus is $0 |
| **SQLite call log** | `logs/extractions.sqlite` | Every LLM call rowed with full metadata for cost/latency/regression analysis |
| **Versioned schemas + prompts** | `SCHEMA_VERSION`, `PROMPT_VERSION` constants | Both written into every log row and every eval entry — and form part of the VCR cache key, so a prompt bump auto-invalidates cached answers |

---

## Quick start

```bash
pnpm install
cp .env.local.example .env.local
# Fill in AI_GATEWAY_API_KEY (required — the single key routes all traffic, incl. Gemini, via Vercel AI Gateway)

pnpm dev                # http://localhost:3000

pnpm test               # vitest — scorer unit tests
pnpm eval               # single-pass run over all 25 fixtures, append results
pnpm eval:cached        # same, but with EVAL_VCR=1 — second run on the same corpus is $0
pnpm eval:cascade       # two-stage cascade run
pnpm eval:cascade:cached # cascade + VCR cache
pnpm eval:judge         # LLM-as-judge scorer (limited to 3 fixtures by default — expensive)
pnpm build:index        # build embedding index for /search
```

The 25 ClinicalTrials.gov fixtures are committed under `fixtures/trials/`; nothing in the eval pipeline touches the network at runtime.

---

## Architecture

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
   (single-pass)                       (segment → 4× parallel)        │
            │                                   │                     │
            └─────────────────┬─────────────────┘                     │
                              ▼                                       │
                      extraction JSON                                 │
                              │                                       │
                              ▼                                       ▼
                      score/aggregate.ts ◄─────────────────────────────
                      (Hungarian F1 / exact / LLM-as-judge)
                              │
                              ▼
                      evals/results.json (append-only)
                              │
                              ▼
                      logs/extractions.sqlite (one row per LLM call)
                              │
                              ▼
                          UI render
```

Detailed write-up in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 App Router, React 19, Server Components |
| Language | TypeScript strict |
| Styling | Tailwind CSS + shadcn/ui (defaults, no custom design) |
| AI SDK | Vercel AI SDK (`ai@^6` — provides `gateway`, `Output.object`, `generateText`, `streamText`), `@ai-sdk/react`. All providers — Anthropic, OpenAI, and Google/Gemini — are reached through `gateway('anthropic/...')` / `gateway('openai/...')` / `gateway('google/...')` |
| Schema validation | Zod 4 |
| Primary model | Claude Sonnet 4.6 (`gateway('anthropic/claude-sonnet-4-6')`) |
| Segmenter | `gateway('openai/gpt-4o-mini')` |
| Judge model | Claude Haiku 4.5 (`gateway('anthropic/claude-haiku-4-5-20251001')`) |
| Comparison model | Gemini 2.5 Flash (`gateway('google/gemini-2.5-flash')`) — also routes through the gateway on the single `AI_GATEWAY_API_KEY` |
| Embeddings | OpenAI `text-embedding-3-small` |
| Observability | better-sqlite3 (one row per LLM call) |
| Fixtures | JSON files committed in repo |
| Deploy | Vercel free tier |

**Intentionally not used:** PostgreSQL, Redis, S3, queues, any test framework beyond `vitest` for scorers, any authentication.

---

## Eval methodology

### Per-field scoring

| Field | Score type | Formula |
|-------|-----------|---------|
| `phase` | exact | `1` if `==`, else `0` |
| `studyType` | exact | `1` if `==`, else `0` |
| `primaryOutcomes` | F1 (Hungarian) | bipartite match by `measure` similarity ≥ 0.7 |
| `eligibilityCriteria` | F1 (Hungarian) | bipartite match by `description` similarity ≥ 0.7 (with type lock) |
| `interventions` | F1 (Hungarian) | bipartite match by `(0.7·name + 0.3·type)` similarity ≥ 0.7 |

String similarity is a normalized Levenshtein ratio (`1 - distance / max(len)`) on lowercased, whitespace-collapsed strings. The 0.7 threshold and the per-field similarity weights are documented in [`evals/README.md`](./evals/README.md).

### Why Hungarian, not set overlap

Eligibility criteria are paraphrases: `"Age ≥ 18"` (extracted) and `"Adults eighteen years or older"` (gold) are the same criterion. Naive set overlap can match one gold entry against multiple extractions, inflating precision. Hungarian forces a one-to-one assignment, then the threshold drops weak pairs — the F1 is the count of survivors over the two list sizes.

### Two scorers

- **Default (`pnpm eval`)** — deterministic Levenshtein-based F1. Fast, cheap, predictable. Brittle on word reorderings.
- **Alternative (`pnpm eval:judge`)** — Claude Haiku scores each (extracted, gold) pair on a 0–1 scale, then the same Hungarian-style F1 aggregation runs over those scores. Slower and ~$0.01/trial, but handles paraphrases and word-order swaps naturally.

Run both, compare the diffs — that's the cleanest test of whether a regression is real or just a Levenshtein artifact.

### Append-only history

```bash
# What changed in the latest eval entry?
git diff HEAD~1 evals/results.json

# Which entries used a given prompt version?
jq '.[] | select(.promptVersion == "v1.0.0") | {runId, model, mode, aggregate}' evals/results.json
```

Schema of one entry: [`evals/README.md`](./evals/README.md).

---

## Project structure

```
clinical-trial-protocol-extractor/
├── app/
│   ├── page.tsx                          # main extractor UI (standard + stream modes)
│   ├── extractor.tsx                     # client component, useObject hook for streaming
│   ├── eval/page.tsx                     # eval results dashboard
│   ├── research/page.tsx                 # tool-calling research assistant
│   ├── search/page.tsx                   # semantic search
│   └── api/
│       ├── extract/route.ts              # POST: single-pass extraction via generateText + Output.object
│       ├── extract/stream/route.ts       # POST: streamText + Output.object, text-stream response
│       ├── research/route.ts             # POST: generateText with tools (listTrials, lookupTrial)
│       ├── search/route.ts               # POST: embedding-based top-K trial lookup
│       └── ground-truth/[nctId]/route.ts # GET: normalized fixture
│
├── schemas/v1/
│   └── protocol.ts                       # Protocol + Phase + StudyType + ... (SCHEMA_VERSION)
│
├── extract/
│   ├── prompt.ts                         # extractionSystemPrompt + PROMPT_VERSION
│   ├── extract.ts                        # extractProtocol() — single-pass
│   ├── segment.ts                        # gpt-4o-mini segmenter (Sections schema)
│   ├── cascade.ts                        # extractCascade() — 4× parallel section calls
│   └── log.ts                            # writes one row to logs/extractions.sqlite per call
│
├── score/
│   ├── exact.ts                          # enum scorer
│   ├── similarity.ts                     # normalized Levenshtein ratio
│   ├── list.ts                           # F1 with inline Hungarian assignment (~80 lines)
│   ├── aggregate.ts                      # scoreProtocol() — per-field combiner
│   ├── llm-judge.ts                      # alternative scorer: Claude Haiku as judge
│   └── __tests__/                        # vitest — exact, list, aggregate
│
├── ingest/
│   ├── fetch-trial.ts                    # GET /api/v2/studies/{id} with on-disk cache
│   ├── normalize.ts                      # raw API JSON → ground-truth Protocol shape
│   └── types.ts                          # permissive RawTrial type
│
├── lib/
│   ├── embeddings.ts                     # embed / embedMany / cosineSimilarity (text-embedding-3-small)
│   ├── fixtures.ts                       # fixture listing + read helpers
│   ├── vcr.ts                            # withVcrCache() — on-disk replay for eval reruns (EVAL_VCR=1)
│   └── eval-results.ts                   # read evals/results.json (used by /eval page)
│
├── evals/
│   ├── harness.ts                        # `pnpm eval` — --mode, --model, --scorer, --limit
│   ├── results.json                      # append-only run history
│   ├── cache/                            # VCR cache (gitignored — safe to delete)
│   └── README.md                         # schema of one entry + threshold sensitivity
│
├── fixtures/
│   ├── README.md                         # rationale per NCT — diversity / phase coverage
│   ├── trials/NCT*.json                  # 25 raw API responses + 25 .normalized.json
│   └── embeddings.json                   # built by `pnpm build:index` (gitignored)
│
├── logs/
│   └── extractions.sqlite                # gitignored — created by extract/log.ts
│
├── scripts/
│   ├── fetch-fixtures.ts                 # populate fixtures/trials/
│   ├── normalize-ground-truth.ts         # write *.normalized.json next to raw
│   └── build-embedding-index.ts          # write fixtures/embeddings.json
│
├── ARCHITECTURE.md                       # full system write-up
├── DECISIONS.md                          # three architectural calls, written out
└── README.md                             # this file
```

---

## Documentation

| Doc | What's in it |
|-----|--------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Stack, data flow, schemas, observability, every system-level decision |
| [DECISIONS.md](./DECISIONS.md) | Three architectural forks (cascade, Hungarian, versioned schemas) — written as "I chose X over Y because Z" |
| [evals/README.md](./evals/README.md) | Schema of one `results.json` entry + threshold-sensitivity notes |
| [fixtures/README.md](./fixtures/README.md) | The 25 NCT IDs with one-line rationale each |

---

## Deploy

```bash
gh repo create clinical-trial-protocol-extractor --public --source=. --push
vercel link
vercel env add AI_GATEWAY_API_KEY
vercel --prod
```

The eval harness, `pnpm test`, and the static fixtures don't need the runtime — only the `/api/*` routes do.

---

## License

MIT.
