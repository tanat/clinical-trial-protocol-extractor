import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { embedText, cosineSimilarity } from '@/lib/embeddings';

export const runtime = 'nodejs';

const INDEX_PATH = path.resolve(process.cwd(), 'fixtures/embeddings.json');

const Body = z.object({
  query: z.string().min(3),
  topK: z.number().int().min(1).max(10).optional().default(3),
});

type IndexEntry = { title: string; embedding: number[] };

export async function POST(req: Request) {
  if (!existsSync(INDEX_PATH)) {
    return NextResponse.json(
      { error: 'Embedding index not built. Run: pnpm build:index' },
      { status: 503 },
    );
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'provide query string (min 3 chars)' }, { status: 400 });
  }

  const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as Record<string, IndexEntry>;
  const queryEmbedding = await embedText(body.query);

  const results = Object.entries(index)
    .map(([nctId, { title, embedding }]) => ({
      nctId,
      title,
      similarity: cosineSimilarity(queryEmbedding, embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, body.topK);

  return NextResponse.json({ query: body.query, results });
}
