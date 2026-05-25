import { z } from 'zod';

export const SCHEMA_VERSION = 'v1.0.0' as const;

export const Phase = z.enum([
  'EARLY_PHASE_1',
  'PHASE_1',
  'PHASE_1_2',
  'PHASE_2',
  'PHASE_2_3',
  'PHASE_3',
  'PHASE_4',
  'NA',
]);
export type Phase = z.infer<typeof Phase>;

export const StudyType = z.enum(['INTERVENTIONAL', 'OBSERVATIONAL', 'EXPANDED_ACCESS']);
export type StudyType = z.infer<typeof StudyType>;

export const EligibilityType = z.enum(['INCLUSION', 'EXCLUSION']);
export type EligibilityType = z.infer<typeof EligibilityType>;

export const EligibilityCategory = z.enum(['DEMOGRAPHIC', 'MEDICAL', 'PROCEDURAL', 'OTHER']);
export type EligibilityCategory = z.infer<typeof EligibilityCategory>;

export const EligibilityItem = z.object({
  type: EligibilityType,
  description: z.string().min(3),
  category: EligibilityCategory.optional(),
});
export type EligibilityItem = z.infer<typeof EligibilityItem>;

export const PrimaryOutcome = z.object({
  measure: z.string().min(1),
  timeFrame: z.string().optional(),
  description: z.string().optional(),
});
export type PrimaryOutcome = z.infer<typeof PrimaryOutcome>;

export const InterventionType = z.enum(['DRUG', 'DEVICE', 'BEHAVIORAL', 'PROCEDURE', 'OTHER']);
export type InterventionType = z.infer<typeof InterventionType>;

export const Intervention = z.object({
  type: InterventionType,
  name: z.string().min(1),
  dosage: z.string().optional(),
});
export type Intervention = z.infer<typeof Intervention>;

export const Protocol = z
  .object({
    phase: Phase,
    studyType: StudyType,
    primaryOutcomes: z.array(PrimaryOutcome).min(1),
    eligibilityCriteria: z.array(EligibilityItem),
    interventions: z.array(Intervention),
  })
  .refine((p) => (p.studyType === 'INTERVENTIONAL' ? p.interventions.length > 0 : true), {
    message: 'Interventional studies must have at least one intervention',
    path: ['interventions'],
  });

export type Protocol = z.infer<typeof Protocol>;
