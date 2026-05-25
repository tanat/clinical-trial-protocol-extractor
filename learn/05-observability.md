# Stage 5 — Observability

## Why logs for AI code at all

In a regular backend you log request/response/latency and that's enough: the code is deterministic, the error is either there or it isn't. In AI code every call is an experiment:

- The same input a week later gives different output (even at `temperature: 0` — the provider may update models unevenly).
- "Quality" isn't a binary success but a number from 0 to 1 on each field.
- A regression can hide in one field out of five while the overall "looks fine."
- Cost accumulates per-token, not per-request.

Without structured observability you can't distinguish "the prompt got worse" from "the model updated" from "the corpus shifted." All three look the same — the numbers in eval moved — but they call for different actions.

Analogy: AI code is like a lab where every experiment run needs to be journaled. You need a **lab notebook**, not an application log. So that three months from now you can say: "this is when we moved from prompt v1.2 to v1.3, eligibility F1 dropped by 0.05 — let's see which specific criteria stopped matching."

In the project this is two layers:

1. **SQLite per-call log** — every LLM call as one row. Operational layer.
2. **Append-only `evals/results.json`** — every eval-harness run as one array entry. Regression history layer.

---

## SQLite per-call log

File: `extract/log.ts`

```sql
CREATE TABLE IF NOT EXISTS extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,                -- ISO 8601: '2026-05-22T18:23:00.000Z'
  trial_id TEXT,                   -- NCT ID, NULL for ad-hoc input via UI
  schema_version TEXT NOT NULL,    -- 'v1.0.0'
  prompt_version TEXT NOT NULL,    -- 'v1.0.0'
  model TEXT NOT NULL,             -- 'claude-sonnet-4-6' or 'cascade(...)'
  input_chars INTEGER NOT NULL,    -- input text length
  output_json TEXT NOT NULL,       -- JSON.stringify(extraction)
  validation_status TEXT NOT NULL, -- 'valid' | 'invalid' | 'partial'
  validation_errors TEXT,          -- JSON array or NULL
  per_field_scores TEXT,           -- JSON or NULL (only in eval runs)
  latency_ms INTEGER NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_extractions_trial  ON extractions(trial_id);
CREATE INDEX IF NOT EXISTS idx_extractions_prompt ON extractions(prompt_version);
CREATE INDEX IF NOT EXISTS idx_extractions_ts     ON extractions(ts);
```

13 columns. Each chosen to answer a specific class of question in combination with another column:

| Columns | Question |
|---------|--------|
| `per_field_scores + prompt_version` | Which fields degraded when the prompt changed? |
| `validation_status + prompt_version` | What percentage is `partial` on the new version? |
| `latency_ms + input_chars` | Is there a correlation between text length and latency? |
| `tokens_in + tokens_out + model` | How much does one trial cost? Cascade vs single-pass? |
| `trial_id + validation_status` | Which specific NCT IDs are always `partial`? |
| `model + per_field_scores` | Which model is better on eligibility? |

Not "just log everything, I'll sort it out later." Each column is justified by a specific query you'll actually run.

---

## better-sqlite3 + WAL mode — specific choices

```ts
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
```

**`better-sqlite3` is synchronous.** It's unusual for Node.js, but it's the right choice for logs: a single `INSERT` transaction takes microseconds, an async wrapper would add overhead without benefit. And the code is simpler — no `await` on every line.

**WAL mode.** Write-Ahead Logging lets you read the DB simultaneously with writes without blocking. This matters when the CLI eval harness is writing and at the same time you're running `sqlite3 logs/extractions.sqlite` in another terminal for debugging. Without WAL — locked database errors.

Failure mode without WAL: you launched eval, opened the DB for a query — eval crashes with `SQLITE_BUSY`. WAL makes that just a working scenario.

---

## Logging must not break extraction

From `extract/extract.ts`:

```ts
function maybeLog(result: ExtractionResult, opts: ExtractOptions | undefined): void {
  if (opts?.log === false) return;
  try {
    logExtraction({ /* ... */ });
  } catch (err) {
    // Logging failure must never break the extraction itself.
    console.warn('[log] failed to write extraction row:', err);
  }
}
```

The `try/catch` is essential here. Scenarios where SQLite can fail:
- Disk is full
- File is locked by another process (if someone disabled WAL)
- `logs/` directory doesn't exist (fresh machine, clean checkout)
- Permission denied (running from a read-only FS)

In any of these cases the UI should return the extraction to the user. **Logging is a side effect, not the main path.** This is a basic observability rule: telemetry never blocks core flow.

`console.warn` (not `console.error`) — because we don't want a log failure to clog error reporting (Sentry/Datadog). This is a known class of issues, the operator will see it on manual grep.

---

## `log: false` for the eval harness

The eval harness performs extraction, then computes scores, and **writes the row itself** to SQLite with `per_field_scores` populated. If `extract.ts` logged on its own, we'd get two rows per extraction — one without scores, one with scores.

```ts
// evals/harness.ts
const result = await extractProtocol(text, { model, trialId: id, log: false });
// ... computed scores ...
logExtraction({ trialId: id, /* ... */, perFieldScores: perField, /* ... */ });
```

The `log: false` option is a contract: "I'll write the row myself, don't write it for me." Symmetric with how middleware frameworks let you disable default logging at the endpoint level.

---

## Concrete SQL queries

These aren't "examples for documentation." These are queries you actually need to run when debugging an AI system:

```sql
-- Mean F1 on eligibility for each prompt version
SELECT
  prompt_version,
  AVG(json_extract(per_field_scores, '$.eligibilityCriteria.score')) AS eligibility_f1,
  COUNT(*) AS n
FROM extractions
WHERE per_field_scores IS NOT NULL
GROUP BY prompt_version
ORDER BY prompt_version;
```

`json_extract` is a built-in SQLite operator for path access inside a JSON column. A cheap alternative to normalization.

```sql
-- Top-5 slow calls
SELECT trial_id, model, latency_ms, input_chars
FROM extractions
ORDER BY latency_ms DESC
LIMIT 5;
```

Application: the model suddenly got slower → you look at the top → you see the slow ones are exactly cascade calls → you find out the segmenter started failing into retries.

```sql
-- How many partials by schema
SELECT schema_version, validation_status, COUNT(*) AS n
FROM extractions
GROUP BY schema_version, validation_status;
```

Application: you added `.refine()` → percent of `partial` rose from 5% to 20% → need to look at specific cases, maybe the rule is too strict.

```sql
-- Cost: cascade vs single-pass
SELECT
  CASE WHEN model LIKE 'cascade%' THEN 'cascade' ELSE 'single-pass' END AS mode,
  AVG(tokens_in)  AS avg_in,
  AVG(tokens_out) AS avg_out,
  AVG(latency_ms) AS avg_lat
FROM extractions
WHERE per_field_scores IS NOT NULL
GROUP BY mode;
```

```sql
-- All validation errors for a specific trial
SELECT ts, validation_errors
FROM extractions
WHERE trial_id = 'NCT03737981' AND validation_status != 'valid'
ORDER BY ts;
```

---

## Append-only `evals/results.json`

File: `evals/harness.ts`

```ts
let existing: unknown = [];
try {
  const buf = await fs.readFile(RESULTS_PATH, 'utf8');
  existing = JSON.parse(buf);
} catch {
  existing = [];
}
if (!Array.isArray(existing)) {
  throw new Error(`evals/results.json is not an array; refusing to overwrite`);
}
existing.push(entry);
await fs.writeFile(RESULTS_PATH, JSON.stringify(existing, null, 2) + '\n', 'utf8');
```

Three properties, each important:

1. **Reads the existing array before writing.** Not truncate-and-write.
2. **Checks that it's an array.** If someone hand-edited the file and broke the format — fail loud, don't silently overwrite history.
3. **Appends, never overwrites.** Run history grows strictly append-only.

The main architectural consequence: `git diff evals/results.json` after `pnpm eval` shows **exactly one new object** at the end of the array. Regression = a drop in aggregates in the new object vs the previous one. That's visible in PR diff with the naked eye.

Analogy: like event sourcing, but for eval runs. The file is a journal, not state.

Structure of one entry:

```json
{
  "runId": "2026-05-22T18:23:00.000Z",
  "schemaVersion": "v1.0.0",
  "promptVersion": "v1.0.0",
  "model": "claude-sonnet-4-6",
  "mode": "single-pass",
  "perTrial": [
    {
      "trialId": "NCT03737981",
      "ok": true,
      "perField": {
        "phase":               { "score": 1, "type": "exact" },
        "eligibilityCriteria": {
          "score": 0.72, "type": "f1",
          "precision": 0.75, "recall": 0.69,
          "matches": [[0,2,0.89], [1,5,0.74], ...]
        }
      },
      "latencyMs": 4321,
      "tokensIn": 1850,
      "tokensOut": 420,
      "validationStatus": "valid"
    }
  ],
  "aggregate": {
    "phase": 1.0,
    "studyType": 1.0,
    "primaryOutcomes": 0.81,
    "eligibilityCriteria": 0.62,
    "interventions": 0.85
  }
}
```

`matches: [[0,2,0.89], ...]` stores **indices and similarity**. This is for post-hoc analysis: "why is eligibility F1 = 0.72? let's see which pairs didn't pass the threshold." Without `matches` this is unrecoverable.

---

## PROMPT_VERSION + SCHEMA_VERSION on every row

This is perhaps the most important observability rule in the project.

From DECISIONS.md: "Every meaningful prompt change is now a new version (even typos — discipline matters more than convenience here)."

Concrete scenario: you edit the prompt without changing `PROMPT_VERSION = 'v1.0.0'`. You run `pnpm eval`. You get slightly worse numbers. You roll back the prompt. Run `pnpm eval` again. The numbers are different.

Without versioning, you don't know:
- which SQLite rows correspond to which prompt
- which `results.json` record relates to which state

With versioning: bumping `PROMPT_VERSION` is mandatory on **any** prompt change. Then:
- SQLite: `WHERE prompt_version = 'v1.1.0'` — isolated slice for regression analysis
- `results.json`: every record is tagged, the commit diff is visible in `git log`

The practice that works in the project: change the prompt → bump `PROMPT_VERSION` → run `pnpm eval` → commit `evals/results.json` in the same commit as the prompt change. The prompt history lives in `git log`. Eval results — in `results.json`. The link — via identical `promptVersion` in both.

Failure mode without discipline: 3 months in you have 50 SQLite rows with `prompt_version = 'v1.0.0'`, but the prompt actually changed 5 times. Impossible to say which specific rows correspond to which state. Regression history is effectively lost.

---

## VCR cache vs logging — different layers

Easy confusion: both VCR cache (`lib/vcr.ts`) and SQLite log write to disk, and both are keyed by `prompt_version + schema_version`. But they serve different purposes:

| | VCR cache | SQLite log |
|---|-----------|-----------|
| Goal | Save money on repeat evals | Reproducible history of all calls |
| When to write | Only when `EVAL_VCR=1` | Always (except `log: false`) |
| What's stored | `(object, tokensIn, tokensOut)` | 13 fields including `per_field_scores`, `validation_errors` |
| In git | `evals/cache/` gitignored | `logs/extractions.sqlite` gitignored, but `evals/results.json` committed |
| Lifetime | Can be deleted without loss | Can't be lost — it's history |

The cache can be burned and regenerated (it's just a re-run). The log is a journal, it can't be reconstructed.

---

## Why SQLite, not files or cloud

| Option | Problem |
|---------|---------|
| NDJSON file (as in project 02) | No indexes, filtering only via `grep`/`jq` |
| PostgreSQL | Needs a separate server, connection pool, migration tooling |
| Cloudflare D1 / Turso | Needs a deploy for local eval runs |
| OpenTelemetry / Sentry | Complex setup, expensive for 25 fixtures, payload limits on `output_json` |
| SQLite | One file, synchronous API, indexes, SQL, `json_extract` |

For a pet-scope project with 25 fixtures and ten eval runs a day, SQLite is the optimum. `better-sqlite3` doesn't require async/await — the logging code is simple.

`logs/extractions.sqlite` in `.gitignore` — it contains full extraction JSON and grows fast. Regression history lives in `evals/results.json` (committed) — only aggregates and per-field scores there, not raw JSON.

When to move off SQLite: at > 100k rows (performance is still OK, but git-friendly is no longer feasible) or in a multi-user scenario (concurrent writes become a problem even with WAL). Both conditions are years away for us.

---

## What breaks if you don't do X

- **You log without `try/catch`.** A permission error on `logs/` → 500 on the API. The user gets a bad time, you get no context.
- **`logs/` isn't in `.gitignore`.** The SQLite file (megabytes) gets pushed to the repo, blobs are in git history forever. Cleaning is non-trivial.
- **You don't write `prompt_version` to the row.** A month later you can't recover which prompt produced which numbers.
- **You don't write `per_field_scores` as a separate column.** You can only get it out of `evals/results.json`, losing the link to the SQLite log for a specific call.
- **You overwrite `evals/results.json` instead of appending.** One `pnpm eval` wipes the whole history. PR diff shows "the whole file changed" — unreadable.
- **You don't validate `Array.isArray(existing)` before append.** Someone hand-edited the file, broke the JSON → you silently create a new array, history is lost without warning.
- **You use generic logging (winston, pino) for AI calls.** Text strings can't be aggregated. `AVG(json_extract(...))` doesn't work on free-form log lines.

---

## Further reading

- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — synchronous API, WAL mode, prepared statements
- [SQLite WAL mode](https://www.sqlite.org/wal.html) — concurrent reads with active writes
- [SQLite json_extract](https://www.sqlite.org/json1.html) — path access inside JSON columns
- [Vercel AI SDK generateText + Output.object](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text) — `result.usage.inputTokens` / `outputTokens` for logging
- [LLM observability landscape 2026](https://mlfrontiers.substack.com/p/llm-evaluation-the-new-bottleneck) — why eval journals became the bottleneck of AI development
