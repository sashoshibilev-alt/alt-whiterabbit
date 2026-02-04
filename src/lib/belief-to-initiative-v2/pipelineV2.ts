/**
 * Belief-to-Suggestion Pipeline V2
 * 
 * Main orchestration implementing the corrected belief-driven visibility model.
 * 
 * CORE INVARIANTS:
 * - I1: Belief implies suggestion (non-pure-status)
 * - I2: Low confidence does not hide suggestions
 * - I3: High-confidence, actionable release-date beliefs can mutate
 * - I4: Execution eligibility only tightens, never hides
 * - I5: Evidence spans always present
 * - I6: Pure status/context beliefs may be dropped
 */

import type {
  BeliefWithRouting,
  InitiativeSuggestion,
  BeliefToSuggestionResultV2,
  DecisionModelConfigV2,
} from './types';
import { DEFAULT_DECISION_MODEL_CONFIG_V2 } from './types';
import { classifyBeliefs } from './beliefClassifier';
import { decideForBeliefs } from './decisionModel';
import { buildSuggestionsFromDecisions } from './suggestionBuilderV2';

/**
 * Execute the V2 belief-to-suggestion pipeline
 * 
 * This pipeline ensures that:
 * 1. Any non-pure-status belief produces at least one suggestion
 * 2. Low confidence downgrades suggestions, never hides them
 * 3. All suggestions have non-empty evidence spans
 */
export function executeBeliefToSuggestionPipelineV2(
  beliefs: BeliefWithRouting[],
  config: Partial<DecisionModelConfigV2> = {}
): BeliefToSuggestionResultV2 {
  const fullConfig = {
    ...DEFAULT_DECISION_MODEL_CONFIG_V2,
    ...config,
  };
  
  // Initialize debug counters
  const debug = {
    total_beliefs: beliefs.length,
    pure_status_beliefs: 0,
    non_status_beliefs: 0,
    suggestions_emitted: 0,
    low_confidence_downgraded_to_comment: 0,
    low_confidence_with_clarification: 0,
    mutate_release_date_actions: 0,
    comment_actions: 0,
    execution_eligible_count: 0,
    invariant_I1_holds: true,
    invariant_I2_holds: true,
    invariant_I5_holds: true,
  };
  
  // Step 1: Classify beliefs
  const classifications = classifyBeliefs(beliefs);
  
  // Count pure status vs non-status
  for (const [beliefId, classification] of classifications.entries()) {
    if (classification.is_pure_status_or_context) {
      debug.pure_status_beliefs++;
    } else {
      debug.non_status_beliefs++;
    }
  }
  
  // Step 2: Make decisions for each belief
  const decisions = decideForBeliefs(beliefs, classifications, fullConfig);
  
  // Step 3: Build suggestions from decisions
  const suggestions = buildSuggestionsFromDecisions(beliefs, decisions, classifications);
  debug.suggestions_emitted = suggestions.length;
  
  // Step 4: Compute debug stats and check invariants
  for (const suggestion of suggestions) {
    // Count action types
    if (suggestion.action === 'comment') {
      debug.comment_actions++;
    } else if (suggestion.action === 'mutate_release_date') {
      debug.mutate_release_date_actions++;
    }
    
    // Count clarifications
    if (suggestion.status === 'needs_clarification') {
      debug.low_confidence_with_clarification++;
    }
    
    // Count execution eligible
    const decision = decisions.get(suggestion.belief_ids[0]);
    if (decision?.execution_eligible) {
      debug.execution_eligible_count++;
    }
    
    // Count downgrades (release date → comment due to low confidence)
    const belief = beliefs.find(b => b.id === suggestion.belief_ids[0]);
    const classification = classifications.get(suggestion.belief_ids[0]);
    if (
      belief &&
      classification &&
      classification.change_type === 'release_date_change' &&
      classification.domain === 'initiatives' &&
      suggestion.action === 'comment'
    ) {
      debug.low_confidence_downgraded_to_comment++;
    }
    
    // Check I5: Evidence spans always present
    if (!suggestion.evidence_spans || suggestion.evidence_spans.length === 0) {
      debug.invariant_I5_holds = false;
      console.error('INVARIANT I5 VIOLATED: Suggestion without evidence spans:', suggestion.id);
    }
  }
  
  // Check I1: Belief implies suggestion (non-pure-status)
  if (debug.non_status_beliefs > 0 && debug.suggestions_emitted === 0) {
    debug.invariant_I1_holds = false;
    console.error('INVARIANT I1 VIOLATED: Non-status beliefs exist but no suggestions emitted');
  }
  
  // Check I2: Low confidence does not hide suggestions
  // For each non-pure-status belief with low confidence, ensure a suggestion was emitted
  for (const belief of beliefs) {
    const classification = classifications.get(belief.id);
    if (
      classification &&
      !classification.is_pure_status_or_context &&
      belief.confidence_score < 0.5
    ) {
      const hasSuggestion = suggestions.some(s => s.belief_ids.includes(belief.id));
      if (!hasSuggestion) {
        debug.invariant_I2_holds = false;
        console.error('INVARIANT I2 VIOLATED: Low-confidence belief without suggestion:', belief.id);
      }
    }
  }
  
  // Sort suggestions by priority (using overall score for ordering only)
  const sortedSuggestions = sortByOverallScore(suggestions);
  
  return {
    suggestions: sortedSuggestions,
    debug,
  };
}

/**
 * Sort suggestions by overall score (descending)
 * 
 * This uses priority_score for ordering only, NOT for filtering.
 * Per the plan, overall score must never control visibility.
 */
function sortByOverallScore(suggestions: InitiativeSuggestion[]): InitiativeSuggestion[] {
  return [...suggestions].sort((a, b) => {
    // Primary: priority score (higher first)
    if (b.priority_score !== a.priority_score) {
      return b.priority_score - a.priority_score;
    }
    
    // Secondary: spam score (lower first)
    if (a.spam_score !== b.spam_score) {
      return a.spam_score - b.spam_score;
    }
    
    // Tertiary: creation time (newer first)
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

/**
 * Convert a single belief to suggestions (convenience wrapper)
 */
export function convertBeliefToSuggestionsV2(
  belief: BeliefWithRouting,
  config: Partial<DecisionModelConfigV2> = {}
): InitiativeSuggestion[] {
  const result = executeBeliefToSuggestionPipelineV2([belief], config);
  return result.suggestions;
}
