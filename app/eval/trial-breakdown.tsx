'use client';

import { Fragment, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { JsonTree } from '@/components/json-tree';
import type { EvalEntry } from '@/lib/eval-results';

type Row = EvalEntry['perTrial'][number];

export function TrialBreakdown({
  perTrial,
  fixtureTitles,
  groundTruthById,
}: {
  perTrial: Row[];
  fixtureTitles: Record<string, string>;
  groundTruthById: Record<string, unknown>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>NCT</TableHead>
          <TableHead>Title</TableHead>
          <TableHead className="text-right">phase</TableHead>
          <TableHead className="text-right">studyType</TableHead>
          <TableHead className="text-right">outcomes</TableHead>
          <TableHead className="text-right">eligibility</TableHead>
          <TableHead className="text-right">interventions</TableHead>
          <TableHead className="text-right">latency</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {perTrial.map((t) => {
          const title = fixtureTitles[t.trialId] ?? '';
          const isOpen = openId === t.trialId;
          if (!t.ok) {
            return (
              <TableRow key={t.trialId}>
                <TableCell className="font-mono text-xs">{t.trialId}</TableCell>
                <TableCell className="text-xs text-muted-foreground" colSpan={7}>
                  skipped — {t.error}
                </TableCell>
              </TableRow>
            );
          }
          const tone = (s: number) =>
            s >= 0.85
              ? 'text-emerald-600 dark:text-emerald-400'
              : s >= 0.6
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-red-600 dark:text-red-400';
          return (
            <Fragment key={t.trialId}>
              <TableRow
                onClick={() => setOpenId(isOpen ? null : t.trialId)}
                className="cursor-pointer"
              >
                <TableCell className="font-mono text-xs">
                  <span className="mr-2 inline-block w-3 text-zinc-400">{isOpen ? '▾' : '▸'}</span>
                  {t.trialId}
                </TableCell>
                <TableCell className="max-w-[28ch] truncate text-xs" title={title}>
                  {title}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${tone(t.perField.phase.score)}`}>
                  {t.perField.phase.score.toFixed(2)}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${tone(t.perField.studyType.score)}`}>
                  {t.perField.studyType.score.toFixed(2)}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${tone(t.perField.primaryOutcomes.score)}`}>
                  {t.perField.primaryOutcomes.score.toFixed(2)}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${tone(t.perField.eligibilityCriteria.score)}`}>
                  {t.perField.eligibilityCriteria.score.toFixed(2)}
                </TableCell>
                <TableCell className={`text-right tabular-nums ${tone(t.perField.interventions.score)}`}>
                  {t.perField.interventions.score.toFixed(2)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                  {t.latencyMs}ms
                </TableCell>
              </TableRow>
              {isOpen && (
                <TableRow className="bg-zinc-50 dark:bg-zinc-900/40">
                  <TableCell colSpan={8}>
                    <Detail trialId={t.trialId} row={t} groundTruth={groundTruthById[t.trialId]} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Detail({
  trialId,
  row,
  groundTruth,
}: {
  trialId: string;
  row: Extract<Row, { ok: true }>;
  groundTruth: unknown;
}) {
  return (
    <div className="space-y-4 p-2">
      <div className="text-xs text-muted-foreground">
        validation <strong>{row.validationStatus}</strong> · tokens{' '}
        {row.tokensIn ?? '–'}/{row.tokensOut ?? '–'} · trial{' '}
        <code>{trialId}</code>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            per-field detail
          </div>
          <JsonTree value={row.perField} />
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
            ground truth (normalized fixture)
          </div>
          {groundTruth === null || groundTruth === undefined ? (
            <div className="text-xs text-muted-foreground">No normalized ground truth on disk.</div>
          ) : (
            <JsonTree value={groundTruth} />
          )}
        </div>
      </div>
    </div>
  );
}
