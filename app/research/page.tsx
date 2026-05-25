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
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Research Assistant</h1>
          <p className="text-sm text-muted-foreground">
            Ask questions about the 25 trials in the corpus. The assistant uses{' '}
            <strong>tool calls</strong> to look up structured data before answering.
          </p>
        </div>
        <Link href="/" className="text-sm underline-offset-4 hover:underline">
          ← Extractor
        </Link>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Question</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => setQuestion(q)}
                className="rounded-full border border-input px-3 py-1 text-xs hover:bg-accent"
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
          <Button onClick={onSubmit} disabled={loading}>
            {loading ? 'Thinking…' : 'Ask'}
          </Button>
          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-950/50 dark:text-red-100">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Answer
                <span className="text-xs font-normal text-muted-foreground">
                  {result.steps} step{result.steps !== 1 ? 's' : ''}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.answer}</p>
            </CardContent>
          </Card>

          {result.toolCalls.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tool calls</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {result.toolCalls.map((tc, i) => (
                    <li key={i} className="flex flex-wrap items-start gap-2 text-xs">
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 font-medium text-blue-900 dark:bg-blue-900/40 dark:text-blue-100">
                        {tc.tool}
                      </span>
                      <code className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
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
