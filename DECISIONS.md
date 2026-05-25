# DECISIONS

Three architectural calls that shaped the project. Format: "I chose X over Y
because Z, and the cost of Z is W."

---

## 1. Two-stage cascade vs single-pass extraction

**I chose** to ship single-pass first and add the two-stage cascade
as an opt-in mode behind `pnpm eval:cascade` **over** going cascade-first.

**Why.** The single-pass call (one `generateText({ output: Output.object({ schema: Protocol }) })`
against the full Protocol schema) is the obvious baseline; without it I have
no honest comparison for whether cascade actually helps. The cascade —
`gateway('openai/gpt-4o-mini')` segments the detailed description into
`outcomes / eligibility / interventions / other`, then a section-scoped
`generateText` with `Output.object({ schema: ... })` runs on each — should
win on eligibility recall, because eligibility is the field where
single-pass spreads its attention budget thinnest. The 25-fixture eval
scores are the referee, not my prior.

**The cost.** Cascade doubles LLM calls per trial (segmenter + 4 section
calls vs. 1 monolithic call), and the segmenter introduces a new failure
mode: if it puts an eligibility sentence into the `other` bucket, the
section-scoped extractor can't recover it. That's why the cascade harness
keeps the segmenter on `gpt-4o-mini` (cheap, low-latency) and the section
extractors on `claude-sonnet-4-6` — the segmenter's job is coarse routing,
not fine extraction. If the eval shows cascade isn't beating single-pass on
my corpus, that's a finding, not a bug — it goes back into this file.

---

## 2. Hungarian assignment vs set overlap for list F1

**I chose** to compute list F1 (eligibility, primary outcomes, interventions)
with bipartite matching via the Hungarian algorithm at similarity threshold
0.7 **over** simple set overlap.

**Why.** Eligibility criteria are paraphrases. "Adults aged ≥ 18 years" in
the extraction and "Adults eighteen years or older" in the ground truth are
the same criterion. A naive set check would either miss them entirely
(string `===`) or, worse, let one ground-truth criterion match every nearby
extraction (greedy nearest-neighbour), which inflates precision. Hungarian
forces a one-to-one assignment, then the threshold drops weak matches; the
F1 is the count of survivors over the two list sizes. The unit tests in
`score/__tests__/list.test.ts` cover the pathological cases — identical
lists, disjoint lists, near-duplicates that must not double-count — so a
regression in the matcher trips a red CI bar.

**The cost.** Two: (1) the algorithm itself is ~80 lines of inline Hungarian
(I write it instead of pulling `munkres-js` because the dependency is dead
weight at this scope), with potentials and augmenting paths that nobody
loves debugging. (2) The threshold is a hyper-parameter — at 0.6 most
paraphrases match (F1 inflates), at 0.8 even close rewordings drop. I
locked it at 0.7 because that's the floor where the close-paraphrase
test in `list.test.ts` still passes; `evals/README.md` documents that
moving it requires re-running every entry. Levenshtein-based similarity
is also brittle on word reorderings — a sentence-embedding similarity
would fix that, but the project is pet-scope and I refuse to ship an
embedding dependency for it.

---

## 3. Versioned schemas + pinned prompts vs in-place evolution

**I chose** to version the Zod schema in `schemas/v1/` and export a
`PROMPT_VERSION` constant from `extract/prompt.ts`, and to write both into
every row of `logs/extractions.sqlite` and every entry of
`evals/results.json` **over** evolving one schema in place.

**Why.** I want to see what happens when I add a field — does precision on
the existing fields drop because the model is now juggling more shape?
Without version pins, that question dissolves into git archaeology. With
them, the `git diff` on `evals/results.json` is the regression timeline,
and I can rerun any historical prompt by checking out its commit and
running `pnpm eval`. The SQLite log carries the same versions so an old
row stays interpretable even after `v2` lands; reading old logs requires
the right schema version to parse `output_json`, and the row itself
points to it.

**The cost.** Migration overhead. Every meaningful prompt change is now a
new version (even typos — discipline matters more than convenience here),
and adding a schema field means copying `schemas/v1/` to `schemas/v2/`,
re-pinning the prompt, and re-running the harness so the next entry in
`results.json` declares the new pair. There's no automatic translation
between `v1` and `v2` log rows — when I want to compare them, I do it
with the per-field aggregates in `results.json`, not by trying to parse
ancient `output_json` blobs against a newer schema. That's deliberate:
the eval is the comparison surface, not the raw log.
