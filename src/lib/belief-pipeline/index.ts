/**
 * Belief-First Reasoning Pipeline
 * 
 * Public API exports
 */

// Main pipeline function
export { executeBeliefPipeline, stages } from './pipeline';

// Types
export type {
  MeetingNote,
  NormalizedMeetingNote,
  Section,
  SectionType,
  Utterance,
  BeliefDimension,
  BeliefSourceType,
  BeliefConfidenceBand,
  EvidenceSpanRole,
  UtteranceLabel,
  ChangeRole,
  BeliefEvidenceSpan,
  UtteranceClassification,
  BeliefCandidate,
  ClarificationReason,
  Belief,
  BeliefScoringFeatures,
  BeliefExtractionResult,
  BeliefPipelineConfig,
  Stage1Output,
  Stage2Output,
  Stage3Output,
  Stage4Output,
  Stage5Output,
} from './types';

// Configuration
export { DEFAULT_PIPELINE_CONFIG } from './types';

// Utilities (for testing and debugging)
export {
  generateId,
  clamp01,
  normalizeLineEndings,
  stripBoilerplate,
  stringSimilarity,
  normalizeSubjectHandle,
  isVagueSubjectHandle,
  hasAmbiguousTimeline,
  hasAmbiguousScope,
  mean,
  max,
  groupBy,
} from './utils';
