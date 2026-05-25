// Normalizes a raw ClinicalTrials.gov v2 JSON into the v1 Protocol shape we
// use as ground truth. The parsing here is intentionally simple — a header
// split for eligibility text, a literal map for phases / study type / drug
// type. Anything ambiguous becomes `OTHER` so the schema still validates.
//
// "Cleverness" lives in the LLM extractor, not here. The normalizer is a
// fixed, dumb baseline so eval scores compare apples to apples.

import type { RawTrial } from './types';
import type {
  EligibilityCategory,
  EligibilityItem,
  EligibilityType,
  Intervention,
  InterventionType,
  Phase,
  PrimaryOutcome,
  Protocol,
  StudyType,
} from '@/schemas/v1/protocol';

export function mapPhase(phases: string[] | undefined): Phase {
  const p = (phases ?? []).map((x) => x.toUpperCase());
  if (p.length === 0) return 'NA';
  if (p.includes('NA')) return 'NA';
  if (p.includes('EARLY_PHASE1') || p.includes('EARLY_PHASE_1')) return 'EARLY_PHASE_1';
  const has1 = p.some((x) => x === 'PHASE1' || x === 'PHASE_1');
  const has2 = p.some((x) => x === 'PHASE2' || x === 'PHASE_2');
  const has3 = p.some((x) => x === 'PHASE3' || x === 'PHASE_3');
  const has4 = p.some((x) => x === 'PHASE4' || x === 'PHASE_4');
  if (has1 && has2) return 'PHASE_1_2';
  if (has2 && has3) return 'PHASE_2_3';
  if (has1) return 'PHASE_1';
  if (has2) return 'PHASE_2';
  if (has3) return 'PHASE_3';
  if (has4) return 'PHASE_4';
  return 'NA';
}

export function mapStudyType(t: string | undefined): StudyType {
  switch ((t ?? '').toUpperCase()) {
    case 'INTERVENTIONAL':
      return 'INTERVENTIONAL';
    case 'OBSERVATIONAL':
    case 'PATIENT_REGISTRY':
      return 'OBSERVATIONAL';
    case 'EXPANDED_ACCESS':
      return 'EXPANDED_ACCESS';
    default:
      return 'OBSERVATIONAL';
  }
}

const DRUG_TYPES = new Set(['DRUG', 'BIOLOGICAL', 'COMBINATION_PRODUCT']);
const DEVICE_TYPES = new Set(['DEVICE', 'DIAGNOSTIC_TEST']);
const BEHAVIORAL_TYPES = new Set(['BEHAVIORAL']);
const PROCEDURE_TYPES = new Set(['PROCEDURE', 'RADIATION', 'GENETIC']);

export function mapInterventionType(t: string | undefined): InterventionType {
  const u = (t ?? '').toUpperCase();
  if (DRUG_TYPES.has(u)) return 'DRUG';
  if (DEVICE_TYPES.has(u)) return 'DEVICE';
  if (BEHAVIORAL_TYPES.has(u)) return 'BEHAVIORAL';
  if (PROCEDURE_TYPES.has(u)) return 'PROCEDURE';
  return 'OTHER';
}

// Splits the eligibilityCriteria free-text into typed items.
// Recognized formats:
//   "Inclusion Criteria:\n\n* item\n* item\n\nExclusion Criteria:\n* item"
//   numbered "1. item\n2. item"
//   plain prose (treated as a single INCLUSION item if no markers)
export function parseEligibility(raw: string | undefined): EligibilityItem[] {
  const text = (raw ?? '').trim();
  if (!text) return [];

  const sections: Array<{ type: EligibilityType; body: string }> = [];
  const incRe = /Inclusion\s+Criteria\s*:?/i;
  const excRe = /Exclusion\s+Criteria\s*:?/i;
  const incMatch = text.match(incRe);
  const excMatch = text.match(excRe);

  if (incMatch && excMatch) {
    const incStart = incMatch.index! + incMatch[0].length;
    const excStart = excMatch.index! + excMatch[0].length;
    if (incMatch.index! < excMatch.index!) {
      sections.push({ type: 'INCLUSION', body: text.slice(incStart, excMatch.index!) });
      sections.push({ type: 'EXCLUSION', body: text.slice(excStart) });
    } else {
      sections.push({ type: 'EXCLUSION', body: text.slice(excStart, incMatch.index!) });
      sections.push({ type: 'INCLUSION', body: text.slice(incStart) });
    }
  } else if (incMatch) {
    sections.push({ type: 'INCLUSION', body: text.slice(incMatch.index! + incMatch[0].length) });
  } else if (excMatch) {
    sections.push({ type: 'EXCLUSION', body: text.slice(excMatch.index! + excMatch[0].length) });
  } else {
    sections.push({ type: 'INCLUSION', body: text });
  }

  const items: EligibilityItem[] = [];
  for (const sec of sections) {
    for (const desc of splitBullets(sec.body)) {
      if (desc.length < 3) continue;
      items.push({ type: sec.type, description: desc, category: classifyCategory(desc) });
    }
  }
  return items;
}

function splitBullets(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const items: string[] = [];
  let current: string[] = [];
  const startRe = /^\s*(?:[*\-•]|\d+\.\s|\d+\))\s+/;

  const flush = () => {
    const joined = current.join(' ').replace(/\s+/g, ' ').trim();
    if (joined) items.push(joined);
    current = [];
  };

  for (const lineRaw of lines) {
    const line = lineRaw.replace(/\\>/g, '>').replace(/\\</g, '<');
    if (startRe.test(line)) {
      flush();
      current.push(line.replace(startRe, ''));
    } else if (line.trim() === '') {
      flush();
    } else {
      current.push(line.trim());
    }
  }
  flush();

  // Fallback: if nothing matched bullet/number markers, treat each non-empty
  // line / sentence as its own item so observational prose still produces > 0
  // criteria.
  if (items.length === 0) {
    const cleaned = body.replace(/\s+/g, ' ').trim();
    if (cleaned) items.push(cleaned);
  }
  return items;
}

const DEMOGRAPHIC_RE = /\b(age|years?|female|male|sex|gender|adult|child|pediatric|pregnan|race|ethnic)\b/i;
const PROCEDURAL_RE = /\b(consent|protocol|informed|signed|enrol|enroll|able to comply|willing to)\b/i;
function classifyCategory(desc: string): EligibilityCategory | undefined {
  if (DEMOGRAPHIC_RE.test(desc)) return 'DEMOGRAPHIC';
  if (PROCEDURAL_RE.test(desc)) return 'PROCEDURAL';
  // Default to MEDICAL — most criteria describe medical state. Leave
  // truly-unclassifiable as undefined.
  return 'MEDICAL';
}

export function normalizeProtocol(raw: RawTrial): Protocol {
  const ps = raw.protocolSection ?? {};
  const phase = mapPhase(ps.designModule?.phases);
  const studyType = mapStudyType(ps.designModule?.studyType);

  const primaryOutcomes: PrimaryOutcome[] = (ps.outcomesModule?.primaryOutcomes ?? [])
    .filter((o): o is { measure: string; description?: string; timeFrame?: string } =>
      typeof o?.measure === 'string' && o.measure.trim().length > 0,
    )
    .map((o) => ({
      measure: o.measure.trim(),
      timeFrame: o.timeFrame?.trim() || undefined,
      description: o.description?.trim() || undefined,
    }));

  const interventions: Intervention[] = (ps.armsInterventionsModule?.interventions ?? [])
    .filter((i): i is { type?: string; name?: string; description?: string } =>
      typeof i?.name === 'string' && i.name.trim().length > 0,
    )
    .map((i) => ({
      type: mapInterventionType(i.type),
      name: i.name!.trim(),
      // We don't have a structured dosage on the API; leave undefined.
    }));

  const eligibilityCriteria = parseEligibility(ps.eligibilityModule?.eligibilityCriteria);

  return {
    phase,
    studyType,
    primaryOutcomes,
    eligibilityCriteria,
    interventions,
  };
}
