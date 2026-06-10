'use client';

import { useState } from 'react';
import { experimental_useObject as useObject } from '@ai-sdk/react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { JsonTree } from '@/components/json-tree';
import type { FixtureSummary } from '@/lib/fixtures';
import {
  Phase,
  StudyType,
  EligibilityItem,
  PrimaryOutcome,
  Intervention,
} from '@/schemas/v1/protocol';

// Mirrors ProtocolStream in the stream route — no .refine() so useObject can handle partial objects
const ProtocolStreamSchema = z.object({
  phase: Phase,
  studyType: StudyType,
  primaryOutcomes: z.array(PrimaryOutcome),
  eligibilityCriteria: z.array(EligibilityItem),
  interventions: z.array(Intervention),
});

type ExtractResponse = {
  trialId: string | null;
  inputChars: number;
  extraction: unknown;
  validationStatus: 'valid' | 'invalid' | 'partial';
  validationErrors?: Array<{ path: string; message: string }>;
  meta: {
    modelChoice: 'sonnet' | 'gpt-mini' | 'gemini';
    modelId: string;
    schemaVersion: string;
    promptVersion: string;
    inputChars: number;
    latencyMs: number;
    tokensIn: number | null;
    tokensOut: number | null;
  };
};

type GroundTruthResponse = { trialId: string; normalized: unknown };

export function Extractor({ fixtures }: { fixtures: FixtureSummary[] }) {
  const [trialId, setTrialId] = useState<string>(fixtures[0]?.nctId ?? '');
  const [text, setText] = useState<string>('');
  const [model, setModel] = useState<'sonnet' | 'gpt-mini' | 'gemini'>('sonnet');
  const [mode, setMode] = useState<'standard' | 'stream'>('standard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResponse | null>(null);
  const [groundTruth, setGroundTruth] = useState<unknown | null>(null);

  // Always initialised (React hook rules) — only used when mode === 'stream'
  const {
    object: streamedObject,
    submit: streamSubmit,
    isLoading: isStreaming,
    stop: stopStream,
    error: streamError,
  } = useObject({
    api: '/api/extract/stream',
    schema: ProtocolStreamSchema,
  });

  async function onExtract() {
    setError(null);

    const body: Record<string, unknown> = {};
    if (text.trim().length >= 20) body.text = text.trim();
    else if (trialId) body.trialId = trialId;
    else {
      setError('Pick a fixture or paste a description (≥ 20 chars).');
      return;
    }

    if (mode === 'stream') {
      setResult(null);
      setGroundTruth(null);
      streamSubmit(body);
      return;
    }

    // Standard (non-streaming) path
    setLoading(true);
    setResult(null);
    setGroundTruth(null);
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, model }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : JSON.stringify(json.error));
      setResult(json as ExtractResponse);

      const idForTruth = (json as ExtractResponse).trialId;
      if (idForTruth) {
        const gtRes = await fetch(`/api/ground-truth/${idForTruth}`);
        if (gtRes.ok) {
          const gtJson = (await gtRes.json()) as GroundTruthResponse;
          setGroundTruth(gtJson.normalized);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const currentLoading = mode === 'stream' ? isStreaming : loading;
  const currentExtraction = mode === 'stream' ? streamedObject : result?.extraction;
  const currentError = error ?? (streamError instanceof Error ? streamError.message : null);

  const statusTone =
    result?.validationStatus === 'valid'
      ? 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-500/20 dark:bg-emerald-900/40 dark:text-emerald-100'
      : result?.validationStatus === 'partial'
        ? 'bg-amber-100 text-amber-900 ring-1 ring-amber-500/20 dark:bg-amber-900/40 dark:text-amber-100'
        : 'bg-red-100 text-red-900 ring-1 ring-red-500/20 dark:bg-red-900/40 dark:text-red-100';

  const selectClass =
    'w-full appearance-none rounded-lg border border-input bg-card bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat px-3 py-2 pr-9 text-sm shadow-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 ' +
    "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2364748b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><polyline points=%226 9 12 15 18 9%22/></svg>')]";

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 6h16M4 12h10M4 18h7" />
              </svg>
            </span>
            Input
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pick a fixture
            </label>
            <select
              value={trialId}
              onChange={(e) => setTrialId(e.target.value)}
              className={selectClass}
            >
              {fixtures.length === 0 && <option value="">— no fixtures —</option>}
              {fixtures.map((f) => (
                <option key={f.nctId} value={f.nctId}>
                  {f.nctId} — {f.briefTitle.slice(0, 60)} ({f.detailedDescriptionChars}c)
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              …or NCT ID
            </label>
            <Input
              value={trialId}
              onChange={(e) => setTrialId(e.target.value.toUpperCase())}
              placeholder="NCT12345678"
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Or paste a raw description
              </label>
              {text.trim().length > 0 && (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {text.trim().length} chars
                </span>
              )}
            </div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder="Paste a ClinicalTrials.gov detailed description (≥ 20 chars). Overrides the fixture above when present."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Model
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as 'sonnet' | 'gpt-mini' | 'gemini')}
                disabled={mode === 'stream'}
                className={selectClass}
              >
                <option value="sonnet">claude-sonnet-4-6</option>
                <option value="gemini">gemini-2.5-flash</option>
                <option value="gpt-mini">gpt-4o-mini</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Mode
              </label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'standard' | 'stream')}
                className={selectClass}
              >
                <option value="standard">Standard</option>
                <option value="stream">Stream</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="button" size="lg" onClick={onExtract} disabled={currentLoading} className="min-w-32">
              {currentLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner />
                  {mode === 'stream' ? 'Streaming…' : 'Extracting…'}
                </span>
              ) : (
                'Extract'
              )}
            </Button>
            {mode === 'stream' && isStreaming && (
              <Button type="button" size="lg" variant="outline" onClick={stopStream}>
                Stop
              </Button>
            )}
          </div>

          {currentError && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive animate-rise dark:border-destructive/40 dark:bg-destructive/10">
              <svg viewBox="0 0 24 24" className="mt-0.5 size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{currentError}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="lg:sticky lg:top-6">
        <CardHeader className="border-b pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m8 6 4-4 4 4M12 2v14" />
                <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" transform="translate(0 0)" />
              </svg>
            </span>
            Extraction
            {mode === 'stream' && isStreaming && (
              <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                <Spinner className="text-primary" />
                streaming
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pt-1">
          {!currentExtraction && !currentLoading && (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
                </svg>
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">No extraction yet</p>
                <p className="text-sm text-muted-foreground">
                  Pick a fixture or paste a description, then hit <strong>Extract</strong>.
                </p>
              </div>
            </div>
          )}

          {!currentExtraction && currentLoading && <ExtractionSkeleton />}

          {mode === 'standard' && result && (
            <div className="animate-rise space-y-4">
              <div className="flex flex-wrap gap-1.5">
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusTone}`}>
                  {result.validationStatus}
                </span>
                <MetaBadge>{result.meta.modelId}</MetaBadge>
                <MetaBadge>schema {result.meta.schemaVersion}</MetaBadge>
                <MetaBadge>prompt {result.meta.promptVersion}</MetaBadge>
                <MetaBadge>{result.meta.latencyMs} ms</MetaBadge>
                {result.meta.tokensIn !== null && (
                  <MetaBadge>
                    {result.meta.tokensIn}/{result.meta.tokensOut} tok
                  </MetaBadge>
                )}
              </div>

              {result.validationErrors && result.validationErrors.length > 0 && (
                <div className="rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100">
                  <div className="mb-1.5 flex items-center gap-1.5 font-semibold">
                    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Schema issues
                  </div>
                  <ul className="space-y-1">
                    {result.validationErrors.map((e, i) => (
                      <li key={i} className="flex gap-1.5">
                        <code className="rounded bg-amber-200/50 px-1 py-px font-mono dark:bg-amber-900/40">{e.path}</code>
                        <span>{e.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {mode === 'stream' && !isStreaming && streamedObject && (
            <div className="flex flex-wrap gap-1.5 animate-rise">
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
                streamed
              </span>
              <MetaBadge>claude-sonnet-4-6</MetaBadge>
            </div>
          )}

          {Boolean(currentExtraction) && (
            <div className="animate-rise">
              <SectionLabel>extracted</SectionLabel>
              <div className="overflow-x-auto rounded-lg border border-border bg-muted/30 p-3">
                <JsonTree value={currentExtraction} />
              </div>
            </div>
          )}

          {groundTruth !== null && mode === 'standard' && (
            <div className="animate-rise">
              <SectionLabel>ground truth · normalized fixture</SectionLabel>
              <div className="overflow-x-auto rounded-lg border border-border bg-muted/30 p-3">
                <JsonTree value={groundTruth} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-4 animate-spin ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
    </svg>
  );
}

function MetaBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <span>{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function ExtractionSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading extraction">
      <div className="flex flex-wrap gap-1.5">
        <div className="skeleton h-6 w-20 rounded-full" />
        <div className="skeleton h-6 w-32 rounded-full" />
        <div className="skeleton h-6 w-24 rounded-full" />
      </div>
      <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
        {[88, 70, 80, 56, 74, 64].map((w, i) => (
          <div key={i} className="skeleton h-3.5" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}
