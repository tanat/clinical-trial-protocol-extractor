'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type SearchResult = { nctId: string; title: string; similarity: number };
type SearchResponse = { query: string; results: SearchResult[] };

const EXAMPLES = [
  'pembrolizumab lung cancer',
  'cognitive behavioral therapy PTSD',
  'pediatric leukemia Phase 1',
  'cardiovascular observational study',
];

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSearch() {
    if (query.trim().length < 3) {
      setError('Query must be at least 3 characters.');
      return;
    }
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), topK: 5 }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = typeof json.error === 'string' ? json.error : 'Request failed';
        if (res.status === 503) {
          throw new Error('Embedding index not built — run `pnpm build:index` first.');
        }
        throw new Error(msg);
      }
      setResponse(json as SearchResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-8 flex flex-col gap-2 sm:mb-10">
        <Link
          href="/"
          className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
        >
          <span aria-hidden>←</span> Extractor
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Semantic Search</h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          Find similar trials using{' '}
          <strong className="font-semibold text-foreground">text-embedding-3-small</strong>{' '}
          embeddings + cosine similarity.
        </p>
      </header>

      <Card className="mb-6">
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-base">Query</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-1">
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((q) => (
              <button
                key={q}
                onClick={() => setQuery(q)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground/80 shadow-sm transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {q}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. pembrolizumab lung cancer Phase 2"
              onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
            />
            <Button size="lg" onClick={onSearch} disabled={loading} className="min-w-28 sm:shrink-0">
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner />
                  Searching…
                </span>
              ) : (
                'Search'
              )}
            </Button>
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

      {loading && !response && (
        <Card className="animate-rise">
          <CardContent className="space-y-3 py-5" aria-busy="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3.5 w-28" />
                  <div className="skeleton h-3 w-3/4" />
                </div>
                <div className="skeleton h-5 w-12 rounded-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {response && (
        <Card className="animate-rise">
          <CardHeader className="border-b pb-4">
            <CardTitle className="text-base">
              Top {response.results.length} results for{' '}
              <span className="text-primary">&ldquo;{response.query}&rdquo;</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-1">
            <ul className="divide-y divide-border">
              {response.results.map((r, idx) => (
                <li key={r.nctId} className="flex items-start justify-between gap-4 py-3 first:pt-1 last:pb-0">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-medium tabular-nums text-muted-foreground">
                      {idx + 1}
                    </span>
                    <div>
                      <a
                        href={`https://clinicaltrials.gov/study/${r.nctId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded"
                      >
                        {r.nctId}
                      </a>
                      <p className="text-sm text-muted-foreground">{r.title}</p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium tabular-nums text-primary">
                    {(r.similarity * 100).toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
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
