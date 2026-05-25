import { embed, embedMany } from 'ai';

const EMBED_MODEL = 'openai/text-embedding-3-small';

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: EMBED_MODEL, value: text });
  return embedding;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({ model: EMBED_MODEL, values: texts });
  return embeddings;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
