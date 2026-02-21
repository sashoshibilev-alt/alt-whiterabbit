/**
 * Suggestion Engine v2
 *
 * Section-based suggestion generation for high-quality plan mutations
 * and execution artifacts with hard quality gates.
 *
 * Pipeline:
 * 1. Preprocessing: Parse markdown, annotate lines, segment into sections
 * 2. Classification: Classify section intent and determine actionability
 * 3. Synthesis: Generate suggestion titles, payloads, and evidence spans
 * 4. Validation: Run V2-V3 quality validators (hard gates)
 * 5. Scoring: Compute confidence scores and threshold pruning
 * 6. Routing: Attach to initiatives or mark as create_new
 */

import type {
  NoteInput,
  GeneratorContext,
  GeneratorConfig,
  GeneratorResult,
  GeneratorDebugInfo,
  Suggestion,
  Section,
  ClassifiedSection,
  DEFAULT_CONFIG,
} from './types';
import { DEFAULT_CONFIG as defaultConfig } from './types';
import { preprocessNote, resetSectionCounter } from './preprocessing';
import { classifySections, filterActionableSections } from './classifiers';
import { synthesizeSuggestions, resetSuggestionCounter, shouldSplitByTopic, splitSectionByTopic, checkSectionSuppression } from './synthesis';
import { runQualityValidators } from './validators';
import { runScoringPipeline, refineSuggestionScores } from './scoring';
import { routeSuggestions, computeRoutingStats } from './routing';
import { seedCandidatesFromBSignals, resetBSignalCounter } from './bSignalSeeding';
import { shouldSuppressProcessSentence } from './processNoiseSuppression';
import { extractDenseParagraphCandidates, resetDenseParagraphCounter } from './denseParagraphExtraction';

// Re-export types
export * from './types';

// Re-export debug types and utilities
export * from './debugTypes';
export {
  redactText,
  makePreview,
  makeTextPreviewFromLines,
  makeEvidenceDebug,
  resolveDebugVerbosity,
  shouldPersistDebug,
  shouldIncludeDebugInResponse,
  DEFAULT_DEBUG_VERBOSITY,
} from './debugRedaction';
export type { DebugFeatureFlags, DebugUserContext, DebugEnvContext } from './debugRedaction';
export { DebugLedger, createDebugLedger, sectionToDebug, GENERATOR_VERSION } from './DebugLedger';
export { generateSuggestionsWithDebug } from './debugGenerator';
export type { DebugGeneratorOptions, DebugGeneratorResult } from './debugGenerator';

// Re-export modules for advanced usage
export { preprocessNote } from './preprocessing';
export { classifySections, classifySection, classifyIntent, classifyType, filterActionableSections, isActionable, computeActionabilitySignals, isPlanChangeIntentLabel, isPlanChangeCandidate, hasPlanChangeEligibility, classifySectionWithLLM, classifySectionsWithLLM } from './classifiers';
export type { LLMClassificationOptions } from './classifiers';
export { classifyIntentWithLLM, classifyTypeWithLLM, blendIntentScores, MockLLMProvider } from './llmClassifiers';
export type { LLMProvider, LLMIntentResponse, LLMTypeResponse } from './llmClassifiers';
export { synthesizeSuggestions, synthesizeSuggestion } from './synthesis';
export {
  runQualityValidators,
  validateV2AntiVacuity,
  validateV3EvidenceSanity,
} from './validators';
export {
  runScoringPipeline,
  refineSuggestionScores,
  passesThresholds,
  isPlanChangeSuggestion,
  isHighConfidence,
  computeClarificationReasons,
  applyConfidenceBasedProcessing,
  rankingScore,
} from './scoring';
export { groupSuggestionsForDisplay } from './presentation';
export type { SuggestionBucket, GroupedSuggestions, GroupSuggestionsOptions } from './presentation';
export { routeSuggestions, routeSuggestion, computeRoutingStats } from './routing';
export {
  evaluateNote,
  evaluateBatch,
  analyzeThresholdSensitivity,
  generateReport,
  quickEvaluate,
} from './evaluation';

// ============================================
// Grounding Invariant
// ============================================

/**
 * Returns true if the suggestion's primary evidence text is grounded in the
 * section's raw_text (case-insensitive). For multi-line evidence spans, every
 * non-empty line must appear in the section's raw_text individually, since span
 * text joins selected lines with '\n' while raw_text may have blank lines between them.
 *
 * Only applied to B-signal seeded candidates (metadata.source === 'b-signal'), where
 * hallucination risk is highest. Regular synthesis derives evidence from body_lines
 * which are inherently verbatim from the source and may undergo intentional normalization
 * (e.g. status-marker stripping) that makes verbatim checking unreliable.
 */
export function isSuggestionGrounded(suggestion: Suggestion, section: Section): boolean {
  // Only enforce for B-signal and dense-paragraph seeded candidates where
  // hallucination risk is highest.  Regular synthesis derives evidence from
  // body_lines verbatim and may undergo intentional normalization that makes
  // verbatim checking unreliable.
  const source = suggestion.metadata?.source;
  if (source !== 'b-signal' && source !== 'dense-paragraph') return true;

  const evidenceText =
    suggestion.evidence_spans[0]?.text ||
    suggestion.suggestion?.evidencePreview?.[0];
  if (!evidenceText) return false;
  const haystack = section.raw_text.toLowerCase();
  const lines = evidenceText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return false;
  // Every non-empty line of the evidence must appear in the section raw_text
  return lines.every(line => haystack.includes(line.toLowerCase()));
}

// ============================================
// Main Generator Function
// ============================================

/**
 * Generate suggestions from a note.
 *
 * This is the main public API of the suggestion engine v2.
 *
 * @param note - The note to analyze
 * @param context - Optional context (initiatives for routing, etc.)
 * @param config - Optional configuration overrides
 * @returns GeneratorResult with suggestions and optional debug info
 */
export function generateSuggestions(
  note: NoteInput,
  context?: GeneratorContext,
  config?: Partial<GeneratorConfig>
): GeneratorResult {
  // Reset counters for deterministic IDs (useful for testing)
  resetSectionCounter();
  resetSuggestionCounter();
  resetBSignalCounter();
  resetDenseParagraphCounter();

  // Merge config with defaults
  const finalConfig: GeneratorConfig = {
    ...defaultConfig,
    ...config,
    thresholds: {
      ...defaultConfig.thresholds,
      ...config?.thresholds,
    },
  };

  // Initialize debug info
  const debug: GeneratorDebugInfo = {
    sections_count: 0,
    actionable_sections_count: 0,
    suggestions_before_validation: 0,
    v2_drops: 0,
    v3_drops: 0,
    suggestions_after_validation: 0,
    suggestions_after_scoring: 0,
    routing_attached: 0,
    routing_create_new: 0,
    dropped_suggestions: [],
    // New fields per suggestion-suppression-fix plan
    plan_change_count: 0,
    plan_change_emitted_count: 0,
    low_confidence_downgraded_count: 0,
    high_confidence_count: 0,
    invariant_plan_change_always_emitted: true,
  };

  // ============================================
  // Stage 1: Preprocessing
  // ============================================
  const { lines, sections } = preprocessNote(note);
  debug.sections_count = sections.length;

  if (sections.length === 0) {
    return buildResult([], debug, finalConfig.enable_debug);
  }

  // ============================================
  // Stage 2: Classification
  // ============================================
  const classifiedSections = classifySections(sections, finalConfig.thresholds);
  const actionableSections = filterActionableSections(classifiedSections);
  debug.actionable_sections_count = actionableSections.length;

  if (actionableSections.length === 0) {
    return buildResult([], debug, finalConfig.enable_debug);
  }

  // ============================================
  // Stage 2.5: Topic Isolation (Before Synthesis)
  // ============================================
  // Split mixed-topic sections into topic-isolated subsections BEFORE synthesis
  // This ensures subsections go through normal synthesis instead of fallback path
  const expandedSections: ClassifiedSection[] = [];
  for (const section of actionableSections) {
    if (shouldSplitByTopic(section)) {
      const subsections = splitSectionByTopic(section);
      expandedSections.push(...subsections);
    } else {
      expandedSections.push(section);
    }
  }

  // ============================================
  // Stage 3: Synthesis
  // ============================================
  const synthesizedSuggestions = synthesizeSuggestions(expandedSections);
  debug.suggestions_before_validation = synthesizedSuggestions.length;

  if (synthesizedSuggestions.length === 0) {
    return buildResult([], debug, finalConfig.enable_debug);
  }

  // Build section lookup map (include both original classified sections and expanded subsections)
  const sectionMap = new Map<string, ClassifiedSection>();
  for (const section of classifiedSections) {
    sectionMap.set(section.section_id, section);
  }
  // Add expanded subsections to map
  for (const section of expandedSections) {
    if (!sectionMap.has(section.section_id)) {
      sectionMap.set(section.section_id, section);
    }
  }

  // ============================================
  // Stage 4: Validation (Hard Gates V2-V3)
  // ============================================
  const validatedSuggestions: Suggestion[] = [];

  for (const suggestion of synthesizedSuggestions) {
    try {
      let section = sectionMap.get(suggestion.section_id);

      // Handle topic-isolated sub-sections: if section not found, try parent section
      if (!section && suggestion.section_id.includes('__topic_')) {
        const parentId = suggestion.section_id.split('__topic_')[0];
        section = sectionMap.get(parentId);
      }

      if (!section) {
        debug.dropped_suggestions.push({
          section_id: suggestion.section_id,
          reason: 'Section not found',
        });
        continue;
      }

      const validationResult = runQualityValidators(
        suggestion,
        section,
        finalConfig.thresholds,
        section.typeLabel
      );

      if (validationResult.passed) {
        // Store validation results in suggestion
        suggestion.validation_results = validationResult.results;
        validatedSuggestions.push(suggestion);
      } else {
        // Track drop
        const validator = validationResult.failedValidator;
        if (validator === 'V2_anti_vacuity') debug.v2_drops++;
        else if (validator === 'V3_evidence_sanity') debug.v3_drops++;

        debug.dropped_suggestions.push({
          section_id: suggestion.section_id,
          reason: validationResult.failureReason || 'Validation failed',
          validator: validator,
        });
      }
    } catch (error) {
      // Capture validation errors in debug mode
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (finalConfig.enable_debug) {
        console.error('[VALIDATION_ERROR]', {
          suggestionId: suggestion.suggestion_id,
          sectionId: suggestion.section_id,
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
      debug.dropped_suggestions.push({
        section_id: suggestion.section_id,
        reason: `Internal error: ${errorMessage.substring(0, 100)}`,
      });
    }
  }

  debug.suggestions_after_validation = validatedSuggestions.length;

  // Note: do NOT early-exit here even if validatedSuggestions is empty.
  // B-signal seeding (Stage 4.5) runs for all actionable sections and may
  // produce bug/risk candidates even when normal synthesis was fully suppressed.

  // ============================================
  // Stage 4.5: B-Signal Candidate Seeding (additive)
  // ============================================
  // For each actionable section, extract B-signals and append novel candidates
  // (those not already covered by existing evidence) to the validated list.
  // Runs for ALL actionable sections — not just those with validated candidates.
  // This ensures bug/risk B-signals are emitted even when normal synthesis is
  // dropped by V4 (heading-only) or other validators for that section.
  for (const section of expandedSections) {
    // Suppressed sections (e.g., "Next Steps", "Summary") must not seed B-signal candidates.
    // Without this guard, a future extractor change could reintroduce process-noise suggestions
    // from sections that synthesis already refuses to touch.
    const headingText = section.heading_text?.trim() ?? '';
    const hasForceRoleAssignment = section.intent.flags?.forceRoleAssignment ?? false;
    if (checkSectionSuppression(headingText, section.structural_features, section.raw_text, hasForceRoleAssignment, section.body_lines)) {
      continue;
    }

    // Collect evidence texts already covered by existing validated candidates for this section
    const coveredTexts = new Set<string>();
    for (const existing of validatedSuggestions) {
      if (existing.section_id !== section.section_id) continue;
      for (const span of existing.evidence_spans) {
        coveredTexts.add(span.text.trim());
      }
      // Also check body text in suggestion context
      if (existing.suggestion?.body) {
        coveredTexts.add(existing.suggestion.body.trim());
      }
    }

    const bSignalCandidates = seedCandidatesFromBSignals(section);
    for (const candidate of bSignalCandidates) {
      // Skip if this signal's sentence is already covered by an existing candidate
      const signalSentence = candidate.evidence_spans[0]?.text?.trim() ?? '';
      if (signalSentence && coveredTexts.has(signalSentence)) continue;
      validatedSuggestions.push(candidate);
    }
  }

  // ============================================
  // Stage 4.55: Dense Paragraph Candidate Extraction (additive)
  // ============================================
  // For sections that qualify (no bullets, single line or >=250 chars, no topic
  // anchors), split the body into sentence spans and emit one candidate per
  // signal-bearing sentence.  Runs after normal synthesis + B-signal seeding so
  // it only fills gaps left by those two passes.
  for (const section of expandedSections) {
    // Collect evidence texts already covered for this section
    const dpCoveredTexts = new Set<string>();
    for (const existing of validatedSuggestions) {
      if (existing.section_id !== section.section_id) continue;
      for (const span of existing.evidence_spans) {
        dpCoveredTexts.add(span.text.trim());
      }
    }

    const dpCandidates = extractDenseParagraphCandidates(section, dpCoveredTexts);
    for (const candidate of dpCandidates) {
      validatedSuggestions.push(candidate);
    }
  }

  // ============================================
  // Stage 4.6: Grounding Invariant (anti-hallucination hard gate)
  // ============================================
  const groundedSuggestions: Suggestion[] = [];
  for (const suggestion of validatedSuggestions) {
    const section =
      sectionMap.get(suggestion.section_id) ||
      (suggestion.section_id.includes('__topic_')
        ? sectionMap.get(suggestion.section_id.split('__topic_')[0])
        : undefined);

    if (!section || isSuggestionGrounded(suggestion, section)) {
      groundedSuggestions.push(suggestion);
    } else {
      if (finalConfig.enable_debug) {
        const evidenceSnippet = (
          suggestion.evidence_spans[0]?.text ||
          suggestion.suggestion?.evidencePreview?.[0] ||
          ''
        ).substring(0, 80);
        console.error('[GROUNDING_INVARIANT_DROP]', {
          suggestionId: suggestion.suggestion_id,
          sectionId: suggestion.section_id,
          evidenceSnippet,
        });
      }
      debug.dropped_suggestions.push({
        section_id: suggestion.section_id,
        reason: 'UNGROUNDED_EVIDENCE',
      });
    }
  }

  // ============================================
  // Stage 4.7: Process Noise Suppression
  // ============================================
  // Candidate-level suppression: drop any candidate whose primary evidence text
  // is process/ownership ambiguity noise (e.g., "ambiguity around who owns sign-off").
  // Applied after grounding check to cover both normal synthesis and B-signal candidates.
  const noiseFilteredSuggestions: Suggestion[] = [];
  for (const suggestion of groundedSuggestions) {
    const evidenceText =
      suggestion.evidence_spans[0]?.text ||
      suggestion.suggestion?.body ||
      '';
    const titleText = suggestion.title;

    if (shouldSuppressProcessSentence(evidenceText) || shouldSuppressProcessSentence(titleText)) {
      debug.dropped_suggestions.push({
        section_id: suggestion.section_id,
        reason: 'PROCESS_NOISE',
      });
    } else {
      noiseFilteredSuggestions.push(suggestion);
    }
  }

  // ============================================
  // Stage 5: Scoring & Thresholding
  // ============================================
  const scoringResult = runScoringPipeline(
    noiseFilteredSuggestions,
    sectionMap,
    finalConfig
  );

  debug.suggestions_after_scoring = scoringResult.suggestions.length;
  debug.low_confidence_downgraded_count = scoringResult.downgraded_to_clarification || 0;

  // Track plan_change metrics per suggestion-suppression-fix plan
  const planChangeBeforeScoring = noiseFilteredSuggestions.filter(s => s.type === 'project_update').length;
  const planChangeAfterScoring = scoringResult.suggestions.filter(s => s.type === 'project_update').length;
  debug.plan_change_count = planChangeBeforeScoring;
  debug.plan_change_emitted_count = planChangeAfterScoring;
  debug.high_confidence_count = scoringResult.suggestions.filter(s => s.is_high_confidence).length;
  
  // Verify invariant: plan_change suggestions must never be dropped by scoring.
  // planChangeAfterScoring may exceed planChangeBeforeScoring when scoring normalizes
  // idea-typed candidates to project_update — that is correct behavior, not a violation.
  debug.invariant_plan_change_always_emitted = (planChangeAfterScoring >= planChangeBeforeScoring);
  if (!debug.invariant_plan_change_always_emitted) {
    console.error('INVARIANT VIOLATED: plan_change suggestions were dropped by scoring!',
      `Before: ${planChangeBeforeScoring}, After: ${planChangeAfterScoring}`);
  }

  // Add score-based drops to debug
  for (const dropped of scoringResult.dropped) {
    debug.dropped_suggestions.push({
      section_id: dropped.suggestion.section_id,
      reason: dropped.reason,
    });
  }

  if (scoringResult.suggestions.length === 0) {
    return buildResult([], debug, finalConfig.enable_debug);
  }

  // ============================================
  // Stage 6: Routing
  // ============================================
  const initiatives = context?.initiatives || [];
  const routedSuggestions = routeSuggestions(
    scoringResult.suggestions,
    initiatives,
    finalConfig.thresholds
  );

  // Compute routing stats
  const routingStats = computeRoutingStats(routedSuggestions);
  debug.routing_attached = routingStats.attached;
  debug.routing_create_new = routingStats.create_new;

  return buildResult(routedSuggestions, debug, finalConfig.enable_debug);
}

/**
 * Build the final result object
 */
function buildResult(
  suggestions: Suggestion[],
  debug: GeneratorDebugInfo,
  includeDebug: boolean
): GeneratorResult {
  const result: GeneratorResult = {
    suggestions,
  };

  if (includeDebug) {
    result.debug = debug;
  }

  return result;
}

// ============================================
// Convenience Adapters
// ============================================

/**
 * Adapter to convert from Convex note format to engine format
 */
export function adaptConvexNote(convexNote: {
  _id: string;
  body: string;
  createdAt: number;
  title?: string;
}): NoteInput {
  return {
    note_id: convexNote._id,
    raw_markdown: convexNote.body,
    authored_at: new Date(convexNote.createdAt).toISOString(),
  };
}

/**
 * Adapter to convert from Convex initiative format to engine format
 */
export function adaptConvexInitiative(convexInitiative: {
  _id: string;
  title: string;
  status: string;
  description: string;
}): import('./types').InitiativeSnapshot {
  return {
    id: convexInitiative._id,
    title: convexInitiative.title,
    description: convexInitiative.description,
    status: convexInitiative.status,
  };
}

/**
 * Convert engine suggestion to human-readable content string
 */
export function suggestionToContent(suggestion: Suggestion): string {
  if (suggestion.type === 'project_update') {
    const desc = suggestion.payload.after_description || '';
    return `${suggestion.title}\n\n${desc}`;
  } else {
    const draft = suggestion.payload.draft_initiative;
    if (!draft) return suggestion.title;
    return `${suggestion.title}\n\n${draft.description}`;
  }
}

/**
 * Get a summary string for a suggestion (for display)
 */
export function getSuggestionSummary(suggestion: Suggestion): string {
  const routeInfo = suggestion.routing.create_new
    ? '[New Initiative]'
    : `[Update: ${suggestion.routing.attached_initiative_id}]`;

  return `${routeInfo} ${suggestion.title} (score: ${suggestion.scores.overall.toFixed(2)})`;
}

// ============================================
// Quick Utilities
// ============================================

/**
 * Check if a note would produce any suggestions (cheap pre-check)
 */
export function hasActionableContent(note: NoteInput): boolean {
  const { sections } = preprocessNote(note);
  if (sections.length === 0) return false;

  const classified = classifySections(sections, defaultConfig.thresholds);
  const actionable = filterActionableSections(classified);

  return actionable.length > 0;
}

/**
 * Get section count for a note (for analytics)
 */
export function getSectionCount(note: NoteInput): {
  total: number;
  actionable: number;
} {
  const { sections } = preprocessNote(note);
  const classified = classifySections(sections, defaultConfig.thresholds);
  const actionable = filterActionableSections(classified);

  return {
    total: sections.length,
    actionable: actionable.length,
  };
}
