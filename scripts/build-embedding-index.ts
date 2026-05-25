import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

// Load .env / .env.local before importing AI SDK
for (const envFile of ['.env', '.env.local']) {
  const p = path.resolve(process.cwd(), envFile);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { embedTexts } from '@/lib/embeddings';

const FIXTURES_DIR = path.resolve(process.cwd(), 'fixtures/trials');
const INDEX_PATH = path.resolve(process.cwd(), 'fixtures/embeddings.json');

(async () => {
  const ids = readdirSync(FIXTURES_DIR)
    .filter((n) => /^NCT\d{8}\.json$/.test(n))
    .map((n) => n.replace('.json', ''))
    .sort();

  console.log(`Embedding ${ids.length} fixtures with text-embedding-3-small…`);

  const raws = ids.map((id) =>
    JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${id}.json`), 'utf8')),
  );

  // Embed title + description (truncated to ~8k chars to stay within token budget)
  const texts = raws.map((raw) => {
    const title = raw?.protocolSection?.identificationModule?.briefTitle ?? '';
    const desc = raw?.protocolSection?.descriptionModule?.detailedDescription ?? '';
    return `${title}\n\n${desc}`.slice(0, 8000);
  });

  const embeddings = await embedTexts(texts);

  const index: Record<string, { title: string; embedding: number[] }> = {};
  for (let i = 0; i < ids.length; i++) {
    index[ids[i]] = {
      title: raws[i]?.protocolSection?.identificationModule?.briefTitle ?? '',
      embedding: embeddings[i],
    };
  }

  writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n');
  console.log(`Wrote ${ids.length} embeddings → fixtures/embeddings.json`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
