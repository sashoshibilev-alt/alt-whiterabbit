/**
 * Suggestion Debug Report - DebugLedger
 *
 * The DebugLedger tracks all decisions and intermediate states during
 * suggestion generation. It builds a complete DebugRun report.
 */

import {
  DropStage,
  DropReason,
  DROP_REASON_STAGE,
  type DebugRun,
  type DebugRunMetadata,
  type DebugVerbosity,
  type ConfigSnapshot,
  type SectionDebug,
  type CandidateSuggestionDebug,
  type StructuralFeaturesSummary,
  type ClassifierDistribution,
  type ValidatorResult,
  type ScoreBreakdown,
  type EvidenceDebug,
  type TextPreview,
  type ThresholdsUsed,
} from "./debugTypes";
import {
  makePreview,
  makeTextPreviewFromLines,
  makeEvidenceDebug,
  sanitizeForJson,
} from "./debugRedaction";
import type {
  Section,
  ClassifiedSection,
  Suggestion,
  IntentClassification,
  ValidationResult as EngineValidationResult,
  SuggestionScores,
  ThresholdConfig,
  GeneratorConfig,
} from "./types";

// ============================================
// UUID Generator (simple implementation)
// ============================================

function generateUUID(): string {
  // Simple UUID v4-like generator (not cryptographically secure, but sufficient for debug IDs)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================
// Generator Version and Runtime Fingerprint
// ============================================

export const GENERATOR_VERSION = "suggestion-engine-v2.1-debug-FP3";
export const RUNTIME_FINGERPRINT = `FP3:planchange-protection-v3:${Date.now()}`;

// ============================================
// DebugLedger Class
// ============================================

export interface DebugLedgerOptions {
  noteId: string;
  noteBody: string;
  verbosity: DebugVerbosity;
  config: GeneratorConfig;
  userId?: string;
}

/**
 * Compute djb2 hash of a string (same algorithm as computeNoteHash in index.ts).
 * Returns 8-character lowercase hex string.
 */
function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 33) + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export class DebugLedger {
  private runId: string;
  private noteId: string;
  private noteLines: string[];
  private noteHash: string;
  private verbosity: DebugVerbosity;
  private config: GeneratorConfig;
  private userId?: string;
  private startTime: number;
  private sections: Map<string, SectionDebug>;
  private stageTimings: Partial<Record<DropStage, number>>;
  private globalError?: Error;

  constructor(options: DebugLedgerOptions) {
    this.runId = generateUUID();
    this.noteId = options.noteId;
    this.noteLines = options.noteBody.split("\n");
    this.noteHash = djb2Hash(options.noteBody);
    this.verbosity = options.verbosity;
    this.config = options.config;
    this.userId = options.userId;
    this.startTime = Date.now();
    this.sections = new Map();
    this.stageTimings = {};
  }

  /**
   * Check if debug is active (not OFF)
   */
  isActive(): boolean {
    return this.verbosity !== "OFF";
  }

  /**
   * Get count of candidates currently marked as emitted (before finalize)
   * Used for invariant checks during aggregation
   */
  peekEmittedCount(): number {
    let count = 0;
    for (const section of this.sections.values()) {
      count += section.candidates.filter(c => c.emitted).length;
    }
    return count;
  }

  // ============================================
  // Section Management
  // ============================================

  /**
   * Create a new SectionDebug record
   */
  createSection(args: {
    sectionId: string;
    headingText?: string;
    lineRange: [number, number];
    structuralFeatures: StructuralFeaturesSummary;
  }): SectionDebug {
    const sectionDebug: SectionDebug = {
      sectionId: args.sectionId,
      headingTextPreview: args.headingText
        ? makePreview(args.headingText, 80)
        : "",
      lineRange: args.lineRange,
      structuralFeatures: args.structuralFeatures,
      intentClassification: {
        topLabel: "",
        topScore: 0,
        scoresByLabel: {},
      },
      typeClassification: {
        topLabel: "",
        topScore: 0,
        scoresByLabel: {},
      },
      decisions: {
        isActionable: false,
        intentLabel: "",
        typeLabel: "",
      },
      synthesisRan: false,
      candidates: [],
      scoreSummary: { overallScore: 0 },
      emitted: false,
      dropStage: null,
      dropReason: null,
      metadata: {},
    };

    this.sections.set(args.sectionId, sectionDebug);
    return sectionDebug;
  }

  /**
   * Get an existing section debug record
   */
  getSection(sectionId: string): SectionDebug | undefined {
    return this.sections.get(sectionId);
  }

  // ============================================
  // Classification Stage Hooks
  // ============================================

  /**
   * Record intent classification results
   */
  afterIntentClassification(
    section: SectionDebug,
    intentOutput: IntentClassification,
    isActionable: boolean,
    actionabilityReason?: string,
    actionabilitySignals?: {
      actionableSignal: number;
      outOfScopeSignal: number;
    }
  ): void {
    if (!this.isActive()) return;

    // Filter out non-numeric properties (flags) to maintain intent scoring contract
    // Only include actual intent scores in scoresByLabel
    const entries = Object.entries(intentOutput)
      .filter(([key, value]) => key !== 'flags' && typeof value === 'number') as [string, number][];
    const sorted = entries.sort((a, b) => b[1] - a[1]);
    const [topLabel, topScore] = sorted[0] || ["unknown", 0];

    section.intentClassification = {
      topLabel,
      topScore,
      scoresByLabel: Object.fromEntries(entries),
    };

    // Store flags separately at top level if present
    if (intentOutput.flags) {
      section.intentClassification.flags = intentOutput.flags;
    }

    section.decisions.isActionable = isActionable;
    section.decisions.intentLabel = topLabel;
    section.decisions.actionabilityReason = actionabilityReason;

    // Record actionability signals for debugging
    if (actionabilitySignals) {
      section.actionabilitySignals = {
        actionableSignal: actionabilitySignals.actionableSignal,
        outOfScopeSignal: actionabilitySignals.outOfScopeSignal,
        actionabilityThreshold: this.config.thresholds.T_action,
        outOfScopeThreshold: this.config.thresholds.T_out_of_scope,
      };

      // Fix debug consistency: use computed actionableSignal instead of topScore
      // This ensures scoreSummary.actionabilityScore matches actionabilitySignals.actionableSignal
      if (!isActionable && actionabilityReason) {
        section.scoreSummary.actionabilityScore = actionabilitySignals.actionableSignal;
      }
    } else if (!isActionable && actionabilityReason) {
      // Fallback to topScore if actionabilitySignals not provided (shouldn't happen in normal flow)
      section.scoreSummary.actionabilityScore = topScore;
    }
  }

  /**
   * Record type classification results
   */
  afterTypeClassification(
    section: SectionDebug,
    typeLabel: string,
    typeConfidence: number
  ): void {
    if (!this.isActive()) return;

    section.typeClassification = {
      topLabel: typeLabel,
      topScore: typeConfidence,
      scoresByLabel: { [typeLabel]: typeConfidence },
    };

    section.decisions.typeLabel = typeLabel;
    section.scoreSummary.typeScore = typeConfidence;
  }

  // ============================================
  // Synthesis Stage Hooks
  // ============================================

  /**
   * Record successful synthesis
   */
  afterSynthesis(
    section: SectionDebug,
    suggestion: Suggestion
  ): CandidateSuggestionDebug {
    if (!this.isActive()) {
      return this.createMinimalCandidate(suggestion.suggestion_id);
    }

    section.synthesisRan = true;

    const candidateDebug: CandidateSuggestionDebug = {
      candidateId: suggestion.suggestion_id,
      emitted: true, // Assume emitted until proven otherwise
      dropStage: null,
      dropReason: null,
      suggestionPreview: {
        lineRange: [0, 0],
        preview: makePreview(suggestion.title, 160),
      },
      // Include structured suggestion context for UI consumption
      suggestion: suggestion.suggestion ? {
        title: suggestion.suggestion.title,
        body: suggestion.suggestion.body,
        evidencePreview: suggestion.suggestion.evidencePreview,
        sourceSectionId: suggestion.suggestion.sourceSectionId,
        sourceHeading: suggestion.suggestion.sourceHeading,
      } : undefined,
      validatorResults: [],
      scoreBreakdown: {
        overallScore: suggestion.scores?.overall || 0,
        actionabilityScore: suggestion.scores?.section_actionability,
        typeScore: suggestion.scores?.type_choice_confidence,
        synthesisScore: suggestion.scores?.synthesis_confidence,
      },
      metadata: {
        type: suggestion.type,
        routing: suggestion.routing,
      },
    };

    // Add raw text for FULL_TEXT verbosity
    if (this.verbosity === "FULL_TEXT") {
      candidateDebug.rawSuggestionText = suggestion.title;
    }

    // Add evidence if available
    if (suggestion.evidence_spans && suggestion.evidence_spans.length > 0) {
      const lineIds = suggestion.evidence_spans.map((s) => s.start_line);
      candidateDebug.evidence = makeEvidenceDebug(lineIds, this.noteLines);
    }

    section.candidates.push(candidateDebug);
    return candidateDebug;
  }

  /**
   * Record synthesis failure
   */
  afterSynthesisFailure(section: SectionDebug, error: Error): void {
    if (!this.isActive()) return;

    section.synthesisRan = true;

    const candidateDebug: CandidateSuggestionDebug = {
      candidateId: `synthesis-failed-${section.sectionId}`,
      emitted: false,
      dropStage: DropStage.SYNTHESIS,
      dropReason: DropReason.SYNTHESIS_FAILED,
      suggestionPreview: null,
      validatorResults: [],
      scoreBreakdown: { overallScore: 0 },
      metadata: { error: error.message },
    };

    section.candidates.push(candidateDebug);
    section.emitted = false;
    section.dropStage = DropStage.SYNTHESIS;
    section.dropReason = DropReason.SYNTHESIS_FAILED;
    section.errorMessage = error.message;
    section.errorStage = DropStage.SYNTHESIS;
  }

  // ============================================
  // Evidence Stage Hooks
  // ============================================

  /**
   * Record evidence extraction results
   */
  afterEvidenceExtraction(
    section: SectionDebug,
    suggestion: Suggestion
  ): void {
    if (!this.isActive()) return;

    const candidate = this.findCandidate(section, suggestion.suggestion_id);
    if (!candidate) return;

    if (suggestion.evidence_spans && suggestion.evidence_spans.length > 0) {
      const lineIds = suggestion.evidence_spans.map((s) => s.start_line);
      candidate.evidence = makeEvidenceDebug(lineIds, this.noteLines);
      section.evidenceSummary = candidate.evidence;
    }
  }

  // ============================================
  // Validation Stage Hooks
  // ============================================

  /**
   * Record validation results
   */
  afterValidation(
    section: SectionDebug,
    suggestion: Suggestion,
    validationResults: EngineValidationResult[]
  ): void {
    if (!this.isActive()) return;

    const candidate = this.findCandidate(section, suggestion.suggestion_id);
    if (!candidate) return;

    // Map engine validation results to debug format
    const mappedResults = validationResults.map((r) => ({
      name: r.validator.replace("_", "_").toUpperCase(),
      passed: r.passed,
      reason: r.reason,
    }));

    // Deduplicate by (name, passed, reason)
    const seen = new Set<string>();
    candidate.validatorResults = mappedResults.filter((r) => {
      const key = `${r.name}|${r.passed}|${r.reason || ''}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    // Build validator summary
    section.validatorSummary = {
      v2: candidate.validatorResults.find((r) =>
        r.name.includes("V2")
      ) as ValidatorResult | undefined,
      v3: candidate.validatorResults.find((r) =>
        r.name.includes("V3")
      ) as ValidatorResult | undefined,
    };
  }

  // ============================================
  // Scoring Stage Hooks
  // ============================================

  /**
   * Record scoring results
   */
  afterScoring(
    section: SectionDebug,
    suggestion: Suggestion,
    scores: SuggestionScores
  ): void {
    if (!this.isActive()) return;

    const candidate = this.findCandidate(section, suggestion.suggestion_id);
    if (!candidate) return;

    candidate.scoreBreakdown = {
      actionabilityScore: scores.section_actionability,
      typeScore: scores.type_choice_confidence,
      synthesisScore: scores.synthesis_confidence,
      overallScore: scores.overall,
    };

    // Reflect post-scoring type override in debug metadata.
    // scoring.ts may have changed type (e.g., idea → project_update via
    // isPlanChangeCandidate) AFTER synthesis recorded the original type.
    if (candidate.metadata && suggestion.type !== candidate.metadata.type) {
      candidate.metadata = { ...candidate.metadata, type: suggestion.type };
    }

    // Update section summary
    section.scoreSummary = {
      actionabilityScore: scores.section_actionability,
      typeScore: scores.type_choice_confidence,
      synthesisScore: scores.synthesis_confidence,
      overallScore: scores.overall,
    };
  }

  // ============================================
  // Drop Tracking
  // ============================================

  /**
   * Mark a section as dropped
   */
  dropSection(section: SectionDebug, reason: DropReason): void {
    section.emitted = false;
    section.dropReason = reason;
    section.dropStage = DROP_REASON_STAGE[reason];

    // Mark all candidates as dropped too
    for (const candidate of section.candidates) {
      if (candidate.emitted) {
        candidate.emitted = false;
        candidate.dropReason = reason;
        candidate.dropStage = DROP_REASON_STAGE[reason];
      }
    }
  }

  /**
   * Mark a specific candidate as dropped
   */
  dropCandidate(
    section: SectionDebug,
    suggestionId: string,
    reason: DropReason
  ): void {
    const candidate = this.findCandidate(section, suggestionId);
    if (candidate) {
      candidate.emitted = false;
      candidate.dropReason = reason;
      candidate.dropStage = DROP_REASON_STAGE[reason];
    }

    // If no emitted candidates remain, mark section as dropped
    if (!section.candidates.some((c) => c.emitted)) {
      section.emitted = false;
      section.dropReason = reason;
      section.dropStage = DROP_REASON_STAGE[reason];
    }
  }

  /**
   * Mark a candidate as dropped by ID (across all sections)
   */
  dropCandidateById(candidateId: string, reason: DropReason): void {
    for (const section of this.sections.values()) {
      const candidate = section.candidates.find(
        (c) => c.candidateId === candidateId
      );
      if (candidate) {
        candidate.emitted = false;
        candidate.dropReason = reason;
        candidate.dropStage = DROP_REASON_STAGE[reason];

        // Check if section should be dropped
        if (!section.candidates.some((c) => c.emitted)) {
          section.emitted = false;
          section.dropReason = reason;
          section.dropStage = DROP_REASON_STAGE[reason];
        }
        return;
      }
    }
  }

  /**
   * Mark a section as having an internal error
   */
  markSectionInternalError(
    section: SectionDebug,
    stage: DropStage,
    error: Error
  ): void {
    section.errorStage = stage;
    section.errorMessage = error.message;
    section.emitted = false;
    section.dropReason = DropReason.INTERNAL_ERROR;
    section.dropStage = stage;
  }

  /**
   * Mark a global error affecting the entire run
   */
  markGlobalError(error: Error): void {
    this.globalError = error;

    // Mark all sections with internal error
    for (const section of this.sections.values()) {
      if (section.emitted) {
        section.emitted = false;
        section.dropReason = DropReason.INTERNAL_ERROR;
        section.dropStage = DropStage.VALIDATION;
        section.errorMessage = error.message;
      }
    }
  }

  // ============================================
  // Finalization
  // ============================================

  /**
   * Finalize the debug run with emitted suggestions
   */
  finalize(emittedSuggestionIds: string[]): void {
    const emittedSet = new Set(emittedSuggestionIds);

    // HARD INVARIANT CHECK: Validate topic isolation integrity before finalizing
    this.validateTopicIsolationIntegrity();

    for (const section of this.sections.values()) {
      let hasEmitted = false;

      for (const candidate of section.candidates) {
        if (emittedSet.has(candidate.candidateId)) {
          candidate.emitted = true;
          candidate.dropStage = null;
          candidate.dropReason = null;
          hasEmitted = true;
        } else if (candidate.emitted) {
          // Was marked as emitted but not in final list
          candidate.emitted = false;
          if (!candidate.dropReason) {
            // PLAN_CHANGE PROTECTION: If this was a project_update candidate,
            // treat as internal invariant issue rather than score-based drop
            const isPlanMutation = candidate.metadata?.type === 'project_update';
            candidate.dropReason = isPlanMutation
              ? DropReason.INTERNAL_ERROR
              : DropReason.SCORE_BELOW_THRESHOLD;
            candidate.dropStage = isPlanMutation
              ? DropStage.VALIDATION
              : DropStage.THRESHOLD;
          }
        }
      }

      section.emitted = hasEmitted;
      if (!hasEmitted && !section.dropReason) {
        // Section had no emitted candidates
        const isPlanChangeSection = section.decisions.intentLabel === 'plan_change';

        // Check if fallback was intentionally skipped (discussion details / long section)
        const fallbackSkipped = section.metadata?.fallbackSkipped;

        if (isPlanChangeSection && fallbackSkipped) {
          // PLAN_CHANGE with intentionally skipped fallback (discussion details / long section)
          // This is acceptable - mark as LOW_RELEVANCE not INTERNAL_ERROR
          section.dropReason = DropReason.LOW_RELEVANCE;
          section.dropStage = DropStage.POST_SYNTHESIS_SUPPRESS;
        } else if (isPlanChangeSection) {
          // PLAN_CHANGE PROTECTION: Unexpected 0 candidates without fallback skip
          // This indicates a real issue - mark as INTERNAL_ERROR
          section.dropReason = DropReason.INTERNAL_ERROR;
          section.dropStage = DropStage.VALIDATION;
        } else {
          // Non-plan_change section with 0 candidates
          section.dropReason = DropReason.SCORE_BELOW_THRESHOLD;
          section.dropStage = DropStage.THRESHOLD;
        }
      }
    }
  }

  /**
   * Validate topic isolation integrity
   * Ensures that if a parent section is marked SPLIT_INTO_SUBSECTIONS,
   * then subsections exist in the ledger and parent has topicSplit metadata
   */
  private validateTopicIsolationIntegrity(): void {
    for (const section of this.sections.values()) {
      // Check if section is marked as split
      if (section.dropReason === DropReason.SPLIT_INTO_SUBSECTIONS) {
        // Verify topicSplit metadata exists
        const hasTopicSplitMetadata = section.metadata?.topicSplit !== undefined;

        if (!hasTopicSplitMetadata) {
          console.error('[TOPIC_ISOLATION_INVARIANT_VIOLATION] Parent marked as SPLIT but missing topicSplit metadata:', {
            sectionId: section.sectionId,
            dropReason: section.dropReason,
            metadata: section.metadata,
          });

          // RECOVERY: Mark as INTERNAL_ERROR to prevent silent success
          section.dropReason = DropReason.INTERNAL_ERROR;
          section.dropStage = DropStage.TOPIC_ISOLATION;
          section.metadata = {
            ...section.metadata,
            topicIsolationFailure: {
              reason: 'missing_topicSplit_metadata',
            },
          };
          continue;
        }

        // Verify subsections exist in ledger
        const topicSplitMetadata = section.metadata.topicSplit as any;
        const expectedSubsectionIds: string[] = topicSplitMetadata.subSectionIds || [];
        const actualSubsections = expectedSubsectionIds.filter(id => this.sections.has(id));

        if (actualSubsections.length === 0) {
          console.error('[TOPIC_ISOLATION_INVARIANT_VIOLATION] Parent marked as SPLIT but no subsections found in ledger:', {
            sectionId: section.sectionId,
            expectedSubsectionIds,
            actualSubsections,
          });

          // RECOVERY: Mark as INTERNAL_ERROR
          section.dropReason = DropReason.INTERNAL_ERROR;
          section.dropStage = DropStage.TOPIC_ISOLATION;
          section.metadata = {
            ...section.metadata,
            topicIsolationFailure: {
              reason: 'subsections_not_in_ledger',
              expectedSubsectionIds,
              actualSubsectionCount: actualSubsections.length,
            },
          };
        }
      }
    }
  }

  /**
   * Record stage timing
   */
  recordStageTiming(stage: DropStage, durationMs: number): void {
    this.stageTimings[stage] = durationMs;
  }

  // ============================================
  // Build Final Report
  // ============================================

  /**
   * Build the final DebugRun report
   */
  buildDebugRun(): DebugRun {
    const endTime = Date.now();

    const meta: DebugRunMetadata = {
      noteId: this.noteId,
      runId: this.runId,
      generatorVersion: GENERATOR_VERSION,
      createdAt: new Date().toISOString(),
      createdByUserId: this.userId,
      verbosity: this.verbosity,
      runtimeFingerprint: RUNTIME_FINGERPRINT,
      noteHash: this.noteHash,
    };

    const config = this.buildConfigSnapshot();

    const noteSummary = {
      lineCount: this.noteLines.length,
      preview:
        this.verbosity !== "OFF"
          ? makeTextPreviewFromLines(
              this.noteLines,
              [0, Math.min(5, this.noteLines.length - 1)],
              300
            )
          : undefined,
    };

    const sections = Array.from(this.sections.values());

    const runtimeStats = {
      totalMs: endTime - this.startTime,
      stageMs: this.stageTimings,
    };

    return sanitizeForJson({
      __fingerprint: `FP3:${GENERATOR_VERSION}:${Date.now()}`,
      meta,
      config,
      noteSummary,
      sections,
      runtimeStats,
    });
  }

  // ============================================
  // Helper Methods
  // ============================================

  private findCandidate(
    section: SectionDebug,
    suggestionId: string
  ): CandidateSuggestionDebug | undefined {
    return section.candidates.find((c) => c.candidateId === suggestionId);
  }

  private createMinimalCandidate(
    suggestionId: string
  ): CandidateSuggestionDebug {
    return {
      candidateId: suggestionId,
      emitted: true,
      dropStage: null,
      dropReason: null,
      suggestionPreview: null,
      validatorResults: [],
      scoreBreakdown: { overallScore: 0 },
    };
  }

  private buildConfigSnapshot(): ConfigSnapshot {
    const thresholds = this.config.thresholds;

    return {
      generatorVersion: GENERATOR_VERSION,
      thresholds: {
        actionabilityMinScore: thresholds.T_action,
        typeMinScore: thresholds.T_section_min,
        synthesisMinScore: 0.5, // Default
        evidenceMinScore: thresholds.MIN_EVIDENCE_CHARS / 100,
        validationMinScore: 0.5, // Default
        overallMinScore: thresholds.T_overall_min,
      },
      classificationModel: "rule-based-v2",
      typeModel: "rule-based-v2",
      synthesisModel: "rule-based-v2",
      validationModels: {
        v2: "V2_anti_vacuity",
        v3: "V3_evidence_sanity",
      },
      dedupeEnabled: true,
      maxSuggestionsPerNote: this.config.max_suggestions,
      additionalFlags: {
        enable_debug: this.config.enable_debug,
        use_llm_classifiers: this.config.use_llm_classifiers,
        embedding_enabled: this.config.embedding_enabled,
        planChangeProtection: true,
        runtimeFingerprint: RUNTIME_FINGERPRINT,
      },
    };
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create a DebugLedger if debug is enabled, otherwise return a no-op ledger
 */
export function createDebugLedger(
  options: DebugLedgerOptions
): DebugLedger | null {
  if (options.verbosity === "OFF") {
    return null;
  }
  return new DebugLedger(options);
}

// ============================================
// Helper to convert Section to SectionDebug
// ============================================

/**
 * Create a SectionDebug from an engine Section
 */
export function sectionToDebug(
  ledger: DebugLedger,
  section: Section
): SectionDebug {
  return ledger.createSection({
    sectionId: section.section_id,
    headingText: section.heading_text,
    lineRange: [section.start_line, section.end_line],
    structuralFeatures: {
      lineCount: section.structural_features.num_lines,
      charCount: section.raw_text.length,
      bulletCount: section.structural_features.num_list_items,
      headingLevel: section.heading_level,
      extras: {
        has_dates: section.structural_features.has_dates,
        has_metrics: section.structural_features.has_metrics,
        has_quarter_refs: section.structural_features.has_quarter_refs,
        initiative_phrase_density:
          section.structural_features.initiative_phrase_density,
      },
    },
  });
}
