import { promises as fs } from 'node:fs';
import path from 'node:path';

const FIXTURES_DIR = path.resolve(process.cwd(), 'fixtures/trials');

export type FixtureSummary = {
  nctId: string;
  briefTitle: string;
  detailedDescriptionChars: number;
};

export async function listFixtures(): Promise<FixtureSummary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(FIXTURES_DIR);
  } catch {
    return [];
  }
  const ids = entries
    .filter((n) => /^NCT\d{8}\.json$/.test(n))
    .map((n) => n.replace(/\.json$/, ''))
    .sort();
  const summaries: FixtureSummary[] = [];
  for (const nctId of ids) {
    try {
      const raw = JSON.parse(await fs.readFile(path.join(FIXTURES_DIR, `${nctId}.json`), 'utf8'));
      const ps = raw?.protocolSection ?? {};
      summaries.push({
        nctId,
        briefTitle: ps?.identificationModule?.briefTitle ?? '',
        detailedDescriptionChars: ps?.descriptionModule?.detailedDescription?.length ?? 0,
      });
    } catch {
      // ignore unreadable fixtures
    }
  }
  return summaries;
}

export async function readNormalized(nctId: string): Promise<unknown | null> {
  const p = path.join(FIXTURES_DIR, `${nctId}.normalized.json`);
  try {
    const buf = await fs.readFile(p, 'utf8');
    return JSON.parse(buf);
  } catch {
    return null;
  }
}
