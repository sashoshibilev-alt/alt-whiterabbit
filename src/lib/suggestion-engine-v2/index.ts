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
 * 4. Validation: Run V1-V3 quality validators (hard gates)
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
import { synthesizeSuggestions, resetSuggestionCounter } from './synthesis';
import { runQualityValidators } from './validators';
import { runScoringPipeline, refineSuggestionScores } from './scoring';
import { routeSuggestions, computeRoutingStats } from './routing';

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
export { classifySections, classifySection, classifyIntent, classifyType, filterActionableSections, isActionable, computeActionabilitySignals, isPlanChangeIntentLabel, classifySectionWithLLM, classifySectionsWithLLM } from './classifiers';
export type { LLMClassificationOptions } from './classifiers';
export { classifyIntentWithLLM, classifyTypeWithLLM, blendIntentScores, MockLLMProvider } from './llmClassifiers';
export type { LLMProvider, LLMIntentResponse, LLMTypeResponse } from './llmClassifiers';
export { synthesizeSuggestions, synthesizeSuggestion } from './synthesis';
export {
  runQualityValidators,
  validateV1ChangeTest,
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
} from './scoring';
export { routeSuggestions, routeSuggestion, computeRoutingStats } from './routing';
export {
  evaluateNote,
  evaluateBatch,
  analyzeThresholdSensitivity,
  generateReport,
  quickEvaluate,
} from './evaluation';

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
    v1_drops: 0,
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
  // Stage 3: Synthesis
  // ============================================
  const synthesizedSuggestions = synthesizeSuggestions(actionableSections);
  debug.suggestions_before_validation = synthesizedSuggestions.length;

  if (synthesizedSuggestions.length === 0) {
    return buildResult([], debug, finalConfig.enable_debug);
  }

  // Build section lookup map
  const sectionMap = new Map<string, ClassifiedSection>();
  for (const section of classifiedSections) {
    sectionMap.set(section.section_id, section);
  }

  // ============================================
  // Stage 4: Validation (Hard Gates V1-V3)
  // ============================================
  const validatedSuggestions: Suggestion[] = [];

  for (const suggestion of synthesizedSuggestions) {
    const section = sectionMap.get(suggestion.section_id);
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
      finalConfig.thresholds
    );

    if (validationResult.passed) {
      // Store validation results in suggestion
      suggestion.validation_results = validationResult.results;
      validatedSuggestions.push(suggestion);
    } else {
      // Track drop
      const validator = validationResult.failedValidator;
      if (validator === 'V1_change_test') debug.v1_drops++;
      else if (validator === 'V2_anti_vacuity') debug.v2_drops++;
      else if (validator === 'V3_evidence_sanity') debug.v3_drops++;

      debug.dropped_suggestions.push({
        section_id: suggestion.section_id,
        reason: validationResult.failureReason || 'Validation failed',
        validator: validator,
      });
    }
  }

  debug.suggestions_after_validation = validatedSuggestions.length;

  if (validatedSuggestions.length === 0) {
    return buildResult([], debug, finalConfig.enable_debug);
  }

  // ============================================
  // Stage 5: Scoring & Thresholding
  // ============================================
  const scoringResult = runScoringPipeline(
    validatedSuggestions,
    sectionMap,
    finalConfig
  );

  debug.suggestions_after_scoring = scoringResult.suggestions.length;
  debug.low_confidence_downgraded_count = scoringResult.downgraded_to_clarification || 0;

  // Track plan_change metrics per suggestion-suppression-fix plan
  const planChangeBeforeScoring = validatedSuggestions.filter(s => s.type === 'plan_mutation').length;
  const planChangeAfterScoring = scoringResult.suggestions.filter(s => s.type === 'plan_mutation').length;
  debug.plan_change_count = planChangeBeforeScoring;
  debug.plan_change_emitted_count = planChangeAfterScoring;
  debug.high_confidence_count = scoringResult.suggestions.filter(s => s.is_high_confidence).length;
  
  // Verify invariant: all plan_change suggestions must be emitted
  debug.invariant_plan_change_always_emitted = (planChangeBeforeScoring === planChangeAfterScoring);
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
  if (suggestion.type === 'plan_mutation') {
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
