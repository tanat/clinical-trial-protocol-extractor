// F1 over two lists with bipartite matching by similarity threshold.
//
// Algorithm:
//   1. Build an extracted×gold similarity matrix.
//   2. Solve max-weight matching via the Hungarian algorithm (rectangular
//      cost matrix; we minimize cost = 1 - similarity).
//   3. Drop matched pairs whose similarity falls below the threshold.
//   4. precision = kept / extracted.length
//      recall    = kept / gold.length
//      f1        = 2 * P * R / (P + R) (or 0 / 1 in the degenerate cases
//                   that are documented below).
//
// We implement Hungarian inline (~80 lines) — no external dependency.
// References: Kuhn 1955 (original), Munkres 1957 (square matrices),
// Bourgeois & Lassalle 1971 (rectangular extension used here).

export type ListScoreResult = {
  precision: number;
  recall: number;
  f1: number;
  matches: Array<[number, number, number]>; // [extractedIndex, goldIndex, similarity]
};

export function scoreListF1<T>(
  extracted: T[],
  gold: T[],
  similarity: (a: T, b: T) => number,
  threshold: number,
): ListScoreResult {
  // Edge cases: empty inputs.
  if (extracted.length === 0 && gold.length === 0) {
    // No items on either side. By convention, F1 is 1 (perfect "vacuous" match).
    return { precision: 1, recall: 1, f1: 1, matches: [] };
  }
  if (extracted.length === 0) {
    return { precision: 1, recall: 0, f1: 0, matches: [] };
  }
  if (gold.length === 0) {
    return { precision: 0, recall: 1, f1: 0, matches: [] };
  }

  const sim: number[][] = extracted.map((a) => gold.map((b) => similarity(a, b)));
  const assignment = hungarianMaxWeight(sim);

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

// Hungarian algorithm on a rectangular profit matrix. Returns, for each row,
// the column it is assigned to (or -1 if unassigned because there were more
// rows than columns).
//
// Implementation note: we square the matrix by padding with zeros so the
// classic O(n^3) Munkres routine applies. n is tiny (≤ low hundreds in our
// eval), so this is fine.
function hungarianMaxWeight(profit: number[][]): number[] {
  const rows = profit.length;
  const cols = profit[0]?.length ?? 0;
  const n = Math.max(rows, cols);

  // Convert to a square cost matrix (we minimize cost; cost = MAX_PROFIT - p).
  let maxP = 0;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) if (profit[i][j] > maxP) maxP = profit[i][j];
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

  const result: number[] = new Array(rows).fill(-1);
  for (let i = 0; i < rows; i++) {
    const j = colAssign[i];
    if (j >= 0 && j < cols) result[i] = j;
  }
  return result;
}

// Standard O(n^3) Hungarian on a square cost matrix. Returns column assigned
// to each row. Adapted from the classic potential / augmenting-path form
// (Jonker–Volgenant style book-keeping).
function munkresMin(cost: number[][]): number[] {
  const n = cost.length;
  const u = new Array(n + 1).fill(0); // row potentials
  const v = new Array(n + 1).fill(0); // column potentials
  const p = new Array(n + 1).fill(0); // p[j] = row matched to column j
  const way = new Array(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = -1;
      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const ans: number[] = new Array(n).fill(-1);
  for (let j = 1; j <= n; j++) {
    if (p[j] > 0) ans[p[j] - 1] = j - 1;
  }
  return ans;
}
