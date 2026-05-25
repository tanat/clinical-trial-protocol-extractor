# Fixtures

Raw responses from `https://clinicaltrials.gov/api/v2/studies/{NCT_ID}?format=json`,
fetched once and committed. **Never refetch in eval runs or in CI.**

If you need a new trial, add the NCT id to `scripts/fetch-fixtures.ts` and run
it (`tsx scripts/fetch-fixtures.ts`); the helper caches to disk on first hit
so re-runs are no-ops. After fetching, run
`tsx scripts/normalize-ground-truth.ts` to (re)write the matching
`{NCT_ID}.normalized.json` files.

## Corpus (Phase 10 — 25 trials)

| NCT ID | Phase / type | Bucket | Why |
|--------|--------------|--------|-----|
| `NCT03737981` | Phase 3, interventional | Oncology | NCI cooperative-group trial adding venetoclax to standard chemo for AML — multi-drug `interventions[]`, real Phase 3, meaty detailed description with explicit eligibility paragraphs. |
| `NCT05593094` | Phase 1/2, interventional | Oncology | ZN-A-1041 enteric capsules in HER2+ advanced solid tumors — early-phase combo trial with lots of dosing arms. |
| `NCT00290251` | Phase 2, interventional | Oncology-adjacent | Selective progesterone-receptor modulator for uterine fibroids — exercises Phase 2 with 3 drug arms + placebo. |
| `NCT02057471` | Phase 4, interventional | Oncology / hematology | IV iron in anemic colorectal-surgery patients — pushes Phase 4 + a single intervention type. |
| `NCT00005133` | Observational | Cardiovascular | The Cardiovascular Health Study — long-running NIH cohort. Forces `studyType=OBSERVATIONAL` with no interventions and a long narrative description (~8k chars). API has no structured `primaryOutcomes`, so this row stresses the schema's `.min(1)` constraint and the eval handles it as a documented edge case. |
| `NCT01616381` | Phase 3, interventional | Cardiovascular | Sildenafil vs placebo in chronic HF + pulmonary hypertension — clean drug-vs-placebo Phase 3. |
| `NCT05946772` | Phase 2, interventional | Cardiovascular (rare) | Cyclosporine in Takotsubo syndrome — uncommon CV condition, off-label use. |
| `NCT02237495` | Phase 2/3, interventional | Cardiovascular (peri-op) | Dexmedetomidine outcomes in cardiac surgery (DOCS) — peri-operative trial; tests phase-2/3 mapping. |
| `NCT05993819` | NA, interventional | Neurology | CBT added to supervised Pilates in MS — combines BEHAVIORAL + OTHER intervention types. |
| `NCT07187739` | NA, interventional | Neurology | Mediterranean diet on nutrition in Parkinson's + DBS — non-pharmaceutical intervention. |
| `NCT00318929` | NA, interventional | Neurology | Divalproex ER in elderly epilepsy — older trial style, explicit Inclusion/Exclusion list. |
| `NCT03086486` | Phase 3, interventional | Infectious disease | Linezolid + bedaquiline + pretomanid for MDR-TB — multi-drug regimen Phase 3. |
| `NCT03227731` | Phase 2/3, interventional | Infectious disease (HIV) | Immediate vs deferred PrEP for HIV prevention — long detailed description (~7k), 3 primary outcomes. |
| `NCT00057629` | Phase 2/3, interventional | Mental health (PTSD) | Prolonged Exposure Therapy vs Present-Centered Therapy — exercises `Intervention.type=BEHAVIORAL`. |
| `NCT00648375` | Phase 4, interventional | Mental health (PTSD) | Propranolol for PTSD — drug intervention in psychiatric context. |
| `NCT04673851` | NA, interventional | Mental health (psychotic) | Horyzons online intervention in early schizophrenia — digital BEHAVIORAL intervention. |
| `NCT06619301` | Phase 3, interventional | Endocrine (pregnancy) | Glargine vs NPH in DM during pregnancy — short, focused description. |
| `NCT06489457` | Phase 3, interventional | Endocrine + obesity | Semaglutide vs testosterone replacement in T2DM/obesity — multi-condition Phase 3. |
| `NCT06948019` | Phase 1/2, interventional | Rare disease (neuro) | AAV9/AP4B1 (BFB-101) gene therapy for AP4B1-related SPG47 — single gene-therapy intervention, ultra-rare. |
| `NCT02378467` | NA, interventional | Rare disease (CF) | Hypertonic saline in CF preschoolers — pediatric + rare. |
| `NCT00794586` | Phase 2, interventional | Rare disease (CF) | Inhaled fosfomycin/tobramycin in CF — short description, drug combo. |
| `NCT05751044` | Phase 1/2, interventional | Pediatric (oncology) | HEM-iSMART-B in pediatric relapsed/refractory ALL/LBL — multi-drug arm + complex eligibility. |
| `NCT05586230` | Phase 1, interventional | Pediatric (infectious) | Pretomanid in pediatric rifampicin-resistant TB — pediatric + Phase 1. |
| `NCT01096901` | Early Phase 1, interventional | Behavioral / oncology prevention | Choose-to-Lose breast-cancer-risk weight-loss in women — pushes EARLY_PHASE_1. |
| `NCT05420766` | NA, interventional | Pediatric (asthma) | Sleep duration on immune balance in urban asthmatic children — pediatric, BEHAVIORAL. |

Coverage at a glance:
- study type — 24 INTERVENTIONAL, 1 OBSERVATIONAL
- phases — `EARLY_PHASE_1` ×1, `PHASE_1` ×1, `PHASE_1_2` ×4, `PHASE_2` ×4, `PHASE_2_3` ×4, `PHASE_3` ×6, `PHASE_4` ×2, `NA` ×3
- intervention types — DRUG (most), BEHAVIORAL (CBT, exposure therapy, online programs), DEVICE/PROCEDURE-adjacent (DBS-related diet study), OTHER (gene therapy)
- ages — pediatric, adult, older-adult bands all represented
- detailed-description lengths — 879c (`NCT00794586`) to 8059c (`NCT00005133`)

If you swap a fixture, update this table and re-run `pnpm eval`.
