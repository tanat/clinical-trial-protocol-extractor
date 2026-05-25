# Stage 1 — Mental Model: `generateText` + `Output.object` as a Type Boundary

## Why have a separate API at all

The most common antipattern in AI code is "prompt, then JSON.parse, then hope":

```ts
const response = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: `Extract protocol as JSON:\n\n${text}` }],
});
const data = JSON.parse(response.choices[0].message.content ?? '{}');
// data: any  ← this is where the pain begins
```

That line works in a tutorial and breaks in production. Specifically, it breaks three ways:

1. **Markdown wrapper.** The model returns ` ```json\n{...}\n``` ` — `JSON.parse` throws `SyntaxError` on the first backtick. After the first incident, `content.replace(/```json\n?/g, '').replace(/```/g, '')` appears in the code — a sure sign the architecture didn't survive contact with reality.

2. **Enum value drift.** The `phase` field comes in today as `"PHASE_2"`, tomorrow as `"Phase 2"`, the day after as `"phase II"`. If you compare `extracted.phase === gold.phase` — three variants, three zeros in eval.

3. **Missing field.** The model decides `interventions` is "obvious from context" and doesn't include the array at all. Then `undefined.length` crashes the UI component.

This isn't bad luck. This is the **physics of free-form LLM output**: the probability that the model gets distracted on the next token is non-zero at every step.

`generateText({ output: Output.object({ schema }) })` doesn't solve "the parsing problem." It shifts the **type boundary**: before the call you have `string`, after the call — `Protocol`. We pay the full cost of non-determinism at that one point, and after that we live in a typed world.

Analogy: a Zod schema is like a TypeScript type, but it lives at runtime and **tells the model** what's expected of it. Not as "please return JSON with a phase field" in the prompt text, but as JSON Schema in the provider's `response_format`, which the provider uses for constrained decoding at the token level.

---

## What `generateText` + `Output.object` actually does

The canonical way to do structured extraction is `generateText` with `output: Output.object({ schema })`. A single `generateText` covers plain text, tool calling, and structured output through one API.

File: `extract/extract.ts` (simplified — the real code is wrapped in a VCR cache, we'll come back to it):

```ts
import { generateText, Output, NoObjectGeneratedError, gateway } from 'ai';
import { Protocol } from '@/schemas/v1/protocol';

const result = await generateText({
  model: gateway('anthropic/claude-sonnet-4-6'),       // gateway() routes the call through Vercel AI Gateway
  output: Output.object({ schema: Protocol }),         // Zod schema, wrapped in Output.object
  system: extractionSystemPrompt,
  prompt: text,
});
const raw = result.output;   // guaranteed to have passed Zod validation
```

What the SDK does behind the scenes, step by step:

1. **Zod → JSON Schema.** The `Protocol` schema is converted to JSON Schema and passed to the provider through the native structured-output API (Anthropic → `tools` with `input_schema`, OpenAI → `response_format: { type: 'json_schema' }`). In all top providers as of 2026, this mode uses constrained decoding — the model **physically cannot** sample a token that leads to invalid JSON. This is stronger than "a request in the prompt."

2. **Retry with feedback.** If the response still doesn't parse with Zod (for example, due to `.refine()` — the provider doesn't know about cross-field invariants), the SDK retries up to 3 times, passing the validation error back to the model as context.

3. **`NoObjectGeneratedError`.** If after retries the object is still invalid — the SDK throws a specific error with `err.object` (the last attempt) and `err.text` (the raw text). This isn't a generic `Error` — you have everything you need to diagnose.

`result.output` is typed as `z.infer<typeof Protocol>`. Not `unknown`. Not `any`. That's the contract.

---

## `gateway()` — why, and why a single entry point for Anthropic/OpenAI

The `gateway('anthropic/claude-sonnet-4-6')` wrapper routes all Anthropic and OpenAI calls through Vercel AI Gateway. What this gets you:

- **One key — `AI_GATEWAY_API_KEY`** — instead of separate `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`. One billing account, one place to rotate keys.
- **Infrastructure layer:** Gateway adds load balancing, fallbacks, OpenTelemetry tracing — everything you'd otherwise wire up Sentry-style yourself.
- **Change the model — change a string.** `gateway('anthropic/...')` → `gateway('openai/...')` with no other code changes.

Google stays direct via `@ai-sdk/google` because we use Gemini 2.5 Flash on the Google AI Studio free tier (same provider, but Gateway doesn't proxy it). So in the code you see:

```ts
gateway('anthropic/claude-sonnet-4-6')           // Sonnet — through Gateway
gateway('openai/gpt-4o-mini')                    // gpt-4o-mini — through Gateway
gateway('anthropic/claude-haiku-4-5-20251001')   // judge — through Gateway
google('gemini-2.5-flash')                       // Gemini — direct, free tier
```

`GOOGLE_GENERATIVE_AI_API_KEY` is only required if you actually pick Gemini in the model picker — without it the rest of the project works fine.

---

## What happens on failure

```ts
try {
  const result = await generateText({
    model: m,
    output: Output.object({ schema: Protocol }),
    system: extractionSystemPrompt,
    prompt: text,
  });
  raw = result.output;
} catch (err) {
  if (NoObjectGeneratedError.isInstance(err)) {
    const usage = err.usage;
    tokensIn = usage?.inputTokens ?? null;
    tokensOut = usage?.outputTokens ?? null;
    raw = (err as { object?: unknown }).object
       ?? (err as { text?: string }).text
       ?? null;
    const result: ExtractionResult = {
      extraction: raw,
      validationStatus: 'invalid',
      validationErrors: [{ path: '(model)', message: err.message }],
      // ...
    };
    maybeLog(result, opts);
    return result;
  }
  throw err;
}
```

A few non-obvious things here:

- **`NoObjectGeneratedError.isInstance(err)`** — a static method, not `instanceof`. The reason: cross-bundler edge cases (Next.js may load the SDK in multiple contexts, `instanceof` breaks).
- **`err.usage`** — tokens are counted **even on failure**. We log them because they cost money.
- **`err.object ?? err.text`** — fallback chain: if there was partial JSON, we take it; otherwise raw text. This goes into `extraction` and gets written into SQLite — more useful for debugging than `null`.
- Any other `err` (a network error, for example) is rethrown. We only catch the class of errors the SDK specifically designed for us.

---

## Why `safeParse` after `generateText({ output })`

```ts
const parsed = Protocol.safeParse(raw);
```

A reasonable question: the SDK already guaranteed the schema through constrained decoding and retry. Why parse again?

Because of `.refine()`. JSON Schema can't express `if studyType === 'INTERVENTIONAL' then interventions.length > 0`. Constrained decoding doesn't know about this rule. The SDK's retry won't catch it either — it only looks at the JSON Schema, not at `.refine()`.

So after `generateText` we run the result through the **full** Zod parser. One of three outcomes:

```
generateText({ output: Output.object(...) })
   ──► success  → raw = result.output
   ──► NoObjectGeneratedError → validationStatus: 'invalid'

Protocol.safeParse(raw)
  ├── success: true  → validationStatus: 'valid'
  └── success: false → validationStatus: 'partial'  ← JSON OK, .refine() failed
```

The `partial` state is not formally "broken." It's "JSON shape is right, but it's semantically inconsistent." For example, the model returned an `INTERVENTIONAL` study with an empty `interventions[]`. The eval harness logs `validationStatus` on every SQLite row so you can count "what percent of partials we get on the new prompt version."

---

## VCR cache — why it's wrapped exactly here

In the project, `generateText` is wrapped in `withVcrCache` (file `lib/vcr.ts`):

```ts
const { value: cached } = await withVcrCache(
  {
    model: MODEL_IDS[choice],
    promptVersion: PROMPT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    fingerprint: fingerprintInput(text),
    mode: 'single',
  },
  async () => {
    const result = await generateText({
      model: m,
      output: Output.object({ schema: Protocol }),
      system: extractionSystemPrompt,
      prompt: text,
    });
    return {
      object: result.output,
      tokensIn: result.usage.inputTokens ?? null,
      tokensOut: result.usage.outputTokens ?? null,
    };
  },
);
```

The idea: when `EVAL_VCR=1` (the harness sets it via `pnpm eval:cached`/`pnpm eval:cascade:cached`, the live app doesn't) the first run over a fixture writes `(object, tokensIn, tokensOut)` to `evals/cache/<hash>.json`. A repeat run hits the same key — returns in 0 ms and $0.

Cache key = `sha256(model | promptVersion | schemaVersion | mode | sha256(text))`. Bump `PROMPT_VERSION` or `SCHEMA_VERSION` — invalidation is automatic. This isn't Redis, isn't LRU, isn't Vercel KV — it's files on disk, gitignored.

Why this only works for extraction and not for streaming or agents: see the header of `lib/vcr.ts`. Briefly: replay kills stream metrics (time-to-first-token), and in agent loops tool results change between runs and the cache would mask a regression.

**VCR failure mode:** if you forget to bump `PROMPT_VERSION` when changing the prompt — the cache will return the old result under the new prompt. Eval will show stable metrics while the prompt is already different. Versioning discipline is the only defense.

---

## Anthropic prompt caching — a different thing, don't confuse them

Anthropic has its own prompt caching: you mark part of the prompt with `cache_control: { type: 'ephemeral' }`, and on a repeat call the prefix is read from cache at ~10% of base cost (Sonnet 4.6: $0.30/MTok cache read vs $3/MTok input). On Sonnet 4.6 thinking blocks are cached by default.

When it pays off: system prompt > 1024 tokens (`extractionSystemPrompt` in this project is around 600 tokens, **won't pay off**), and/or large example documents you feed into EVERY call.

In this project Anthropic prompt caching is **not used** — input is small, corpus is 25 fixtures, the cache isn't justified. VCR cache (ours), on the other hand, gives 100% savings on repeat runs of the same eval. These are different layers.

---

## VCR + Gateway: what to understand together

Gateway calls and the VCR cache live on different layers, and that's intentional. Gateway sees every outgoing request (for billing and observability); VCR — on the contrary — **skips** the request on a cache hit (nothing goes to the provider). With `EVAL_VCR=1` Gateway metrics on repeat runs will be flat. That's the right behavior: a cache hit is a free run, there's nothing to bill.

---

## Concretely: free text → typed Protocol

Input — `protocolSection.descriptionModule.detailedDescription` from ClinicalTrials.gov. 300-2000 words of medical text:

```
This is a Phase 2, randomized, double-blind, placebo-controlled study of pembrolizumab
in patients with advanced non-small cell lung cancer who have failed at least two prior
lines of therapy...

Inclusion Criteria:
- Histologically confirmed NSCLC
- ECOG performance status 0-1
- Age ≥ 18 years
...
```

Output:

```ts
{
  phase: 'PHASE_2',
  studyType: 'INTERVENTIONAL',
  primaryOutcomes: [{ measure: 'Overall survival', timeFrame: 'from randomization to death' }],
  eligibilityCriteria: [
    { type: 'INCLUSION', description: 'Histologically confirmed NSCLC', category: 'MEDICAL' },
    { type: 'INCLUSION', description: 'ECOG performance status 0-1', category: 'MEDICAL' },
    { type: 'INCLUSION', description: 'Age ≥ 18 years', category: 'DEMOGRAPHIC' },
  ],
  interventions: [{ type: 'DRUG', name: 'pembrolizumab', dosage: '200 mg IV every 3 weeks' }],
}
```

You don't write a criteria parser. You don't write regex for dosages. You don't normalize enums by hand. The schema describes the contract, the SDK enforces it.

---

## What breaks if you don't do X

- **No `try/catch` around `generateText`.** On the very first `NoObjectGeneratedError` the whole API route falls over with a 500. If you have streaming in the UI — the user sees a stuck spinner, then an error with no diagnostic.
- **You don't log `err.usage` on failure.** Billing grows, you don't know why. Failure modes consume as many tokens as success — sometimes more because of retries.
- **`safeParse` skipped, you trust `result.output` directly.** Cross-field invariants pass silently, in production you see `studyType: INTERVENTIONAL` with an empty `interventions[]` — the UI renders "no interventions" under a randomized controlled trial. Nobody notices until a doctor complains.
- **You don't bump `PROMPT_VERSION` when editing the prompt.** The VCR cache returns stale responses, eval shows old numbers, the regression is invisible. Versioning discipline is part of the architecture, not cosmetic.
- **You import `anthropic`/`openai` directly and put `ANTHROPIC_API_KEY` in `.env`.** You stop seeing Gateway metrics, the unified bill breaks, vendor-specific code creeps in. In this project both providers go through `gateway('anthropic/...')` / `gateway('openai/...')`.

---

## The type boundary — summary

Without a structured-output boundary:
- `POST /api/extract` returns `{ data: any }` — the client does a type assertion.
- The eval harness manually checks `typeof result.phase === 'string'` before scoring.
- SQLite `output_json` — an unparseable blob of unknown shape.

With `generateText({ output: Output.object({ schema }) })`:
- `POST /api/extract` returns `ExtractionResult` with an explicit `validationStatus`.
- The eval harness does one `ProtocolSchema.safeParse` — a single path.
- SQLite stores `output_json` that always parses against `schemas/v1/protocol.ts` + `schema_version` on the same row.

The type boundary runs exactly through `Output.object`. Before it — `text: string`. After it — `Protocol`. The rest of the code works with the type.

---

## Further reading

- [AI SDK generateText + Output.object](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text) — `output`, `result.output`, NoObjectGeneratedError, retry mechanics
- [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) — one key for Anthropic/OpenAI, observability, fallback
- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — when it pays off (>1024 prefix tokens)
- [Structured outputs vs tool use in 2026](https://www.buildmvpfast.com/blog/structured-output-llm-json-mode-function-calling-production-guide-2026) — extraction → structured output, agents → tool calling
