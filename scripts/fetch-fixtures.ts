// One-shot: fetches the curated NCT IDs into fixtures/trials/ via the cache.
// Re-running is a no-op once the JSONs exist.
import { fetchTrial } from '@/ingest/fetch-trial';

const NCT_IDS = [
  // Phase-2 corpus (5)
  'NCT03737981', // Phase 3 oncology interventional — venetoclax + standard chemo
  'NCT00005133', // Observational cardiovascular — Cardiovascular Health Study (CHS)
  'NCT06948019', // Phase 1/2 rare disease — AAV9/AP4B1 gene therapy (AP4B1-related SPG47)
  'NCT00057629', // Behavioral / psychiatric — Prolonged Exposure Therapy for PTSD
  'NCT05751044', // Pediatric (also Phase 1/2 oncology) — HEM-iSMART-B pediatric leukemia

  // Phase-10 expansion (20)
  // Oncology — 3 across phases
  'NCT05593094', // Phase 1/2 oncology — ZN-A-1041 in HER2+ advanced solid tumors
  'NCT00290251', // Phase 2 — selective progesterone-receptor modulator for uterine fibroids
  'NCT02057471', // Phase 4 — IV iron for anemic colorectal-surgery patients
  // Cardiovascular — 3
  'NCT01616381', // Phase 3 — sildenafil vs placebo in chronic HF + pulmonary hypertension
  'NCT05946772', // Phase 2 — cyclosporine in Takotsubo syndrome
  'NCT02237495', // Phase 2/3 — dexmedetomidine in cardiac surgery (DOCS)
  // Neurology — 3
  'NCT05993819', // NA — CBT added to supervised exercise in MS
  'NCT07187739', // NA — Mediterranean diet on nutrition in Parkinson's + DBS
  'NCT00318929', // NA — divalproex ER in elderly epilepsy
  // Infectious disease — 2
  'NCT03086486', // Phase 3 — linezolid + bedaquiline + pretomanid for MDR-TB
  'NCT03227731', // Phase 2/3 — immediate vs deferred HIV PrEP
  // Mental health — 2
  'NCT00648375', // Phase 4 — propranolol for PTSD
  'NCT04673851', // NA — Horyzons online intervention in early schizophrenia
  // Endocrine / metabolic — 2
  'NCT06619301', // Phase 3 — glargine vs NPH for DM in pregnancy
  'NCT06489457', // Phase 3 — semaglutide vs testosterone replacement in T2DM/obesity
  // Rare disease — 2 (cystic fibrosis variants)
  'NCT02378467', // NA — hypertonic saline in CF preschoolers
  'NCT00794586', // Phase 2 — inhaled fosfomycin/tobramycin in CF
  // Pediatric variants — 3
  'NCT05586230', // Phase 1 — pretomanid in pediatric rifampicin-resistant TB
  'NCT01096901', // Early Phase 1 — Choose-to-Lose breast-cancer-risk weight loss in women
  'NCT05420766', // NA — sleep duration on immune balance in urban asthmatic children
];

(async () => {
  for (const id of NCT_IDS) {
    const t = await fetchTrial(id);
    const ps = t.protocolSection;
    const detail = ps?.descriptionModule?.detailedDescription ?? '';
    const phases = (ps?.designModule?.phases ?? []).join(',') || '-';
    const studyType = ps?.designModule?.studyType ?? '?';
    console.log(
      `✓ ${id}  ${studyType}  phases=${phases}  detail=${detail.length}c  "${(ps?.identificationModule?.briefTitle ?? '').slice(0, 70)}"`,
    );
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
