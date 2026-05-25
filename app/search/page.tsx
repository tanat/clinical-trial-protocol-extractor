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
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Semantic Search</h1>
          <p className="text-sm text-muted-foreground">
            Find similar trials using{' '}
            <strong>text-embedding-3-small</strong> embeddings + cosine similarity.
          </p>
        </div>
        <Link href="/" className="text-sm underline-offset-4 hover:underline">
          ← Extractor
        </Link>
      </header>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Query</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((q) => (
              <button
                key={q}
                onClick={() => setQuery(q)}
                className="rounded-full border border-input px-3 py-1 text-xs hover:bg-accent"
              >
                {q}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. pembrolizumab lung cancer Phase 2"
              onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
            />
            <Button onClick={onSearch} disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </Button>
          </div>
          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-950/50 dark:text-red-100">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {response && (
        <Card>
          <CardHeader>
            <CardTitle>
              Top {response.results.length} results for &ldquo;{response.query}&rdquo;
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {response.results.map((r) => (
                <li key={r.nctId} className="flex items-start justify-between gap-4">
                  <div>
                    <a
                      href={`https://clinicaltrials.gov/study/${r.nctId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {r.nctId}
                    </a>
                    <p className="text-sm text-muted-foreground">{r.title}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs tabular-nums text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
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
