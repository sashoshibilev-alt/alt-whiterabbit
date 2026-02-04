/**
 * Suggestion Engine
 * 
 * Main entry point for the deterministic suggestion generation pipeline.
 * 
 * Pipeline stages:
 * 1. Preprocessing: Normalize text, segment into units, map to initiatives
 * 2. Signal Detection: Detect plan-relevant signals using rule-based patterns
 * 3. Classification: Classify signals into mutation or artifact candidates
 * 4. Building: Build validated suggestion objects
 * 5. Filtering: Deduplicate, threshold, and cap suggestions
 */

import type {
  Note,
  Initiative,
  GeneratorContext,
  GeneratorResult,
  GeneratorConfig,
  Suggestion,
  DEFAULT_CONFIG,
} from './types';
import { DEFAULT_CONFIG as defaultConfig } from './types';
import { preprocessNote, PreprocessingResult } from './preprocessing';
import { extractSignals, deduplicateSignals } from './signals';
import { classifySignals, ClassificationResult } from './classification';
import { runBuildPipeline, BuildPipelineResult } from './builder';

// Re-export types for external use
export * from './types';
export { validateSuggestion, isValidSuggestion } from './validators';

// ============================================
// Main Generator Function
// ============================================

/**
 * Generate suggestions from a note and list of initiatives.
 * 
 * This is the main public API of the suggestion engine.
 * 
 * @param note - The meeting note to analyze
 * @param initiatives - Array of existing initiatives to match against
 * @param context - Optional context (timestamps, user role, feature flags)
 * @param config - Optional configuration overrides
 * @returns GeneratorResult with suggestions and optional debug info
 */
export function generateSuggestions(
  note: Note,
  initiatives: Initiative[],
  context?: GeneratorContext,
  config?: Partial<GeneratorConfig>
): GeneratorResult {
  // Merge config with defaults
  const finalConfig: GeneratorConfig = {
    ...defaultConfig,
    ...config,
  };

  // Apply feature flags from context
  if (context?.feature_flags) {
    const flags = context.feature_flags;
    if (flags.enable_timeline_mutations !== undefined) {
      finalConfig.enable_timeline_mutations = flags.enable_timeline_mutations;
    }
    if (flags.enable_priority_mutations !== undefined) {
      finalConfig.enable_priority_mutations = flags.enable_priority_mutations;
    }
    if (flags.enable_scope_mutations !== undefined) {
      finalConfig.enable_scope_mutations = flags.enable_scope_mutations;
    }
    if (flags.enable_ownership_mutations !== undefined) {
      finalConfig.enable_ownership_mutations = flags.enable_ownership_mutations;
    }
    if (flags.enable_new_initiatives !== undefined) {
      finalConfig.enable_new_initiatives = flags.enable_new_initiatives;
    }
    if (flags.enable_backlog_drafts !== undefined) {
      finalConfig.enable_backlog_drafts = flags.enable_backlog_drafts;
    }
    if (flags.enable_checklists !== undefined) {
      finalConfig.enable_checklists = flags.enable_checklists;
    }
    if (flags.enable_decision_records !== undefined) {
      finalConfig.enable_decision_records = flags.enable_decision_records;
    }
  }

  // Stage 1: Preprocessing
  const preprocessingResult: PreprocessingResult = preprocessNote(note, initiatives);
  const { segments, initiative_mappings } = preprocessingResult;

  // Stage 2: Signal Detection
  const rawSignals = extractSignals(segments, initiative_mappings);
  const signals = deduplicateSignals(rawSignals);

  // Stage 3: Classification
  const classificationResult: ClassificationResult = classifySignals(
    signals,
    initiatives,
    segments
  );
  const { mutations, artifacts } = classificationResult;

  // Stage 4 & 5: Building, Validation, Filtering
  const buildResult: BuildPipelineResult = runBuildPipeline(
    mutations,
    artifacts,
    note.id,
    initiatives,
    finalConfig
  );

  // Build result
  const result: GeneratorResult = {
    suggestions: buildResult.suggestions,
  };

  // Add debug info if enabled
  if (finalConfig.enable_debug) {
    result.debug = {
      segments_count: segments.length,
      signals_count: signals.length,
      candidates_count: buildResult.debug.candidates_count,
      filtered_count: buildResult.debug.filtered_count,
      validation_errors: buildResult.debug.validation_errors,
    };
  }

  return result;
}

// ============================================
// Adapter for Convex Integration
// ============================================

/**
 * Adapter to convert from Convex note format to engine format
 */
export function adaptConvexNote(convexNote: {
  _id: string;
  body: string;
  createdAt: number;
  title?: string;
}): Note {
  return {
    id: convexNote._id,
    raw_text: convexNote.body,
    created_at: convexNote.createdAt,
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
}): Initiative {
  return {
    id: convexInitiative._id,
    title: convexInitiative.title,
    status: convexInitiative.status as Initiative['status'],
    description: convexInitiative.description,
  };
}

/**
 * Convert engine suggestion to Convex-friendly format
 */
export function suggestionToContent(suggestion: Suggestion): string {
  if (suggestion.type === 'PLAN_MUTATION') {
    const { mutation, rationale } = suggestion;
    const changeDesc = describeChange(mutation);
    return `${changeDesc}\n\nRationale: ${rationale}`;
  } else {
    const { artifact } = suggestion;
    return `[${artifact.artifact_kind}] ${artifact.title}\n\n${artifact.description}`;
  }
}

/**
 * Describe a mutation change in human-readable format
 */
function describeChange(mutation: {
  target_initiative_id: string;
  change_type: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}): string {
  const { change_type, before, after } = mutation;
  
  switch (change_type) {
    case 'TIMELINE':
      const beforeTimeline = (before.timeline as { description?: string })?.description || 'unknown';
      const afterTimeline = (after.timeline as { description?: string })?.description || 'unknown';
      return `Update timeline: ${beforeTimeline} → ${afterTimeline}`;
    
    case 'PRIORITY':
      return `Update priority: ${before.priority || 'unknown'} → ${after.priority || 'unknown'}`;
    
    case 'OWNERSHIP':
      const beforeOwner = (before.owner_name as string) || (before.owner_id as string) || 'unknown';
      const afterOwner = (after.owner_name as string) || (after.owner_id as string) || 'unknown';
      return `Change owner: ${beforeOwner} → ${afterOwner}`;
    
    case 'STATUS':
      return `Update status: ${before.status || 'unknown'} → ${after.status || 'unknown'}`;
    
    case 'SCOPE':
      return `Scope change: ${after.scope || 'See details'}`;
    
    default:
      return `Update ${change_type.toLowerCase()}`;
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Check if the engine would produce any suggestions for a note
 * (cheaper than full generation for filtering)
 */
export function hasRelevantSignals(
  note: Note,
  initiatives: Initiative[]
): boolean {
  const { segments, initiative_mappings } = preprocessNote(note, initiatives);
  const signals = extractSignals(segments, initiative_mappings);
  return signals.length > 0;
}

/**
 * Get signal count for a note (for analytics/debugging)
 */
export function getSignalCount(
  note: Note,
  initiatives: Initiative[]
): { mutation: number; artifact: number } {
  const { segments, initiative_mappings } = preprocessNote(note, initiatives);
  const signals = deduplicateSignals(extractSignals(segments, initiative_mappings));
  
  let mutation = 0;
  let artifact = 0;
  
  for (const signal of signals) {
    if (signal.cue_type.startsWith('mutation_')) {
      mutation++;
    } else {
      artifact++;
    }
  }
  
  return { mutation, artifact };
}
