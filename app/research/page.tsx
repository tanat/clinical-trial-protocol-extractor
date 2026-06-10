'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type ResearchResult = {
  answer: string;
  toolCalls: Array<{ tool: string; args: unknown }>;
  steps: number;
};

const EXAMPLE_QUESTIONS = [
  'Which trials are Phase 3?',
  'What interventions does NCT03737981 use?',
  'List all oncology trials in the corpus',
  'Which observational trials are available?',
];

export default function ResearchPage() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (question.trim().length < 5) {
      setError('Question must be at least 5 characters.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Request failed');
      setResult(json as ResearchResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
          >
            <span aria-hidden>←</span> Extractor
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Research Assistant</h1>
          <p className="text-base leading-relaxed text-muted-foreground">
            Ask questions about the 25 trials in the corpus. The assistant uses{' '}
            <strong className="font-semibold text-foreground">tool calls</strong> to look up
            structured data before answering.
          </p>
        </div>
      </header>

      <Card className="mb-6">
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-base">Question</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-1">
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => setQuestion(q)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 shadow-sm transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {q}
              </button>
            ))}
          </div>
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            placeholder="Ask anything about the clinical trials in the corpus…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit();
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <Button size="lg" onClick={onSubmit} disabled={loading} className="min-w-24">
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner />
                  Thinking…
                </span>
              ) : (
                'Ask'
              )}
            </Button>
            <span className="hidden text-xs text-muted-foreground sm:block">
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘</kbd>
              <span className="px-0.5">+</span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">↵</kbd>
              <span className="ml-1.5">to ask</span>
            </span>
          </div>
          {error && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive animate-rise dark:border-destructive/40 dark:bg-destructive/10">
              <svg viewBox="0 0 24 24" className="mt-0.5 size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {loading && !result && (
        <Card className="animate-rise">
          <CardContent className="space-y-3 py-5" aria-busy="true">
            <div className="skeleton h-4 w-1/3" />
            <div className="skeleton h-3.5 w-full" />
            <div className="skeleton h-3.5 w-11/12" />
            <div className="skeleton h-3.5 w-4/5" />
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-4 animate-rise">
          <Card>
            <CardHeader className="border-b pb-4">
              <CardTitle className="flex items-center justify-between text-base">
                Answer
                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                  {result.steps} step{result.steps !== 1 ? 's' : ''}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-1">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                {result.answer}
              </p>
            </CardContent>
          </Card>

          {result.toolCalls.length > 0 && (
            <Card>
              <CardHeader className="border-b pb-4">
                <CardTitle className="text-base">Tool calls</CardTitle>
              </CardHeader>
              <CardContent className="pt-1">
                <ul className="space-y-2">
                  {result.toolCalls.map((tc, i) => (
                    <li
                      key={i}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2.5 text-xs"
                    >
                      <span className="rounded-md bg-primary/10 px-2 py-0.5 font-mono font-medium text-primary">
                        {tc.tool}
                      </span>
                      <code className="overflow-x-auto rounded bg-card px-2 py-0.5 font-mono text-muted-foreground ring-1 ring-border">
                        {JSON.stringify(tc.args)}
                      </code>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
    </svg>
  );
}
