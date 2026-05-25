import Link from 'next/link';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { loadResults, type EvalEntry } from '@/lib/eval-results';
import { TrialBreakdown } from './trial-breakdown';
import { listFixtures } from '@/lib/fixtures';
import { readNormalized } from '@/lib/fixtures';

const FIELD_LABELS: Array<[keyof EvalEntry['aggregate'], string]> = [
  ['phase', 'phase'],
  ['studyType', 'studyType'],
  ['primaryOutcomes', 'primaryOutcomes (F1)'],
  ['eligibilityCriteria', 'eligibilityCriteria (F1)'],
  ['interventions', 'interventions (F1)'],
];

export default async function EvalPage() {
  const results = await loadResults();
  const latest = results.at(-1) ?? null;
  const fixtures = await listFixtures();

  if (!latest) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <Header total={0} />
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No eval runs yet. Run <code>pnpm eval</code> after dropping
            <code className="mx-1">ANTHROPIC_API_KEY</code> into <code>.env.local</code> to
            populate this page.
          </CardContent>
        </Card>
      </div>
    );
  }

  // Pre-load normalized ground truth for every trial in the latest run so the
  // expandable per-trial section can show extraction-vs-truth side by side
  // without an extra round-trip.
  const groundTruthById: Record<string, unknown> = {};
  for (const t of latest.perTrial) {
    if (t.ok) groundTruthById[t.trialId] = await readNormalized(t.trialId);
  }
  const fixtureTitles: Record<string, string> = {};
  for (const f of fixtures) fixtureTitles[f.nctId] = f.briefTitle;

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 space-y-6">
      <Header total={results.length} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Latest run — <code className="text-xs">{latest.runId}</code>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Pill>{latest.model}</Pill>
            <Pill>mode {latest.mode}</Pill>
            <Pill>schema {latest.schemaVersion}</Pill>
            <Pill>prompt {latest.promptVersion}</Pill>
            <Pill>{latest.perTrial.length} trials</Pill>
            <Pill>
              {latest.perTrial.filter((t) => t.ok).length} ok ·{' '}
              {latest.perTrial.filter((t) => !t.ok).length} skipped
            </Pill>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="w-[40%]">Bar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FIELD_LABELS.map(([key, label]) => (
                <TableRow key={key}>
                  <TableCell className="font-medium">{label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {latest.aggregate[key].toFixed(3)}
                  </TableCell>
                  <TableCell>
                    <ScoreBar value={latest.aggregate[key]} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-trial breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <TrialBreakdown
            perTrial={latest.perTrial}
            fixtureTitles={fixtureTitles}
            groundTruthById={groundTruthById}
          />
        </CardContent>
      </Card>

      {results.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run history (most recent first)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>runId</TableHead>
                  <TableHead>model</TableHead>
                  <TableHead>mode</TableHead>
                  <TableHead className="text-right">phase</TableHead>
                  <TableHead className="text-right">studyType</TableHead>
                  <TableHead className="text-right">outcomes</TableHead>
                  <TableHead className="text-right">eligibility</TableHead>
                  <TableHead className="text-right">interventions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results
                  .slice()
                  .reverse()
                  .map((r) => (
                    <TableRow key={r.runId}>
                      <TableCell className="font-mono text-xs">{r.runId}</TableCell>
                      <TableCell className="text-xs">{r.model}</TableCell>
                      <TableCell className="text-xs">{r.mode}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.aggregate.phase.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.aggregate.studyType.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.aggregate.primaryOutcomes.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.aggregate.eligibilityCriteria.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.aggregate.interventions.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Header({ total }: { total: number }) {
  return (
    <header className="mb-2 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Eval results</h1>
        <p className="text-sm text-muted-foreground">
          {total === 0
            ? 'No runs yet.'
            : `${total} run${total === 1 ? '' : 's'} in evals/results.json (append-only).`}
        </p>
      </div>
      <nav className="flex items-center gap-3 text-sm">
        <Link href="/" className="underline-offset-4 hover:underline">
          ← Extractor
        </Link>
      </nav>
    </header>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      {children}
    </span>
  );
}

function ScoreBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color =
    value >= 0.85
      ? 'bg-emerald-500'
      : value >= 0.6
        ? 'bg-amber-500'
        : 'bg-red-500';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
