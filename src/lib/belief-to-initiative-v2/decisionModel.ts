/**
 * Decision Model V2 - Belief-Driven Visibility
 * 
 * Core implementation of the corrected belief → suggestion decision layer.
 * 
 * KEY PRINCIPLE: Belief existence controls suggestion visibility.
 * Thresholds control how suggestions are surfaced (action type, clarification, eligibility).
 */

import type {
  BeliefWithRouting,
  BeliefClassification,
  BeliefDecision,
  SuggestionAction,
  DecisionModelConfigV2,
} from './types';

/**
 * Make decision for a single belief
 * 
 * Implements Rule Groups A-D from the implementation plan.
 */
export function decideForBelief(
  belief: BeliefWithRouting,
  classification: BeliefClassification,
  config: DecisionModelConfigV2
): BeliefDecision {
  // Rule Group A: Belief Visibility
  // A1: Pure status/context beliefs are dropped
  if (classification.is_pure_status_or_context) {
    return {
      belief_id: belief.id,
      should_emit_suggestion: false,
      action: 'comment',
      needs_clarification: false,
      execution_eligible: false,
      reasoning: 'A1: Pure status/context belief - no suggestion emitted',
    };
  }
  
  // A2: All other beliefs emit exactly one suggestion
  // Determine action, clarification, and eligibility using remaining rule groups
  
  const action = selectAction(belief, classification, config);
  const needsClarification = selectNeedsClarification(belief, config);
  const executionEligible = selectExecutionEligibility(belief, action, config);
  
  return {
    belief_id: belief.id,
    should_emit_suggestion: true,
    action,
    needs_clarification: needsClarification,
    execution_eligible: executionEligible,
    reasoning: buildReasoning(belief, classification, action, needsClarification, executionEligible, config),
  };
}

/**
 * Rule Group B: Action Selection
 * 
 * Selects between 'comment' and 'mutate_release_date' based on:
 * - domain
 * - change_type
 * - confidence
 * - actionability
 */
function selectAction(
  belief: BeliefWithRouting,
  classification: BeliefClassification,
  config: DecisionModelConfigV2
): SuggestionAction {
  // B1: Non-initiative domains → comment
  if (classification.domain !== 'initiatives') {
    return 'comment';
  }
  
  // B2: Initiative, non-release-date changes → comment
  if (classification.change_type !== 'release_date_change') {
    return 'comment';
  }
  
  // B3: Initiative, release date, but low confidence OR low actionability → comment
  const confidence = belief.confidence_score;
  const actionability = computeActionability(belief);
  
  if (
    confidence < config.T_MIN_CONF_FOR_MUTATION ||
    actionability < config.T_MIN_ACT_FOR_MUTATION
  ) {
    return 'comment';
  }
  
  // B4: Initiative, release date, high confidence AND high actionability → mutate_release_date
  return 'mutate_release_date';
}

/**
 * Rule Group C: Needs Clarification
 * 
 * Determines if needs_clarification should be set based on confidence.
 */
function selectNeedsClarification(
  belief: BeliefWithRouting,
  config: DecisionModelConfigV2
): boolean {
  // C1: Low or medium confidence → needs_clarification = true
  if (belief.confidence_score < config.T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE) {
    return true;
  }
  
  // C2: High confidence → needs_clarification = false
  return false;
}

/**
 * Rule Group D: Execution Eligibility
 * 
 * Determines if execution_eligible should be set.
 * This does NOT affect suggestion visibility.
 */
function selectExecutionEligibility(
  belief: BeliefWithRouting,
  action: SuggestionAction,
  config: DecisionModelConfigV2
): boolean {
  // D1: Release-date mutations with high quality → execution_eligible = true
  if (action === 'mutate_release_date') {
    const confidence = belief.confidence_score;
    const actionability = computeActionability(belief);
    
    if (
      confidence >= config.T_MIN_CONF_FOR_EXECUTION_ELIGIBLE &&
      actionability >= config.T_MIN_ACT_FOR_EXECUTION_ELIGIBLE
    ) {
      return true;
    }
  }
  
  // D2: All other cases → execution_eligible = false
  return false;
}

/**
 * Compute actionability score from belief
 * 
 * Actionability measures how concrete and actionable the belief is.
 */
function computeActionability(belief: BeliefWithRouting): number {
  let score = 0.5; // base
  
  // Has timeline signal with concrete date
  if (belief.timeline_signal?.refers_to_date) {
    score += 0.2;
  }
  
  if (belief.timeline_signal?.mentioned_date) {
    score += 0.15;
  }
  
  // Has specific delta
  if (belief.timeline_signal?.suggested_delta_days !== null &&
      belief.timeline_signal?.suggested_delta_days !== undefined) {
    score += 0.15;
  }
  
  // Impact level
  const impactBoosts = {
    low: 0,
    medium: 0.1,
    high: 0.2,
    critical: 0.3,
  };
  score += impactBoosts[belief.impact_level || 'medium'];
  
  // Has clear initiative mapping
  if (belief.subject_initiative_id) {
    score += 0.1;
  }
  
  return Math.min(1, score);
}

/**
 * Build human-readable reasoning for decision
 */
function buildReasoning(
  belief: BeliefWithRouting,
  classification: BeliefClassification,
  action: SuggestionAction,
  needsClarification: boolean,
  executionEligible: boolean,
  config: DecisionModelConfigV2
): string {
  const parts: string[] = [];
  
  parts.push(`Domain: ${classification.domain}`);
  parts.push(`Change type: ${classification.change_type}`);
  parts.push(`Confidence: ${belief.confidence_score.toFixed(2)}`);
  parts.push(`Actionability: ${computeActionability(belief).toFixed(2)}`);
  
  // Action reasoning
  if (action === 'comment') {
    if (classification.domain !== 'initiatives') {
      parts.push('Action: comment (non-initiative domain)');
    } else if (classification.change_type !== 'release_date_change') {
      parts.push('Action: comment (non-release-date change)');
    } else {
      parts.push('Action: comment (low confidence or actionability)');
    }
  } else {
    parts.push('Action: mutate_release_date (high confidence + actionability, release date change)');
  }
  
  // Clarification reasoning
  if (needsClarification) {
    parts.push(`Needs clarification: true (confidence < ${config.T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE})`);
  } else {
    parts.push('Needs clarification: false (high confidence)');
  }
  
  // Eligibility reasoning
  if (executionEligible) {
    parts.push('Execution eligible: true (high quality mutate_release_date)');
  } else {
    parts.push('Execution eligible: false');
  }
  
  return parts.join('; ');
}

/**
 * Batch decision making for multiple beliefs
 */
export function decideForBeliefs(
  beliefs: BeliefWithRouting[],
  classifications: Map<string, BeliefClassification>,
  config: DecisionModelConfigV2
): Map<string, BeliefDecision> {
  const decisions = new Map<string, BeliefDecision>();
  
  for (const belief of beliefs) {
    const classification = classifications.get(belief.id);
    if (!classification) {
      // Should never happen, but handle gracefully
      continue;
    }
    
    const decision = decideForBelief(belief, classification, config);
    decisions.set(belief.id, decision);
  }
  
  return decisions;
}
