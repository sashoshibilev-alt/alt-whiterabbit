/**
 * Belief-to-Initiative V2 Types
 * 
 * Type definitions for the revised belief-driven visibility model.
 * Key change: belief existence controls suggestion visibility, not thresholds.
 */

import type {
  BeliefWithRouting,
  InitiativeSuggestion,
  SuggestionAction,
  SuggestionStatus,
  EvidenceSpanRef,
  CommentPayload,
  MutateReleaseDatePayload,
} from '../belief-to-initiative/types';

// Re-export core types
export type {
  BeliefWithRouting,
  InitiativeSuggestion,
  SuggestionAction,
  SuggestionStatus,
  EvidenceSpanRef,
  CommentPayload,
  MutateReleaseDatePayload,
};

/**
 * V2 Configuration with reinterpreted thresholds
 * 
 * CRITICAL: Thresholds now control DOWNGRADE behavior, NOT visibility.
 * - No threshold can cause a suggestion to be dropped
 * - Low scores downgrade action type or set needs_clarification
 */
export interface DecisionModelConfigV2 {
  // Action selection thresholds (controls comment vs mutate_release_date)
  T_MIN_CONF_FOR_MUTATION: number;         // e.g. 0.7
  T_MIN_ACT_FOR_MUTATION: number;          // e.g. 0.6
  
  // Execution eligibility thresholds (controls execution_eligible flag)
  T_MIN_CONF_FOR_EXECUTION_ELIGIBLE: number;  // e.g. 0.8
  T_MIN_ACT_FOR_EXECUTION_ELIGIBLE: number;   // e.g. 0.7
  
  // Clarification thresholds (controls needs_clarification flag)
  T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE: number;  // e.g. 0.85
  
  // Overall score for ordering only (NOT for filtering)
  T_OVERALL_SCORE_ORDERING_ONLY: boolean;  // Always true in V2
}

export const DEFAULT_DECISION_MODEL_CONFIG_V2: DecisionModelConfigV2 = {
  T_MIN_CONF_FOR_MUTATION: 0.7,
  T_MIN_ACT_FOR_MUTATION: 0.6,
  T_MIN_CONF_FOR_EXECUTION_ELIGIBLE: 0.8,
  T_MIN_ACT_FOR_EXECUTION_ELIGIBLE: 0.7,
  T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE: 0.85,
  T_OVERALL_SCORE_ORDERING_ONLY: true,
};

/**
 * Belief classification for V2 pipeline
 */
export interface BeliefClassification {
  is_pure_status_or_context: boolean;
  change_type: 'release_date_change' | 'scope_change' | 'owner_change' | 'other';
  domain: 'initiatives' | 'bugs' | 'other';
}

/**
 * Decision model output for a single belief
 */
export interface BeliefDecision {
  belief_id: string;
  should_emit_suggestion: boolean;
  action: SuggestionAction;
  needs_clarification: boolean;
  execution_eligible: boolean;
  reasoning: string; // for debugging
}

/**
 * V2 Pipeline Result with enhanced debug info
 */
export interface BeliefToSuggestionResultV2 {
  suggestions: InitiativeSuggestion[];
  debug?: {
    total_beliefs: number;
    pure_status_beliefs: number;
    non_status_beliefs: number;
    suggestions_emitted: number;
    low_confidence_downgraded_to_comment: number;
    low_confidence_with_clarification: number;
    mutate_release_date_actions: number;
    comment_actions: number;
    execution_eligible_count: number;
    // Invariant checks
    invariant_I1_holds: boolean; // beliefCount > 0 && non_status > 0 => suggestionCount >= 1
    invariant_I2_holds: boolean; // Low confidence never hides suggestions
    invariant_I5_holds: boolean; // All suggestions have evidence spans
  };
}
