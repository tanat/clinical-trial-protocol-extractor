// Reads every fixtures/trials/{NCT_ID}.json (skipping .normalized.json),
// runs the deterministic normalizer, validates the result against the v1
// Zod schema, and writes {NCT_ID}.normalized.json next to the raw file.
//
// Validation errors are reported but never fatal — Phase 3 wants a report
// per fixture, not a failed script.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { normalizeProtocol } from '@/ingest/normalize';
import type { RawTrial } from '@/ingest/types';
import { Protocol, SCHEMA_VERSION } from '@/schemas/v1/protocol';

const FIXTURES_DIR = path.resolve(process.cwd(), 'fixtures/trials');

async function listRawFixtures(): Promise<string[]> {
  const entries = await fs.readdir(FIXTURES_DIR);
  return entries
    .filter((name) => name.endsWith('.json') && !name.endsWith('.normalized.json'))
    .sort();
}

(async () => {
  const files = await listRawFixtures();
  console.log(`schema version: ${SCHEMA_VERSION}`);
  console.log(`fixtures: ${files.length}\n`);

  let validCount = 0;
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    const raw = JSON.parse(await fs.readFile(path.join(FIXTURES_DIR, file), 'utf8')) as RawTrial;
    const normalized = normalizeProtocol(raw);
    const parsed = Protocol.safeParse(normalized);

    const counts =
      `phase=${normalized.phase} ` +
      `studyType=${normalized.studyType} ` +
      `outcomes=${normalized.primaryOutcomes.length} ` +
      `eligibility=${normalized.eligibilityCriteria.length} ` +
      `interventions=${normalized.interventions.length}`;

    if (parsed.success) {
      console.log(`✓ ${id}  ${counts}`);
      validCount++;
    } else {
      console.log(`✗ ${id}  ${counts}`);
      for (const issue of parsed.error.issues) {
        console.log(`    ${issue.path.join('.') || '(root)'}: ${issue.message}`);
      }
    }

    const outPath = path.join(FIXTURES_DIR, `${id}.normalized.json`);
    await fs.writeFile(outPath, JSON.stringify(normalized, null, 2) + '\n', 'utf8');
  }

  console.log(`\n${validCount}/${files.length} normalized outputs validate against v1 schema`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
