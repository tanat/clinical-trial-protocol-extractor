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
      <div className="container mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <Header total={0} />
        <Card className="mt-6">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M3 3v18h18" />
                <path d="m19 9-5 5-4-4-3 3" />
              </svg>
            </span>
            <div className="max-w-md space-y-1">
              <p className="text-sm font-medium text-foreground">No eval runs yet</p>
              <p className="text-sm text-muted-foreground">
                Run <CodeChip>pnpm eval</CodeChip> after dropping{' '}
                <CodeChip>AI_GATEWAY_API_KEY</CodeChip> into <CodeChip>.env.local</CodeChip> to
                populate this page.
              </p>
            </div>
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
    <div className="container mx-auto max-w-6xl px-4 py-8 space-y-6 sm:py-12">
      <Header total={results.length} />

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Latest run
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-normal text-muted-foreground">
              {latest.runId}
            </code>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-1">
          <div className="flex flex-wrap gap-1.5 text-xs">
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
                  <TableCell className={`text-right tabular-nums font-medium ${scoreTextTone(latest.aggregate[key])}`}>
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
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-base">Per-trial breakdown</CardTitle>
        </CardHeader>
        <CardContent className="pt-1">
          <TrialBreakdown
            perTrial={latest.perTrial}
            fixtureTitles={fixtureTitles}
            groundTruthById={groundTruthById}
          />
        </CardContent>
      </Card>

      {results.length > 1 && (
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-base">Run history (most recent first)</CardTitle>
          </CardHeader>
          <CardContent className="pt-1">
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
    <header className="flex flex-col gap-2">
      <Link
        href="/"
        className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
      >
        <span aria-hidden>←</span> Extractor
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">Eval results</h1>
      <p className="text-base leading-relaxed text-muted-foreground">
        {total === 0
          ? 'No runs yet.'
          : `${total} run${total === 1 ? '' : 's'} in evals/results.json (append-only).`}
      </p>
    </header>
  );
}

function CodeChip({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-secondary px-2.5 py-1 font-medium text-secondary-foreground">
      {children}
    </span>
  );
}

function scoreTextTone(value: number) {
  return value >= 0.85
    ? 'text-emerald-600 dark:text-emerald-400'
    : value >= 0.6
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-red-600 dark:text-red-400';
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
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-border">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
