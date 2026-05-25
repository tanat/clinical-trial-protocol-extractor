# Eval results

`results.json` is **append-only**. Every meaningful prompt or schema change
should be followed by `pnpm eval` (and, after Phase 12, `pnpm eval:cascade`),
with the new entry committed in the same change. The git history of this file
is the regression timeline.

## Schema of one entry

```jsonc
{
  "runId": "2026-05-09T18:23:00.000Z",
  "schemaVersion": "v1.0.0",
  "promptVersion": "v1.0.0",
  "model": "claude-sonnet-4-6",
  "mode": "single-pass",
  "perTrial": [
    {
      "trialId": "NCT03737981",
      "ok": true,
      "perField": { "phase": {…}, "studyType": {…}, "primaryOutcomes": {…}, "eligibilityCriteria": {…}, "interventions": {…} },
      "latencyMs": 4321,
      "tokensIn": 1850,
      "tokensOut": 420,
      "validationStatus": "valid"
    }
    // …per fixture
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

## Aggregation

For v1, each per-field aggregate is the **simple mean** of that field's score
across the `perTrial` entries that succeeded (`ok: true`). Failed extractions
(`ok: false`) are excluded from the mean and surface as their own entries
under `perTrial`. If we move to a weighted aggregate later, this README is
where it gets documented.

## Reading regressions

```bash
# What changed in the latest entry?
git diff HEAD~1 evals/results.json

# Which entries used a given prompt version?
jq '.[] | select(.promptVersion == "v1.0.0") | {runId, model, aggregate}' evals/results.json
```

If a row's aggregate field drops more than ~0.05 versus the prior entry with
the same model+mode, look at `perTrial[].perField.*.matches` to find which
fixtures lost matches.

## Threshold sensitivity

List F1 uses Levenshtein-based string similarity at threshold **0.7**. Below
about 0.6 most paraphrases match — which inflates F1 — and above about 0.8
even close rewordings drop. 0.7 is the floor where the close-paraphrase test
(`score/__tests__/list.test.ts`) still passes. If the threshold changes,
re-run all eval entries (the constant lives in
`score/aggregate.ts:SIMILARITY_THRESHOLD`).
