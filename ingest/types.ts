// Permissive shape for raw ClinicalTrials.gov v2 responses.
// The API can add or shuffle fields between releases; we treat the bulk of
// the payload as `unknown` and only narrow the few paths the rest of the
// codebase actually reads.
export type RawTrial = {
  protocolSection?: {
    identificationModule?: {
      nctId?: string;
      briefTitle?: string;
      officialTitle?: string;
    };
    descriptionModule?: {
      briefSummary?: string;
      detailedDescription?: string;
    };
    conditionsModule?: {
      conditions?: string[];
    };
    designModule?: {
      studyType?: string;
      phases?: string[];
      enrollmentInfo?: { count?: number; type?: string };
    };
    eligibilityModule?: {
      eligibilityCriteria?: string;
      sex?: string;
      minimumAge?: string;
      maximumAge?: string;
      stdAges?: string[];
    };
    armsInterventionsModule?: {
      armGroups?: Array<{
        label?: string;
        type?: string;
        description?: string;
        interventionNames?: string[];
      }>;
      interventions?: Array<{
        type?: string;
        name?: string;
        description?: string;
        armGroupLabels?: string[];
      }>;
    };
    outcomesModule?: {
      primaryOutcomes?: Array<{
        measure?: string;
        description?: string;
        timeFrame?: string;
      }>;
      secondaryOutcomes?: Array<{
        measure?: string;
        description?: string;
        timeFrame?: string;
      }>;
    };
  };
  derivedSection?: unknown;
  hasResults?: boolean;
} & Record<string, unknown>;
