/**
 * Belief-to-Initiative Suggestion Conversion Pipeline
 * 
 * Main orchestration for converting beliefs into initiative-level suggestions.
 */

export * from './types';
export * from './implicationClassifier';
export * from './suggestionBuilder';
export * from './guardrailFilter';

import type {
  BeliefWithRouting,
  BeliefToSuggestionResult,
  BeliefToSuggestionConfig,
  InitiativeSuggestion,
} from './types';
import { DEFAULT_BELIEF_TO_SUGGESTION_CONFIG } from './types';
import { classifyImplications } from './implicationClassifier';
import { buildSuggestionsForBeliefs } from './suggestionBuilder';
import { applyGuardrails, clusterBeliefs } from './guardrailFilter';

/**
 * Execute the full belief-to-suggestion pipeline
 */
export function executeBeliefToSuggestionPipeline(
  beliefs: BeliefWithRouting[],
  existingSuggestions: InitiativeSuggestion[] = [],
  config: Partial<BeliefToSuggestionConfig> = {}
): BeliefToSuggestionResult {
  const fullConfig = {
    ...DEFAULT_BELIEF_TO_SUGGESTION_CONFIG,
    ...config,
  };
  
  const debug = {
    total_beliefs: beliefs.length,
    classified_implications: 0,
    pre_filter_suggestions: 0,
    dropped_low_confidence: 0,
    dropped_ambiguous_initiative: 0,
    aggregated_clusters: 0,
    rate_limited: 0,
  };
  
  // Step 1: Classify implications
  const implications = classifyImplications(beliefs);
  debug.classified_implications = implications.length;
  
  // Step 2: Build suggestions
  const rawSuggestions = buildSuggestionsForBeliefs(
    beliefs,
    implications,
    fullConfig.thresholds
  );
  debug.pre_filter_suggestions = rawSuggestions.length;
  
  // Step 3: Cluster beliefs if enabled (for aggregation)
  if (fullConfig.enable_clustering) {
    const clusters = clusterBeliefs(beliefs, fullConfig.thresholds);
    debug.aggregated_clusters = clusters.length;
  }
  
  // Step 4: Apply guardrails
  const meetingId = beliefs[0]?.meeting_id || 'unknown';
  const filteredSuggestions = applyGuardrails(
    rawSuggestions,
    existingSuggestions,
    fullConfig.thresholds,
    meetingId,
    fullConfig.enable_cross_meeting_dedup
  );
  
  debug.rate_limited = rawSuggestions.length - filteredSuggestions.length;
  
  return {
    suggestions: filteredSuggestions,
    debug,
  };
}

/**
 * Convert a single belief to suggestions
 */
export function convertBeliefToSuggestions(
  belief: BeliefWithRouting,
  config: Partial<BeliefToSuggestionConfig> = {}
): InitiativeSuggestion[] {
  const result = executeBeliefToSuggestionPipeline([belief], [], config);
  return result.suggestions;
}
