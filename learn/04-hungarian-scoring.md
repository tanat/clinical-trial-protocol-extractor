# Stage 4 — Hungarian Scoring (the central exercise)

## Why such complexity for list scoring

If you compute extraction metrics trivially, you're most likely computing them wrong. This isn't a fancy claim — it's that **scoring lists with paraphrases requires meaningful matching**, and naive approaches inflate either precision, or recall, or both.

Eligibility criteria is a list of text phrases. Each phrase in your extraction may be a paraphrase of a phrase in ground truth, may be an exact copy, may be missing entirely. You need to compute precision and recall — and for that you need to decide: which extracted string corresponds to which gold string, if it corresponds at all.

This is the **assignment problem** — a classic combinatorial optimization. And that's exactly what the Hungarian algorithm solves (Kuhn 1955, Munkres 1957). It's still the standard for one-to-one matching in bipartite graphs at these data sizes — nobody has come up with anything better.

Analogy: imagine matching two lists of students from an exam — one wrote names, the other wrote nicknames. You can't just count the intersection under strict equality. But you also can't assign one "Vasya" to three "V.P.", "Vasya-P", "Vasily P." from the second list at once — that inflates the match count.

---

## Why set overlap breaks

The naive approach: compare two sets of strings via `Set`.

```ts
const gold = new Set(['Age ≥ 18 years', 'ECOG 0-1', 'No prior platinum therapy']);
const extracted = new Set(['Adults eighteen years or older', 'ECOG performance status 0 or 1']);

const intersection = new Set([...gold].filter(x => extracted.has(x)));
// intersection.size === 0 — not a single match
```

Result F1 = 0, even though by meaning extracted contains 2 of 3 criteria.

This is **not an edge case**. This is the main scenario: LLM extraction and ground truth use different phrasings for the same criterion:

- `"Age ≥ 18 years"` vs `"Adults eighteen years or older"` — the same
- `"ECOG performance status 0-1"` vs `"ECOG 0-1"` — the same
- `"No prior platinum-based chemotherapy"` vs `"Prior platinum therapy"` — **different** (one exclusive, the other inclusive)

Set overlap doesn't distinguish the first two cases (all counted as different) and doesn't catch the third (if the strings happened to match, it would count it as a hit).

---

## Why greedy nearest-neighbour breaks too

A step closer to truth: for each extracted string, find the nearest gold by similarity.

```ts
for (const e of extracted) {
  const best = gold.reduce((best, g) =>
    similarity(e, g) > best.score ? { item: g, score: similarity(e, g) } : best,
    { item: null, score: 0 }
  );
  if (best.score >= threshold) matches.push([e, best.item]);
}
```

Problem: one gold element can be the best neighbor for **several** extracted at once.

```
extracted:  ["Age 18+", "Age ≥ 18", "Adults over 18"]   ← three very similar
gold:       ["Age ≥ 18 years"]

Greedy: all three extracted match against the same gold
→ precision = 3/3 = 1.0  ← inflation
→ recall    = 1/1 = 1.0
→ F1 = 1.0
```

Real situation: the model duplicated the criterion three times (a prompt bug). The correct precision = 1/3 (only one of the duplicates counts as a match), the correct F1 = 0.5. Greedy doesn't notice this.

**This is not a theoretical case.** When the model tires on a long list, it starts repeating itself. Greedy matching masks exactly the class of bugs you need to catch.

---

## Hungarian: formally, and why specifically this one

The Hungarian algorithm solves: match elements from set A to elements from set B such that:
1. Each element of A is assigned to **at most one** element of B
2. Each element of B is used by **at most one** element of A
3. The total similarity over assigned pairs is maximized

This is **one-to-one bipartite matching with maximum weight**. For our task: the same gold string can't match against two extracted strings. If you have three duplicates in extracted and one gold — after Hungarian only one pair remains, the other two hang unassigned.

Complexity is O(n³). At our sizes (≤ ~100 elements on each side) this is microseconds.

---

## Implementation: `score/list.ts`

```ts
export function scoreListF1<T>(
  extracted: T[],
  gold: T[],
  similarity: (a: T, b: T) => number,
  threshold: number,
): ListScoreResult {
  // Edge cases first — otherwise division by zero
  if (extracted.length === 0 && gold.length === 0)
    return { precision: 1, recall: 1, f1: 1, matches: [] };
  if (extracted.length === 0)
    return { precision: 1, recall: 0, f1: 0, matches: [] };
  if (gold.length === 0)
    return { precision: 0, recall: 1, f1: 0, matches: [] };

  // 1. Build similarity matrix extracted × gold
  const sim: number[][] = extracted.map((a) => gold.map((b) => similarity(a, b)));

  // 2. Solve maximum-weight assignment
  const assignment = hungarianMaxWeight(sim);

  // 3. Drop pairs below threshold
  const matches: Array<[number, number, number]> = [];
  for (let i = 0; i < assignment.length; i++) {
    const j = assignment[i];
    if (j < 0) continue;
    const s = sim[i][j];
    if (s >= threshold) matches.push([i, j, s]);
  }

  const kept = matches.length;
  const precision = kept / extracted.length;
  const recall = kept / gold.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, matches };
}
```

A few places easy to miss:

- **Edge case `extracted.length === 0 && gold.length === 0`** returns `f1: 1`. This is convention: "both empty — vacuous perfect match." The alternative (returning 0 or NaN) breaks aggregation: averaging over trials would count this as a failure even though the extraction is technically correct.
- **`assignment[i] === -1`** means "this extracted string has no assignment" (when `extracted.length > gold.length`). We just skip it.
- **`if (s >= threshold)`** — after Hungarian we still drop pairs with low similarity. Hungarian maximizes the sum, so the optimal solution may include "best of the bad" pairs. The threshold removes them.
- **`matches` stores `[i, j, s]`** — indices and similarity. This gets written into `evals/results.json` and lets you do post-hoc analysis: "why is `eligibility F1 = 0.6` — let's see which 40% of pairs didn't pass the threshold."

---

## Inline Hungarian (~80 lines)

No external dependency — `munkres-js` is not used. From the project's DECISIONS.md: "the dependency is dead weight at this scope." At n ≤ ~100 this is microseconds, and the maintained lines are few enough.

```ts
function hungarianMaxWeight(profit: number[][]): number[] {
  const rows = profit.length;
  const cols = profit[0]?.length ?? 0;
  const n = Math.max(rows, cols);

  // Convert profit to cost: cost = MAX_PROFIT - profit
  // Hungarian minimizes cost — we maximize profit
  let maxP = 0;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++)
      if (profit[i][j] > maxP) maxP = profit[i][j];

  // Square padding — standard Munkres expects a square matrix
  const cost: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(n);
    for (let j = 0; j < n; j++) {
      const p = i < rows && j < cols ? profit[i][j] : 0;
      row[j] = maxP - p;
    }
    cost.push(row);
  }

  const colAssign = munkresMin(cost);

  // Filter padding back out
  const result: number[] = new Array(rows).fill(-1);
  for (let i = 0; i < rows; i++) {
    const j = colAssign[i];
    if (j >= 0 && j < cols) result[i] = j;
  }
  return result;
}
```

Two non-obvious points:

1. **`maxP - profit` for conversion**. Munkres minimizes the sum. To maximize similarity we invert: cost = (max similarity) - (this similarity). Minimum sum of cost = maximum sum of similarity.
2. **Square padding with zeros**. When `extracted.length !== gold.length`, we pad the matrix to a square. Padding rows/columns have all profit = 0 → cost = maxP. Guarantee: real rows get assigned before padding (if any are available).

`munkresMin` is the standard O(n³) algorithm via potentials and augmenting paths (Jonker–Volgenant book-keeping). The full code is in `score/list.ts` lines 98-151. Don't edit it without reason — refactoring "for cleanliness" usually breaks invariants.

---

## Similarity by field — `score/aggregate.ts`

```ts
function outcomeSimilarity(a: PrimaryOutcome, b: PrimaryOutcome): number {
  return stringSimilarity(a.measure, b.measure);
  // Only measure, not timeFrame or description
}

function eligibilitySimilarity(a: EligibilityItem, b: EligibilityItem): number {
  // Type lock: INCLUSION ≠ EXCLUSION, even if the text matches
  if (a.type !== b.type) return 0;
  return stringSimilarity(a.description, b.description);
}

function interventionSimilarity(a: Intervention, b: Intervention): number {
  const nameSim = stringSimilarity(a.name, b.name);
  const typeBonus = a.type === b.type ? 1 : 0;
  return 0.7 * nameSim + 0.3 * typeBonus;
  // Name matters more than type — DRUG vs OTHER is a common model error
}
```

Three different similarity shapes — because three different object structures:

- **Outcome:** compare by `measure`. `timeFrame` and `description` are optional and noisy — including them in similarity creates false misses.
- **Eligibility:** **type lock**. INCLUSION criterion "Age ≥ 18" and EXCLUSION criterion "Age < 18" are semantically opposite even with similar text. If we didn't block by type, Hungarian could match them (the text is similar) — and that's semantically wrong. So `a.type !== b.type → return 0` is enforced.
- **Intervention:** weighted combination. `nameSim` matters more, `typeBonus` has lower weight. This is an empirically calibrated rule — models often confuse `DRUG` and `OTHER`, and we don't want to fully penalize for it.

---

## Threshold 0.7 — why exactly this

`SIMILARITY_THRESHOLD = 0.7` in `score/aggregate.ts`.

Levenshtein similarity (`score/similarity.ts`):

```ts
export function stringSimilarity(a: string, b: string): number {
  const x = normalize(a);  // lowercase + collapse whitespace
  const y = normalize(b);
  const d = levenshteinDistance(x, y, { useCollator: false });
  return 1 - d / Math.max(x.length, y.length);
}
```

Threshold calibration is about a precision-vs-recall trade-off. A test from `score/__tests__/list.test.ts`:

```
"Age ≥ 18 years" vs "Adults eighteen years or older"
→ normalize: "age ≥ 18 years" vs "adults eighteen years or older"
→ levenshtein distance ≈ 18, max length = 31
→ similarity ≈ 1 - 18/31 ≈ 0.42  ← BELOW 0.7
```

That is, Levenshtein doesn't consider these strings similar even though they mean the same thing. This is the **fundamental limitation of Levenshtein** — it counts characters, not meaning. And that's exactly why there's a second scorer in the project.

DECISIONS.md acknowledges this directly: "Levenshtein is brittle on word reorderings — a sentence-embedding similarity would fix that."

A 0.7 threshold on Levenshtein is the floor for **similar phrasings** (the same lexical core):
- `"ECOG performance status 0-1"` vs `"ECOG 0-1"` → similarity ≈ 0.71 — passes
- `"Age ≥ 18 years"` vs `"Adults over 18"` → doesn't pass on Levenshtein

For the second case there's LLM-as-judge.

---

## LLM-as-judge — alternative scorer

File: `score/llm-judge.ts`

```ts
import { generateText, Output, gateway } from 'ai';

const JUDGE_MODEL = gateway('anthropic/claude-haiku-4-5-20251001');

async function judgeMatch(field: string, extracted: string, gold: string): Promise<number> {
  const { output } = await generateText({
    model: JUDGE_MODEL,
    output: Output.object({ schema: JudgeResult }), // { score: z.number().min(0).max(1), reason: z.string().max(150) }
    prompt: `Does the extracted ${field} match the ground truth?

Extracted: "${extracted}"
Ground truth: "${gold}"

Score: 1.0 = same meaning (paraphrases OK), 0.5 = partially correct, 0.0 = wrong or unrelated.
Be strict about numeric thresholds and factual accuracy. Lenient about phrasing.`,
  });
  return output.score;
}
```

Claude Haiku 4.5 scores each `(extracted, gold)` pair from 0 to 1, understanding **meaning**, not characters. For `"Age ≥ 18 years"` vs `"Adults eighteen years or older"` it returns ~0.9.

After building the score matrix, **greedy matching** is used, not Hungarian:

```ts
const matchedGold = new Set<number>();
let tp = 0;
for (let i = 0; i < extracted.length; i++) {
  for (let j = 0; j < gold.length; j++) {
    if (!matchedGold.has(j) && scoreMatrix[i][j] >= 0.5) {
      tp++;
      matchedGold.add(j);
      break;
    }
  }
}
```

Why greedy here, not Hungarian: the score matrix is already semantic (the judge accounts for meaning), exact assignment optimization is less critical. Cheaper, simpler. If it later turns out that llm-judge match accuracy also inflates precision due to duplicates — we can switch to Hungarian, the infrastructure is the same.

### Limitations of LLM-as-judge — why it's not a silver bullet

LLM-as-judge remains the standard tool for semantic evaluation, but the industry has accumulated a critical understanding of its limitations. The main ones:

- **Position bias.** Judges (on pairwise tasks) prefer the first answer. Not our task — we do pointwise scoring — but if you switch to pairwise, keep this in mind.
- **Verbosity bias.** The judge scores long answers higher. Our criteria are short, the effect is minimal, but it shows up on outcome.description.
- **Self-enhancement bias.** A judge LLM from the same family as the extraction LLM (we use Anthropic for both) — may inflate "its own" answers. The remedy: use a judge from another family (GPT-4 or Gemini). At our scale this isn't critical yet.
- **Pointwise/pairwise inconsistency.** The same pairs may be scored differently in different protocols.
- **Frontier models fail bias tests in > 50% of cases** in production conditions (FairJudge 2026).

Practical takeaway: run **both** scorers. If Levenshtein and LLM-judge give close F1s — the regression is real. If they diverge — dig into `matches[]` and look at specific pairs. That's the point of having two — not "pick one," but **triangulate**.

---

## When to use what

| Criterion | Levenshtein | LLM-as-judge |
|---------|-------------|--------------|
| Speed | microseconds | n×m Haiku calls (~0.5-2 sec per trial) |
| Cost | free | ~$0.01/trial |
| Determinism | full | no (temperature) |
| Paraphrase with the same words | good | good |
| Paraphrase with different words | bad | good |
| Word reorder | bad | good |
| Numeric thresholds | good (characters match) | good |
| Debuggability | clear — distance N | unclear why 0.7 vs 0.6 |
| Bias | none (deterministic) | yes, see above |

Levenshtein — **smoke test**: cheap, deterministic, catches deterministic regressions (the model stopped returning a field, the JSON structure broke).

LLM-judge — **semantic check**: expensive, noisy, but sees meaning.

Run both in CI. Divergence between them is a signal to investigate, not "pick the one that shows better."

---

## What breaks if you don't do X

- **You use set overlap.** Any paraphrase — 0. The metric is useless, eval doesn't surface real regressions.
- **You use greedy nearest-neighbour.** Duplicates in extracted inflate precision to 1.0. A real bug (the model repeats itself) is invisible.
- **You dropped the type lock in eligibility.** An INCLUSION criterion matches an EXCLUSION criterion on similar text. The inversion bug isn't caught.
- **You set the threshold to 0.5 instead of 0.7.** Too many junk matches, F1 is inflated. Eval can't tell good extraction from mediocre.
- **You set the threshold to 0.9.** Only identical strings match. F1 is deflated, distinguishing a regression from noise is impossible.
- **You use only LLM-judge.** Bias masks regressions. The run costs money. Not reproducible (temperature).
- **You use only Levenshtein.** You completely miss paraphrase cases. Prompt improvements that change the model's phrasing — look like a regression even though quality went up.

---

## Summary: why Hungarian specifically, not something else

Three properties needed from a scoring function for lists:

1. **One-to-one** — one gold doesn't match two extracted (no precision inflation)
2. **Maximum-weight** — not any assignment, but the optimal one by total similarity
3. **Threshold** — pairs with low similarity are dropped, don't muddy F1

| Approach | (1) | (2) | (3) |
|---------|-----|-----|-----|
| Set overlap | ✓ (but only on exact match) | ✗ | ✗ |
| Greedy nearest | ✗ | ✗ (local maximum) | ✓ |
| Hungarian | ✓ | ✓ | ✓ |

From DECISIONS.md: "Hungarian forces a one-to-one assignment, then the threshold drops weak pairs; the F1 is the count of survivors over the two list sizes."

---

## Further reading

- [Hungarian algorithm](https://en.wikipedia.org/wiki/Hungarian_algorithm) — Kuhn 1955, Munkres 1957
- [Bourgeois & Lassalle 1971](https://dl.acm.org/doi/10.1145/362919.362946) — the rectangular extension you need when `extracted.length !== gold.length`
- [LLM-as-judge limitations (2026)](https://futureagi.com/blog/llm-as-judge-best-practices-2026) — overview of calibration, bias, and cost trade-offs
- [FairJudge (2026)](https://arxiv.org/pdf/2602.06625) — frontier models fail > 50% of bias tests in production
- [Levenshtein distance](https://en.wikipedia.org/wiki/Levenshtein_distance) — normalization and edit-distance
