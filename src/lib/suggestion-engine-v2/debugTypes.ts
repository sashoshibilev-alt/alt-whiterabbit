/**
 * Suggestion Debug Report - Type Definitions
 *
 * Shared TypeScript enums and interfaces for the debug report pipeline.
 * Used by both backend (Convex) and frontend (React).
 */

// ============================================
// Core Enums
// ============================================

/**
 * Debug verbosity levels
 * - OFF: No debug data collected/stored (prod default)
 * - REDACTED: Store only redacted previews, line ranges, scores, decisions
 * - FULL_TEXT: Store full text (dev-only, behind env flag)
 */
export type DebugVerbosity = "OFF" | "REDACTED" | "FULL_TEXT";

/**
 * Pipeline stages where a section or candidate can be dropped
 */
export enum DropStage {
  SEGMENTATION = "SEGMENTATION",
  ACTIONABILITY = "ACTIONABILITY",
  TYPE = "TYPE",
  TOPIC_ISOLATION = "TOPIC_ISOLATION",
  SYNTHESIS = "SYNTHESIS",
  EVIDENCE = "EVIDENCE",
  VALIDATION = "VALIDATION",
  THRESHOLD = "THRESHOLD",
  DEDUPE = "DEDUPE",
  POST_SYNTHESIS_SUPPRESS = "POST_SYNTHESIS_SUPPRESS",
}

/**
 * Specific reasons why a section or candidate was dropped
 */
export enum DropReason {
  NOT_ACTIONABLE = "NOT_ACTIONABLE",
  OUT_OF_SCOPE = "OUT_OF_SCOPE",
  TYPE_LOW_CONFIDENCE = "TYPE_LOW_CONFIDENCE",
  SYNTHESIS_FAILED = "SYNTHESIS_FAILED",
  EVIDENCE_NOT_LOCATABLE = "EVIDENCE_NOT_LOCATABLE",
  VALIDATION_V2_TOO_GENERIC = "VALIDATION_V2_TOO_GENERIC",
  VALIDATION_V3_EVIDENCE_TOO_WEAK = "VALIDATION_V3_EVIDENCE_TOO_WEAK",
  VALIDATION_V4_HEADING_ONLY = "VALIDATION_V4_HEADING_ONLY",
  SCORE_BELOW_THRESHOLD = "SCORE_BELOW_THRESHOLD",
  DUPLICATE_FINGERPRINT = "DUPLICATE_FINGERPRINT",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  LOW_RELEVANCE = "LOW_RELEVANCE",
  SUPPRESSED_SECTION = "SUPPRESSED_SECTION",
  SPLIT_INTO_SUBSECTIONS = "SPLIT_INTO_SUBSECTIONS",
  UNGROUNDED_EVIDENCE = "UNGROUNDED_EVIDENCE",
  PROCESS_NOISE = "PROCESS_NOISE",
}

/**
 * Non-blocking drop reasons: these are informational only and should NOT
 * appear in "Top reasons" or cause suggestions to be marked as dropped.
 * Kept as empty set for extensibility.
 */
export const NON_BLOCKING_DROP_REASONS: ReadonlySet<DropReason> = new Set([
]);

/**
 * Explicit mapping from DropReason to DropStage
 */
export const DROP_REASON_STAGE: Record<DropReason, DropStage> = {
  [DropReason.NOT_ACTIONABLE]: DropStage.ACTIONABILITY,
  [DropReason.OUT_OF_SCOPE]: DropStage.ACTIONABILITY,
  [DropReason.TYPE_LOW_CONFIDENCE]: DropStage.TYPE,
  [DropReason.SYNTHESIS_FAILED]: DropStage.SYNTHESIS,
  [DropReason.EVIDENCE_NOT_LOCATABLE]: DropStage.EVIDENCE,
  [DropReason.VALIDATION_V2_TOO_GENERIC]: DropStage.VALIDATION,
  [DropReason.VALIDATION_V3_EVIDENCE_TOO_WEAK]: DropStage.VALIDATION,
  [DropReason.VALIDATION_V4_HEADING_ONLY]: DropStage.VALIDATION,
  [DropReason.SCORE_BELOW_THRESHOLD]: DropStage.THRESHOLD,
  [DropReason.DUPLICATE_FINGERPRINT]: DropStage.DEDUPE,
  [DropReason.INTERNAL_ERROR]: DropStage.VALIDATION,
  [DropReason.LOW_RELEVANCE]: DropStage.POST_SYNTHESIS_SUPPRESS,
  [DropReason.SUPPRESSED_SECTION]: DropStage.POST_SYNTHESIS_SUPPRESS,
  [DropReason.SPLIT_INTO_SUBSECTIONS]: DropStage.TOPIC_ISOLATION,
  [DropReason.UNGROUNDED_EVIDENCE]: DropStage.VALIDATION,
  [DropReason.PROCESS_NOISE]: DropStage.POST_SYNTHESIS_SUPPRESS,
};

// ============================================
// Thresholds and Config Snapshot
// ============================================

/**
 * Thresholds used during suggestion generation
 */
export interface ThresholdsUsed {
  actionabilityMinScore: number;
  typeMinScore: number;
  synthesisMinScore: number;
  evidenceMinScore: number;
  validationMinScore: number;
  overallMinScore: number;
}

/**
 * Validation model configuration
 */
export interface ValidationModelsConfig {
  v2: string;
  v3: string;
}

/**
 * Snapshot of configuration at time of generation
 */
export interface ConfigSnapshot {
  generatorVersion: string;
  thresholds: ThresholdsUsed;
  classificationModel: string;
  typeModel: string;
  synthesisModel: string;
  validationModels: ValidationModelsConfig;
  dedupeEnabled: boolean;
  maxSuggestionsPerNote: number;
  additionalFlags?: Record<string, boolean | number | string>;
}

// ============================================
// Classifier Outputs and Scores
// ============================================

/**
 * Distribution of classifier probabilities
 */
export interface ClassifierDistribution {
  topLabel: string;
  topScore: number;
  scoresByLabel: Record<string, number>;
  rawOutput?: unknown;
  // Routing flags (stored separately to avoid contaminating scoresByLabel)
  flags?: {
    forceRoleAssignment?: boolean;
    forceDecisionMarker?: boolean;
  };
}

/**
 * Structural features summary for a section
 */
export interface StructuralFeaturesSummary {
  lineCount: number;
  charCount: number;
  bulletCount: number;
  headingLevel?: number;
  extras?: Record<string, number | string | boolean>;
}

/**
 * Result from a single validator (V2/V3)
 */
export interface ValidatorResult {
  name: "V2_GENERICITY" | "V3_EVIDENCE" | string;
  passed: boolean;
  score?: number;
  reason?: string;
}

/**
 * Score breakdown for a candidate
 */
export interface ScoreBreakdown {
  actionabilityScore?: number;
  typeScore?: number;
  synthesisScore?: number;
  evidenceScore?: number;
  validationScore?: number;
  overallScore: number;
}

// ============================================
// Evidence and Previews
// ============================================

/**
 * Evidence span preview (redacted)
 */
export interface EvidenceSpanPreview {
  lineIndex: number;
  preview: string;
}

/**
 * Evidence debug information
 */
export interface EvidenceDebug {
  lineIds: number[];
  spans: EvidenceSpanPreview[];
}

/**
 * Text preview with line range
 */
export interface TextPreview {
  lineRange: [number, number];
  preview: string;
}

// ============================================
// Candidate Suggestion Debug
// ============================================

/**
 * Debug information for a single candidate suggestion
 */
export interface CandidateSuggestionDebug {
  candidateId: string;
  emitted: boolean;
  dropStage: DropStage | null;
  dropReason: DropReason | null;

  // Generated content (redacted based on verbosity)
  suggestionPreview: TextPreview | null;
  rawSuggestionText?: string; // FULL_TEXT only

  // Structured suggestion context (for UI consumption)
  suggestion?: {
    title: string;
    body: string;
    evidencePreview?: string[];
    sourceSectionId: string;
    sourceHeading: string;
  };

  // Model I/O (summarized)
  synthesisInputPreview?: TextPreview | null;
  synthesisRawOutput?: unknown;

  evidence?: EvidenceDebug;
  validatorResults: ValidatorResult[];
  scoreBreakdown: ScoreBreakdown;

  metadata?: Record<string, unknown>;
}

// ============================================
// Section Debug
// ============================================

/**
 * Debug information for a single section
 */
export interface SectionDebug {
  sectionId: string;
  headingTextPreview: string;
  lineRange: [number, number];

  structuralFeatures: StructuralFeaturesSummary;

  intentClassification: ClassifierDistribution;
  typeClassification: ClassifierDistribution;

  decisions: {
    isActionable: boolean;
    intentLabel: string;
    typeLabel: string;
    /** Detailed actionability decision info */
    actionabilityReason?: string;
  };

  /**
   * Actionability signals computed from intent classification
   * actionableSignal = max(plan_change, new_workstream)
   * outOfScopeSignal = max(calendar, communication, micro_tasks)
   * 
   * Note: research is excluded from outOfScopeSignal to allow high-research
   * sections with concrete execution language to be treated as actionable.
   */
  actionabilitySignals?: {
    actionableSignal: number;
    outOfScopeSignal: number;
    /** T_action threshold used */
    actionabilityThreshold: number;
    /** T_out_of_scope threshold used */
    outOfScopeThreshold: number;
  };

  synthesisRan: boolean;

  candidates: CandidateSuggestionDebug[];

  evidenceSummary?: EvidenceDebug;

  validatorSummary?: {
    v2?: ValidatorResult;
    v3?: ValidatorResult;
  };

  scoreSummary: ScoreBreakdown;

  emitted: boolean;
  dropStage: DropStage | null;
  dropReason: DropReason | null;

  errorMessage?: string;
  errorStage?: DropStage;

  /** Additional metadata (e.g., topic isolation debug info) */
  metadata?: Record<string, unknown>;
}

// ============================================
// Debug Run
// ============================================

/**
 * Metadata for a debug run
 */
export interface DebugRunMetadata {
  noteId: string;
  runId: string;
  generatorVersion: string;
  createdAt: string; // ISO timestamp
  createdByUserId?: string;
  verbosity: DebugVerbosity;
  runtimeFingerprint?: string; // Runtime code version fingerprint
  /** Hash of note markdown content (djb2, hex). Used for change detection. */
  noteHash?: string;
}

/**
 * Complete debug run report
 */
export interface DebugRun {
  /** Root-level fingerprint to verify patched code is running */
  __fingerprint?: string;
  meta: DebugRunMetadata;
  config: ConfigSnapshot;

  noteSummary: {
    lineCount: number;
    preview?: TextPreview;
  };

  sections: SectionDebug[];

  runtimeStats?: {
    totalMs: number;
    stageMs?: Partial<Record<DropStage, number>>;
  };
}

// ============================================
// Summary Types (for UI)
// ============================================

/**
 * Summary statistics for a debug run
 */
export interface DebugRunSummary {
  emittedCount: number;
  totalSections: number;
  dropStageHistogram: Partial<Record<DropStage, number>>;
  dropReasonTop: { reason: DropReason; count: number }[];
  // Aggregation metrics (per fix-plan-change-suppression plan)
  emittedCandidatesCount: number;
  droppedCandidatesCount: number;
  // Plan_change-specific metrics (per fix-plan-change-drops plan)
  planChangeSectionsCount: number;
  droppedPlanChangeCount: number; // candidate-level, should be 0 after fixes
}

/**
 * Compute summary statistics from a debug run
 */
export function computeDebugRunSummary(debugRun: DebugRun): DebugRunSummary {
  const sections = debugRun.sections;

  let emittedCount = 0;
  let emittedCandidatesCount = 0;
  let droppedCandidatesCount = 0;
  let planChangeSectionsCount = 0;
  let droppedPlanChangeCount = 0;
  const dropStageHistogram: Partial<Record<DropStage, number>> = {};
  const dropReasonCounts: Partial<Record<DropReason, number>> = {};

  for (const section of sections) {
    // Detect plan_change sections by intentLabel
    const isPlanChangeSection = section.decisions.intentLabel === 'plan_change';
    if (isPlanChangeSection) {
      planChangeSectionsCount++;
    }

    if (section.emitted) {
      emittedCount++;
    } else if (section.dropStage) {
      dropStageHistogram[section.dropStage] =
        (dropStageHistogram[section.dropStage] || 0) + 1;
    }

    if (section.dropReason && !NON_BLOCKING_DROP_REASONS.has(section.dropReason)) {
      dropReasonCounts[section.dropReason] =
        (dropReasonCounts[section.dropReason] || 0) + 1;
    }

    // Count candidate-level aggregation (per fix-plan-change-suppression plan)
    for (const candidate of section.candidates) {
      if (candidate.emitted) {
        emittedCandidatesCount++;
      } else {
        droppedCandidatesCount++;
        
        // Track dropped plan_change candidates (should be 0 after fixes)
        if (isPlanChangeSection) {
          droppedPlanChangeCount++;
        }
        
        if (candidate.dropStage) {
          dropStageHistogram[candidate.dropStage] =
            (dropStageHistogram[candidate.dropStage] || 0) + 1;
        }
        if (candidate.dropReason && !NON_BLOCKING_DROP_REASONS.has(candidate.dropReason)) {
          dropReasonCounts[candidate.dropReason] =
            (dropReasonCounts[candidate.dropReason] || 0) + 1;
        }
      }
    }
  }

  // Sort drop reasons by count
  const dropReasonTop = Object.entries(dropReasonCounts)
    .map(([reason, count]) => ({ reason: reason as DropReason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    emittedCount,
    totalSections: sections.length,
    dropStageHistogram,
    dropReasonTop,
    emittedCandidatesCount,
    droppedCandidatesCount,
    planChangeSectionsCount,
    droppedPlanChangeCount,
  };
}
