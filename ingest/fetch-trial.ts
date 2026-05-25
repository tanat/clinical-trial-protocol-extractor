import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RawTrial } from './types';

const API_BASE = 'https://clinicaltrials.gov/api/v2/studies';
const FIXTURES_DIR = path.resolve(process.cwd(), 'fixtures/trials');

const NCT_ID_RE = /^NCT\d{8}$/;

export function fixturePath(nctId: string): string {
  return path.join(FIXTURES_DIR, `${nctId}.json`);
}

async function readCached(nctId: string): Promise<RawTrial | null> {
  try {
    const buf = await fs.readFile(fixturePath(nctId), 'utf8');
    return JSON.parse(buf) as RawTrial;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function fetchTrial(nctId: string): Promise<RawTrial> {
  if (!NCT_ID_RE.test(nctId)) {
    throw new Error(`Invalid NCT ID: ${nctId} (expected NCT followed by 8 digits)`);
  }

  const cached = await readCached(nctId);
  if (cached) return cached;

  const url = `${API_BASE}/${nctId}?format=json`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`ClinicalTrials.gov ${res.status} for ${nctId}: ${await res.text()}`);
  }
  const json = (await res.json()) as RawTrial;

  await fs.mkdir(FIXTURES_DIR, { recursive: true });
  await fs.writeFile(fixturePath(nctId), JSON.stringify(json, null, 2) + '\n', 'utf8');

  return json;
}
