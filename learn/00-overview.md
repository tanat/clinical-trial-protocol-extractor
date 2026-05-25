# Learning Map — Clinical Trial Protocol Extractor

If you're learning to build AI features in production, you quickly hit the same wall: tutorials end with "here's the model's response," and from there **real engineering** begins — types, contracts, evals, regressions, observability. This project is a training ground for exactly that part. Each stage isolates one pattern that getting-started guides don't explain.

A consensus has settled in the industry: structured outputs (via constrained decoding) are the **default way** to extract typed data from an LLM, while tool calling is reserved for agentic scenarios where the model itself decides what to invoke. Here we're doing extraction, so all the code is built around the typed schema-first pattern.

---

## What the project does, in one paragraph

You take a clinical trial NCT ID. You load its raw description from ClinicalTrials.gov (free-form medical text, 300-2000 words). You run it through an LLM → you get a typed `Protocol` object: phase, study type, primary outcomes, inclusion/exclusion criteria, interventions. You compare against the **real** structured data for the same trial (the sponsor filled it in at registration — that's the ground truth, not synthetic, not hand-labeled). You log every call into SQLite. You append aggregate metrics to `evals/results.json` — never overwriting. Regressions show up in `git diff`.

---

## Stack

| Layer | Choice | Why this specifically |
|------|---------|------------------|
| AI SDK | Vercel AI SDK (`ai@^6`) | A single API via `generateText({ output: Output.object({ schema }) })` over a Zod schema |
| Routing | `gateway('anthropic/claude-sonnet-4-6')` | All Anthropic+OpenAI calls go through the Vercel AI Gateway. One key `AI_GATEWAY_API_KEY`, no `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`. Google — directly via `@ai-sdk/google` (Google AI Studio free tier) |
| Model | Claude Sonnet 4.6 (extraction), gpt-4o-mini (segmenter), Haiku 4.5 (judge), Gemini 2.5 Flash (comparison) | Sonnet 4.6 — top-tier for long-context reasoning; mini models — for cheap, coarse work |
| Schema | Zod v4 | Zod describes the contract at runtime. The SDK generates JSON Schema, the provider constrained-decodes the response |
| Cache | VCR cache layer (`lib/vcr.ts`) | Eval runs over the same corpus shouldn't cost money a second time |
| Logs | SQLite (`better-sqlite3`, WAL) | One file, synchronous API, SQL for aggregations |
| Eval | Hungarian F1 + LLM-as-judge | Set overlap doesn't work for paraphrases, greedy inflates precision |

Note: structured extraction is done via `generateText({ output: Output.object({ schema }) })`, streaming — via `streamText({ output: Output.object({ schema }) })`. Access the result via `result.output`; in streaming you iterate `partialOutputStream`.

---

## Why these particular tasks

| Real-world pain | What the stage demonstrates |
|-----------------------|------------------------|
| `JSON.parse(content)` crashes on a markdown wrapper or a missing field | `generateText` + `Output.object({ schema })` + Zod as an **architectural contract**, not a convenience |
| The model loses attention on long criteria lists in one call | A two-stage cascade: segmenter on a mini model → 4 parallel section-scoped calls |
| "Works / doesn't work" is a meaningless metric for AI | Per-field eval with numbers: `eligibilityCriteria F1: 0.62` |
| `"Age ≥ 18 years"` vs `"Adults eighteen years or older"` — same or different? | Hungarian bipartite matching + LLM-as-judge over the same pairs |
| You rolled back the prompt without history — quality dropped invisibly | Append-only `results.json` + `PROMPT_VERSION` on every SQLite row |

---

## Stage map

| # | File | Main idea | Difficulty |
|---|------|---------------|-----------|
| 1 | `01-mental-model.md` | `generateText` + `Output.object` is a **type boundary**, not a convenient wrapper | Low |
| 2 | `02-schema-as-contract.md` | A Zod schema lives in three places: runtime, JSON Schema for the model, TS type | Medium |
| 3 | `03-cascade.md` | The cascade trades latency and cost so the model doesn't split its attention | Medium |
| 4 | `04-hungarian-scoring.md` | **Central exercise** — why Hungarian specifically, not set overlap or greedy | High |
| 5 | `05-observability.md` | SQLite per-call log + append-only `results.json` = reproducible regression history | Medium |

---

## Quick code orientation

```
schemas/v1/protocol.ts          ← Protocol + Phase + StudyType + ... + SCHEMA_VERSION
extract/prompt.ts               ← extractionSystemPrompt + PROMPT_VERSION
extract/extract.ts              ← extractProtocol() — single-pass generateText + Output.object + VCR
extract/segment.ts              ← gpt-4o-mini segmenter (Sections schema)
extract/cascade.ts              ← extractCascade() — segmenter + 4× parallel calls
extract/log.ts                  ← logExtraction() → logs/extractions.sqlite
lib/vcr.ts                      ← withVcrCache() — VCR-style replay for eval runs
score/similarity.ts             ← normalized Levenshtein ratio
score/list.ts                   ← scoreListF1() + inline Hungarian (~80 lines)
score/aggregate.ts              ← scoreProtocol() — per-field combiner
score/llm-judge.ts              ← judgeProtocol() — Claude Haiku 4.5 as judge
evals/harness.ts                ← pnpm eval, --mode, --model, --scorer, --limit
evals/results.json              ← append-only run history
fixtures/trials/                ← 25 NCT*.json + NCT*.normalized.json
```

Run `pnpm dev`, open the main page, paste any NCT ID. `Protocol` fields appear in a JSON tree as generation proceeds — that's `streamText({ output: Output.object(...) })` + `partialOutputStream` in Stream mode.

For eval: `pnpm eval` (fresh run, spends tokens) or `pnpm eval:cached` (VCR cache, second run is free).

---

## An analogy to keep in mind

Think of the pipeline as an ETL job with one strange property: the transformation step is non-deterministic and paid. Everything else follows from that.

- Since it's non-deterministic — you need **evals**, otherwise you can't compare changes.
- Since it's paid — you need a **cache** for repeated runs on the same input.
- Since it has side effects (cost, latency) — you need **logging** as an append-only journal.
- Since the contract is fragile — you need a **schema** at the boundary, otherwise the type "leaks" through all the code as `any`.

Every stage below is a tool for one of those four properties.

---

## Comparison with other projects

| Aspect | Project 01 (this) | Project 02 (Streaming Intake) |
|--------|-----------------|------------------------------|
| Main pattern | `generateText` + `Output.object` + offline eval | `streamText` + `Output.object` + partial-render safety |
| Schema | `Protocol` — 5 fields, nested arrays | `FormSpec` — discriminated union, 8 field types |
| Ground truth | Real ClinicalTrials.gov data | Hand-written expected fixtures |
| Scoring | Hungarian F1 + LLM-as-judge | Jaccard + critical field hit rate |
| Observability | SQLite per-call + append-only JSON | NDJSON event log |

Project 01 is about **extraction quality and measuring regressions**. Project 02 is about **UX streaming and render safety**.

---

## Further reading

- [generateText + Output.object reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text) — `output`, `result.output`, NoObjectGeneratedError, retry
- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — on Sonnet 4.6 thinking blocks are cached by default
- [Structured outputs in 2026 — overview](https://deepfounder.ai/structured-outputs-in-2026-how-to-make-llms-return-exactly-what-your-app-needs/) — why structured outputs ≠ tool use for extraction
- [ClinicalTrials.gov API v2](https://clinicaltrials.gov/data-api/api) — `GET /api/v2/studies/{NCT_ID}?format=json`
- [Hungarian algorithm](https://en.wikipedia.org/wiki/Hungarian_algorithm) — Kuhn 1955, Munkres 1957
