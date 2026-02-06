/**
 * Suggestion Debug Report - Instrumented Generator
 *
 * This module wraps the suggestion generator with debug instrumentation
 * to produce comprehensive DebugRun reports.
 */

import type {
  NoteInput,
  GeneratorContext,
  GeneratorConfig,
  GeneratorResult,
  Suggestion,
  ClassifiedSection,
} from "./types";
import { DEFAULT_CONFIG } from "./types";
import type { DebugRun, DebugVerbosity } from "./debugTypes";
import { DropReason, DropStage } from "./debugTypes";
import {
  DebugLedger,
  createDebugLedger,
  sectionToDebug,
} from "./DebugLedger";
import { preprocessNote, resetSectionCounter } from "./preprocessing";
import { classifySections, filterActionableSections, isPlanChangeIntentLabel } from "./classifiers";
import { synthesizeSuggestions, resetSuggestionCounter } from "./synthesis";
import { runQualityValidators } from "./validators";
import { runScoringPipeline } from "./scoring";
import { routeSuggestions } from "./routing";

// ============================================
// Debug Generator Options
// ============================================

export interface DebugGeneratorOptions {
  verbosity?: DebugVerbosity;
  userId?: string;
}

export interface DebugGeneratorResult extends GeneratorResult {
  debugRun?: DebugRun;
}

// ============================================
// Instrumented Generator
// ============================================

/**
 * Generate suggestions with debug instrumentation.
 *
 * This is the main entry point for the debug pipeline. It wraps the
 * standard suggestion generation with comprehensive instrumentation.
 */
export function generateSuggestionsWithDebug(
  note: NoteInput,
  context?: GeneratorContext,
  config?: Partial<GeneratorConfig>,
  debugOptions?: DebugGeneratorOptions
): DebugGeneratorResult {
  // Reset counters for deterministic IDs
  resetSectionCounter();
  resetSuggestionCounter();

  // Merge config with defaults
  const finalConfig: GeneratorConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    thresholds: {
      ...DEFAULT_CONFIG.thresholds,
      ...config?.thresholds,
    },
  };

  // Resolve verbosity
  const verbosity = debugOptions?.verbosity || "OFF";

  // Create debug ledger (returns null if OFF)
  const ledger = createDebugLedger({
    noteId: note.note_id,
    noteBody: note.raw_markdown,
    verbosity,
    config: finalConfig,
    userId: debugOptions?.userId,
  });

  const startTime = Date.now();

  try {
    // ============================================
    // Stage 1: Preprocessing
    // ============================================
    const segmentStart = Date.now();
    const { lines, sections } = preprocessNote(note);
    
    if (ledger) {
      ledger.recordStageTiming(DropStage.SEGMENTATION, Date.now() - segmentStart);
    }

    // Create section debug records
    if (ledger) {
      for (const section of sections) {
        sectionToDebug(ledger, section);
      }
    }

    if (sections.length === 0) {
      return buildResult([], ledger, finalConfig.enable_debug);
    }

    // ============================================
    // Stage 2: Classification
    // ============================================
    const classifyStart = Date.now();
    const classifiedSections = classifySections(sections, finalConfig.thresholds);
    
    // Record classification results
    if (ledger) {
      for (const classified of classifiedSections) {
        const sectionDebug = ledger.getSection(classified.section_id);
        if (sectionDebug) {
          // Include actionability signals for debug instrumentation
          const actionabilitySignals = (classified.actionable_signal !== undefined && classified.out_of_scope_signal !== undefined)
            ? {
                actionableSignal: classified.actionable_signal,
                outOfScopeSignal: classified.out_of_scope_signal,
              }
            : undefined;

          ledger.afterIntentClassification(
            sectionDebug,
            classified.intent,
            classified.is_actionable,
            classified.actionability_reason,
            actionabilitySignals
          );

          if (classified.suggested_type) {
            ledger.afterTypeClassification(
              sectionDebug,
              classified.suggested_type,
              classified.type_confidence || 0
            );
          }
        }
      }
      ledger.recordStageTiming(DropStage.ACTIONABILITY, Date.now() - classifyStart);
    }

    // Filter actionable sections
    const actionableSections = filterActionableSections(classifiedSections);

    // Mark non-actionable sections as dropped
    // PLAN_CHANGE PROTECTION: Never drop plan_change sections at ACTIONABILITY
    // Also heal debug ledger state to match the protection logic
    if (ledger) {
      for (const classified of classifiedSections) {
        const sectionDebug = ledger.getSection(classified.section_id);
        const isPlanChange = isPlanChangeIntentLabel(classified.intent);

        if (!sectionDebug) continue;

        if (isPlanChange && !classified.is_actionable) {
          // Heal debug decisions so JSON reflects the override
          sectionDebug.decisions.isActionable = true;
          sectionDebug.decisions.actionabilityReason =
            sectionDebug.decisions.actionabilityReason ||
            'plan_change override: healed at ACTIONABILITY gate';
        } else if (!classified.is_actionable) {
          // Drop non-plan_change sections that are not actionable
          ledger.dropSection(sectionDebug, DropReason.NOT_ACTIONABLE);
        }
      }
    }

    if (actionableSections.length === 0) {
      return buildResult([], ledger, finalConfig.enable_debug);
    }

    // ============================================
    // Stage 3: Synthesis
    // ============================================
    const synthStart = Date.now();
    let synthesizedSuggestions = synthesizeSuggestions(actionableSections);

    // PLAN_CHANGE PROTECTION (Task 4): Guarantee at least one suggestion per plan_change section
    // If synthesis produced 0 candidates for a plan_change section, emit a fallback suggestion
    const sectionIdsWithSuggestions = new Set(synthesizedSuggestions.map(s => s.section_id));
    
    for (const section of actionableSections) {
      const isPlanChange = isPlanChangeIntentLabel(section.intent);
      const hasSuggestion = sectionIdsWithSuggestions.has(section.section_id);
      
      if (isPlanChange && !hasSuggestion) {
        // Create fallback suggestion for plan_change section with 0 candidates
        const fallbackSuggestion: Suggestion = {
          suggestion_id: `fallback_${section.section_id}_${Date.now()}`,
          note_id: section.note_id,
          section_id: section.section_id,
          type: 'project_update',
          title: section.heading_text 
            ? `Review: ${section.heading_text}` 
            : 'Review plan change',
          payload: {
            after_description: `Plan change detected in section. ${
              section.body_lines
                .filter(l => l.line_type === 'list_item')
                .slice(0, 3)
                .map(l => l.text.trim())
                .join(' ')
            }`.trim(),
          },
          evidence_spans: section.body_lines.length > 0 
            ? [{
                start_line: section.start_line,
                end_line: Math.min(section.end_line, section.start_line + 5),
                text: section.body_lines.slice(0, 3).map(l => l.text).join('\n'),
              }]
            : [],
          scores: {
            section_actionability: section.actionable_signal || 0.3,
            type_choice_confidence: 0.3,
            synthesis_confidence: 0.3,
            overall: 0.3,
          },
          routing: { create_new: true },
          needs_clarification: true,
          clarification_reasons: ['fallback_synthesis'],
          is_high_confidence: false,
        };
        
        synthesizedSuggestions.push(fallbackSuggestion);
        sectionIdsWithSuggestions.add(section.section_id);
        
        if (ledger) {
          console.warn('[PLAN_CHANGE_FALLBACK] Created fallback suggestion for section:', section.section_id);
        }
      }
    }

    // Record synthesis results
    if (ledger) {
      for (const suggestion of synthesizedSuggestions) {
        const sectionDebug = ledger.getSection(suggestion.section_id);
        if (sectionDebug) {
          ledger.afterSynthesis(sectionDebug, suggestion);
        }
      }
      ledger.recordStageTiming(DropStage.SYNTHESIS, Date.now() - synthStart);
    }

    if (synthesizedSuggestions.length === 0) {
      return buildResult([], ledger, finalConfig.enable_debug);
    }

    // Build section lookup map
    const sectionMap = new Map<string, ClassifiedSection>();
    for (const section of classifiedSections) {
      sectionMap.set(section.section_id, section);
    }

    // ============================================
    // Stage 4: Validation (Hard Gates V1-V3)
    // ============================================
    const validStart = Date.now();
    const validatedSuggestions: Suggestion[] = [];

    for (const suggestion of synthesizedSuggestions) {
      const section = sectionMap.get(suggestion.section_id);
      if (!section) {
        if (ledger) {
          ledger.dropCandidateById(
            suggestion.suggestion_id,
            DropReason.INTERNAL_ERROR
          );
        }
        continue;
      }

      const validationResult = runQualityValidators(
        suggestion,
        section,
        finalConfig.thresholds,
        section.typeLabel
      );

      // Record validation results
      if (ledger) {
        const sectionDebug = ledger.getSection(suggestion.section_id);
        if (sectionDebug) {
          ledger.afterValidation(sectionDebug, suggestion, validationResult.results);
        }
      }

      if (validationResult.passed) {
        suggestion.validation_results = validationResult.results;
        validatedSuggestions.push(suggestion);
      } else {
        // Map validator to drop reason
        const dropReason = mapValidatorToDropReason(validationResult.failedValidator);

        if (ledger) {
          ledger.dropCandidateById(suggestion.suggestion_id, dropReason);
        }
      }
    }

    if (ledger) {
      ledger.recordStageTiming(DropStage.VALIDATION, Date.now() - validStart);
    }

    if (validatedSuggestions.length === 0) {
      return buildResult([], ledger, finalConfig.enable_debug);
    }

    // ============================================
    // Stage 5: Scoring & Thresholding
    // ============================================
    const scoreStart = Date.now();
    const scoringResult = runScoringPipeline(
      validatedSuggestions,
      sectionMap,
      finalConfig
    );

    // Instrumentation: Log post-scoring state for aggregation debugging
    if (process.env.DEBUG_AGGREGATION === 'true' || finalConfig.enable_debug) {
      console.log('[Aggregation Debug] Post-scoring:', {
        noteId: note.note_id,
        stage: 'post_scoring',
        passedCount: scoringResult.suggestions.length,
        droppedCount: scoringResult.dropped.length,
        downgraded: scoringResult.downgraded_to_clarification || 0,
        passedIds: scoringResult.suggestions.map(s => s.suggestion_id),
      });
    }

    // Record scoring results
    if (ledger) {
      // Record scores for ALL suggestions (passed + dropped) before marking drops
      // This ensures debug output shows computed scores even for dropped suggestions
      for (const suggestion of scoringResult.suggestions) {
        const sectionDebug = ledger.getSection(suggestion.section_id);
        if (sectionDebug) {
          ledger.afterScoring(sectionDebug, suggestion, suggestion.scores);
        }
      }

      // Also record scores for dropped suggestions BEFORE marking them as dropped
      for (const dropped of scoringResult.dropped) {
        const { suggestion } = dropped;
        const sectionDebug = ledger.getSection(suggestion.section_id);
        if (sectionDebug) {
          ledger.afterScoring(sectionDebug, suggestion, suggestion.scores);
        }
      }

      // Record dropped suggestions
      // PLAN_CHANGE PROTECTION: Never drop project_update at THRESHOLD
      for (const dropped of scoringResult.dropped) {
        const { suggestion } = dropped;

        // Never treat plan_change / project_update as score-based drops
        if (suggestion.type === 'project_update') {
          // Log an invariant violation, since scoring.ts should already
          // prevent project_update from entering `dropped`.
          console.error('[PLAN_CHANGE_THRESHOLD_INVARIANT_VIOLATION]', {
            noteId: note.note_id,
            suggestionId: suggestion.suggestion_id,
            reason: dropped.reason,
          });
          continue;
        }

        ledger.dropCandidateById(
          suggestion.suggestion_id,
          DropReason.SCORE_BELOW_THRESHOLD
        );
      }

      ledger.recordStageTiming(DropStage.THRESHOLD, Date.now() - scoreStart);
    }

    if (scoringResult.suggestions.length === 0) {
      return buildResult([], ledger, finalConfig.enable_debug);
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

    // ============================================
    // Stage 7: Dedupe (if any)
    // ============================================
    const dedupeStart = Date.now();
    const finalSuggestions = dedupeSuggestions(routedSuggestions, ledger);

    if (ledger) {
      ledger.recordStageTiming(DropStage.DEDUPE, Date.now() - dedupeStart);
    }

    // Instrumentation: Log final suggestions state
    if (process.env.DEBUG_AGGREGATION === 'true' || finalConfig.enable_debug) {
      console.log('[Aggregation Debug] Final suggestions:', {
        noteId: note.note_id,
        stage: 'final_suggestions',
        count: finalSuggestions.length,
        suggestionIds: finalSuggestions.map(s => s.suggestion_id),
      });
    }

    // Finalize debug run (reconciles emitted flags with final suggestion IDs)
    if (ledger) {
      ledger.finalize(finalSuggestions.map((s) => s.suggestion_id));
    }

    // INVARIANT CHECK: Ensure emitted candidates match final suggestions
    if (ledger && finalConfig.enable_debug) {
      const debugRun = ledger.buildDebugRun();
      const emittedCandidates = debugRun.sections
        .flatMap(sec => sec.candidates)
        .filter(c => c.emitted);
      
      if (emittedCandidates.length > 0 && finalSuggestions.length === 0) {
        console.error('[AGGREGATION_INVARIANT_VIOLATION]', {
          noteId: note.note_id,
          emittedCount: emittedCandidates.length,
          finalCount: finalSuggestions.length,
          emittedIds: emittedCandidates.map(c => c.candidateId),
        });
      }

      // Check plan_change invariant
      const planChangeCandidates = debugRun.sections
        .flatMap(sec => sec.candidates)
        .filter(c => c.metadata?.type === 'project_update');
      const planChangeSuggestions = finalSuggestions.filter(s => s.type === 'project_update');
      
      if (planChangeCandidates.length > 0 && planChangeSuggestions.length === 0) {
        console.error('[PLAN_CHANGE_INVARIANT_VIOLATION]', {
          noteId: note.note_id,
          planChangeCandidatesCount: planChangeCandidates.length,
          planChangeSuggestionsCount: planChangeSuggestions.length,
        });
      }
    }

    return buildResult(finalSuggestions, ledger, finalConfig.enable_debug);
  } catch (error) {
    // Handle global error
    if (ledger) {
      ledger.markGlobalError(error as Error);
    }
    throw error;
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Build the final result object
 */
function buildResult(
  suggestions: Suggestion[],
  ledger: DebugLedger | null,
  includeDebug: boolean
): DebugGeneratorResult {
  const result: DebugGeneratorResult = {
    suggestions,
  };

  if (ledger) {
    result.debugRun = ledger.buildDebugRun();
  }

  return result;
}

/**
 * Map validator name to drop reason
 */
function mapValidatorToDropReason(validator?: string): DropReason {
  switch (validator) {
    case "V2_anti_vacuity":
      return DropReason.VALIDATION_V2_TOO_GENERIC;
    case "V3_evidence_sanity":
      return DropReason.VALIDATION_V3_EVIDENCE_TOO_WEAK;
    default:
      return DropReason.INTERNAL_ERROR;
  }
}

/**
 * Dedupe suggestions by fingerprint
 */
function dedupeSuggestions(
  suggestions: Suggestion[],
  ledger: DebugLedger | null
): Suggestion[] {
  const seen = new Set<string>();
  const unique: Suggestion[] = [];

  for (const suggestion of suggestions) {
    // Use suggestionKey as stable fingerprint for dedupe
    const fingerprint = suggestion.suggestionKey;

    if (seen.has(fingerprint)) {
      if (ledger) {
        ledger.dropCandidateById(
          suggestion.suggestion_id,
          DropReason.DUPLICATE_FINGERPRINT
        );
      }
      continue;
    }

    seen.add(fingerprint);
    unique.push(suggestion);
  }

  return unique;
}

// ============================================
// Export for index
// ============================================

export { DebugLedger, createDebugLedger, sectionToDebug } from "./DebugLedger";
