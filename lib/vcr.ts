// VCR-style cache for LLM eval calls. When `EVAL_VCR=1` is set (typically by
// the eval harness, never the live app), `withVcrCache` first checks an
// on-disk cache keyed by the prompt-version + schema-version + a caller-supplied
// fingerprint of the input. A hit returns the cached value at $0 and ~0ms; a
// miss runs the real call and writes the result to the cache. Cached files
// live under `evals/cache/` (gitignored) and are safe to delete to force a
// re-run.
//
// Cache invalidation is the caller's responsibility: bump PROMPT_VERSION or
// SCHEMA_VERSION when the prompt or schema changes, and the cache key
// changes too, so stale answers are skipped automatically.
//
// When this is and is NOT a fit:
//   ✅ Single-shot `generateObject` against a fixed corpus — perfect, the
//      eval is a pure function of (prompt-version, schema-version, input).
//   ⚠ `streamObject` with streaming-time metrics (time-to-first-field,
//      partial-render safety) — a replay loses those metrics; only cache
//      the final object if the eval doesn't depend on stream dynamics.
//   ❌ Agent loops that call non-deterministic tools (GitHub API, web
//      search) — tool results can drift between runs; caching the agent
//      trajectory at this layer would hide that drift from the eval.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CACHE_DIR = path.join(process.cwd(), 'evals', 'cache');

export function isVcrEnabled(): boolean {
  return process.env.EVAL_VCR === '1';
}

export interface VcrKeyParts {
  model: string;
  promptVersion: string;
  schemaVersion: string;
  fingerprint: string;
  mode?: string;
}

function hashKey(parts: VcrKeyParts): string {
  const h = crypto.createHash('sha256');
  h.update(parts.model);
  h.update('|');
  h.update(parts.promptVersion);
  h.update('|');
  h.update(parts.schemaVersion);
  h.update('|');
  h.update(parts.mode ?? '');
  h.update('|');
  h.update(parts.fingerprint);
  return h.digest('hex').slice(0, 32);
}

export function fingerprintInput(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export async function withVcrCache<T>(
  key: VcrKeyParts,
  run: () => Promise<T>,
): Promise<{ value: T; cached: boolean }> {
  if (!isVcrEnabled()) {
    return { value: await run(), cached: false };
  }
  const file = path.join(CACHE_DIR, `${hashKey(key)}.json`);
  if (fs.existsSync(file)) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    return { value: parsed, cached: true };
  }
  const value = await run();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return { value, cached: false };
}
