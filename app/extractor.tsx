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
      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100'
      : result?.validationStatus === 'partial'
        ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
        : 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100';

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Input</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Pick a fixture</label>
            <select
              value={trialId}
              onChange={(e) => setTrialId(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            >
              {fixtures.length === 0 && <option value="">— no fixtures —</option>}
              {fixtures.map((f) => (
                <option key={f.nctId} value={f.nctId}>
                  {f.nctId} — {f.briefTitle.slice(0, 60)} ({f.detailedDescriptionChars}c)
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">…or NCT ID</label>
            <Input
              value={trialId}
              onChange={(e) => setTrialId(e.target.value.toUpperCase())}
              placeholder="NCT12345678"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Or paste a raw description</label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              placeholder="Paste a ClinicalTrials.gov detailed description (≥ 20 chars). Overrides the fixture above when present."
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as 'sonnet' | 'gpt-mini' | 'gemini')}
                disabled={mode === 'stream'}
                className="rounded-md border border-input bg-transparent px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="sonnet">claude-sonnet-4-6</option>
                <option value="gemini">gemini-2.5-flash</option>
                <option value="gpt-mini">gpt-4o-mini</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'standard' | 'stream')}
                className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              >
                <option value="standard">Standard</option>
                <option value="stream">Stream</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="button" onClick={onExtract} disabled={currentLoading}>
              {currentLoading ? (mode === 'stream' ? 'Streaming…' : 'Extracting…') : 'Extract'}
            </Button>
            {mode === 'stream' && isStreaming && (
              <Button type="button" variant="outline" onClick={stopStream}>
                Stop
              </Button>
            )}
          </div>

          {currentError && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-950/50 dark:text-red-100">
              {currentError}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Extraction
            {mode === 'stream' && isStreaming && (
              <span className="text-xs font-normal text-muted-foreground animate-pulse">
                ⟳ streaming…
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!currentExtraction && !currentLoading && (
            <div className="text-sm text-muted-foreground">Run an extraction to see output here.</div>
          )}

          {mode === 'standard' && result && (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className={`rounded-full px-2 py-1 font-medium ${statusTone}`}>
                  {result.validationStatus}
                </span>
                <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {result.meta.modelId}
                </span>
                <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  schema {result.meta.schemaVersion}
                </span>
                <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  prompt {result.meta.promptVersion}
                </span>
                <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {result.meta.latencyMs} ms
                </span>
                {result.meta.tokensIn !== null && (
                  <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {result.meta.tokensIn}/{result.meta.tokensOut} tok
                  </span>
                )}
              </div>

              {result.validationErrors && result.validationErrors.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                  <div className="mb-1 font-semibold">Schema issues</div>
                  <ul className="space-y-0.5">
                    {result.validationErrors.map((e, i) => (
                      <li key={i}>
                        <code>{e.path}</code>: {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {mode === 'stream' && !isStreaming && streamedObject && (
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-emerald-100 px-2 py-1 font-medium text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
                streamed
              </span>
              <span className="rounded-full bg-zinc-100 px-2 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                claude-sonnet-4-6
              </span>
            </div>
          )}

          {Boolean(currentExtraction) && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">extracted</div>
              <JsonTree value={currentExtraction} />
            </div>
          )}

          {groundTruth !== null && mode === 'standard' && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                ground truth (normalized fixture)
              </div>
              <JsonTree value={groundTruth} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
