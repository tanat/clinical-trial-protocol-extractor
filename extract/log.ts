import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

import type { ValidationStatus } from './extract';

const DB_PATH = path.resolve(process.cwd(), 'logs/extractions.sqlite');

let _db: Database.Database | null = null;

function ensureDir() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function initDb(): Database.Database {
  if (_db) return _db;
  ensureDir();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS extractions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      trial_id TEXT,
      schema_version TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      model TEXT NOT NULL,
      input_chars INTEGER NOT NULL,
      output_json TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      validation_errors TEXT,
      per_field_scores TEXT,
      latency_ms INTEGER NOT NULL,
      tokens_in INTEGER NOT NULL,
      tokens_out INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_extractions_trial ON extractions(trial_id);
    CREATE INDEX IF NOT EXISTS idx_extractions_prompt ON extractions(prompt_version);
    CREATE INDEX IF NOT EXISTS idx_extractions_ts ON extractions(ts);
  `);
  _db = db;
  return db;
}

export type ExtractionLogEntry = {
  trialId: string | null;
  schemaVersion: string;
  promptVersion: string;
  model: string;
  inputChars: number;
  outputJson: unknown;
  validationStatus: ValidationStatus;
  validationErrors: Array<{ path: string; message: string }> | null;
  perFieldScores: Record<string, unknown> | null;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
};

export function logExtraction(entry: ExtractionLogEntry): void {
  const db = initDb();
  db.prepare(
    `INSERT INTO extractions (
      ts, trial_id, schema_version, prompt_version, model,
      input_chars, output_json, validation_status, validation_errors,
      per_field_scores, latency_ms, tokens_in, tokens_out
    ) VALUES (
      @ts, @trial_id, @schema_version, @prompt_version, @model,
      @input_chars, @output_json, @validation_status, @validation_errors,
      @per_field_scores, @latency_ms, @tokens_in, @tokens_out
    )`,
  ).run({
    ts: new Date().toISOString(),
    trial_id: entry.trialId,
    schema_version: entry.schemaVersion,
    prompt_version: entry.promptVersion,
    model: entry.model,
    input_chars: entry.inputChars,
    output_json: JSON.stringify(entry.outputJson ?? null),
    validation_status: entry.validationStatus,
    validation_errors: entry.validationErrors ? JSON.stringify(entry.validationErrors) : null,
    per_field_scores: entry.perFieldScores ? JSON.stringify(entry.perFieldScores) : null,
    latency_ms: entry.latencyMs,
    tokens_in: entry.tokensIn ?? 0,
    tokens_out: entry.tokensOut ?? 0,
  });
}
