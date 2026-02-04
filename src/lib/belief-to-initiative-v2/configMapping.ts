/**
 * Configuration Mapping for V2
 * 
 * Maps existing V1 thresholds to V2 downgrade-only behaviors.
 * Documents the semantic change in what each threshold controls.
 */

import type { DecisionModelConfigV2 } from './types';
import type { SuggestionThresholds } from '../belief-to-initiative/types';

/**
 * Map V1 thresholds to V2 config
 * 
 * KEY SEMANTIC CHANGES:
 * 
 * V1 (OLD BEHAVIOR):
 * - min_belief_confidence: Drops suggestions when low
 * - min_impact_level: Drops suggestions when low
 * 
 * V2 (NEW BEHAVIOR):
 * - T_MIN_CONF_FOR_MUTATION: Controls action type (mutate_release_date vs comment)
 * - T_MIN_CONF_FOR_EXECUTION_ELIGIBLE: Controls execution_eligible flag
 * - T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE: Controls needs_clarification flag
 * - All thresholds ONLY affect how suggestions are surfaced, NEVER visibility
 */
export function mapV1ThresholdsToV2Config(
  v1Thresholds: SuggestionThresholds
): DecisionModelConfigV2 {
  return {
    // Map min_belief_confidence to mutation threshold
    // V1 used this to drop suggestions; V2 uses it to downgrade to comments
    T_MIN_CONF_FOR_MUTATION: v1Thresholds.min_belief_confidence || 0.7,
    
    // Derive actionability threshold from initiative match requirements
    // V1 used min_initiative_match_score; V2 uses it for actionability
    T_MIN_ACT_FOR_MUTATION: v1Thresholds.min_initiative_match_score || 0.6,
    
    // Set execution eligible threshold slightly higher than mutation threshold
    T_MIN_CONF_FOR_EXECUTION_ELIGIBLE: Math.min(
      (v1Thresholds.min_belief_confidence || 0.7) + 0.1,
      0.9
    ),
    
    // Set actionability for execution eligible
    T_MIN_ACT_FOR_EXECUTION_ELIGIBLE: Math.min(
      (v1Thresholds.min_initiative_match_score || 0.6) + 0.1,
      0.85
    ),
    
    // Set clarification threshold based on confidence
    // If below this, needs_clarification = true
    T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE: Math.min(
      (v1Thresholds.min_belief_confidence || 0.7) + 0.15,
      0.9
    ),
    
    // Always true in V2
    T_OVERALL_SCORE_ORDERING_ONLY: true,
  };
}

/**
 * Create V2 config from explicit threshold values
 * 
 * Use this when you want to set thresholds directly for V2.
 */
export function createV2Config(overrides: Partial<DecisionModelConfigV2> = {}): DecisionModelConfigV2 {
  return {
    T_MIN_CONF_FOR_MUTATION: 0.7,
    T_MIN_ACT_FOR_MUTATION: 0.6,
    T_MIN_CONF_FOR_EXECUTION_ELIGIBLE: 0.8,
    T_MIN_ACT_FOR_EXECUTION_ELIGIBLE: 0.7,
    T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE: 0.85,
    T_OVERALL_SCORE_ORDERING_ONLY: true,
    ...overrides,
  };
}

/**
 * Documentation for threshold reinterpretation
 */
export const THRESHOLD_DOCUMENTATION = {
  T_MIN_CONF_FOR_MUTATION: {
    controls: [
      'Boundary between comment vs mutate_release_date for initiative release date changes',
    ],
    does_not_control: [
      'Whether a suggestion is emitted at all once a belief exists',
    ],
    v1_equivalent: 'min_belief_confidence (but used for dropping, not downgrading)',
  },
  
  T_MIN_ACT_FOR_MUTATION: {
    controls: [
      'Whether a belief can yield a mutate_release_date suggestion vs a comment',
    ],
    does_not_control: [
      'Whether a suggestion object is instantiated',
      'needs_clarification flag (driven by confidence)',
    ],
    v1_equivalent: 'Derived from min_initiative_match_score',
  },
  
  T_MIN_CONF_FOR_EXECUTION_ELIGIBLE: {
    controls: [
      'Whether execution_eligible is true for mutate_release_date suggestions',
    ],
    does_not_control: [
      'Whether a suggestion is emitted',
      'Action type selection',
    ],
    v1_equivalent: 'No direct equivalent (new in V2)',
  },
  
  T_MIN_ACT_FOR_EXECUTION_ELIGIBLE: {
    controls: [
      'Whether execution_eligible is true for mutate_release_date suggestions',
    ],
    does_not_control: [
      'Whether a suggestion is emitted',
      'needs_clarification flag',
    ],
    v1_equivalent: 'No direct equivalent (new in V2)',
  },
  
  T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE: {
    controls: [
      'Whether needs_clarification is set to true or false',
    ],
    does_not_control: [
      'Whether a suggestion is emitted',
      'Action type selection',
    ],
    v1_equivalent: 'No direct equivalent (new in V2)',
  },
  
  T_OVERALL_SCORE_ORDERING_ONLY: {
    controls: [
      'Whether overall score is used ONLY for ordering/ranking',
    ],
    does_not_control: [
      'Visibility (no hard filtering)',
    ],
    v1_equivalent: 'In V1, overall score could filter suggestions',
    note: 'Always true in V2; included for documentation',
  },
} as const;

/**
 * Validate V2 config to ensure thresholds are correctly ordered
 */
export function validateV2Config(config: DecisionModelConfigV2): string[] {
  const errors: string[] = [];
  
  // Execution thresholds should be >= mutation thresholds
  if (config.T_MIN_CONF_FOR_EXECUTION_ELIGIBLE < config.T_MIN_CONF_FOR_MUTATION) {
    errors.push(
      `T_MIN_CONF_FOR_EXECUTION_ELIGIBLE (${config.T_MIN_CONF_FOR_EXECUTION_ELIGIBLE}) ` +
      `should be >= T_MIN_CONF_FOR_MUTATION (${config.T_MIN_CONF_FOR_MUTATION})`
    );
  }
  
  if (config.T_MIN_ACT_FOR_EXECUTION_ELIGIBLE < config.T_MIN_ACT_FOR_MUTATION) {
    errors.push(
      `T_MIN_ACT_FOR_EXECUTION_ELIGIBLE (${config.T_MIN_ACT_FOR_EXECUTION_ELIGIBLE}) ` +
      `should be >= T_MIN_ACT_FOR_MUTATION (${config.T_MIN_ACT_FOR_MUTATION})`
    );
  }
  
  // Clarification threshold should be reasonable
  if (config.T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE < 0.5) {
    errors.push(
      `T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE (${config.T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE}) ` +
      `seems too low; most suggestions would need clarification`
    );
  }
  
  if (config.T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE > 0.95) {
    errors.push(
      `T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE (${config.T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE}) ` +
      `seems too high; almost no suggestions would be marked as clear`
    );
  }
  
  // All thresholds should be in [0, 1]
  const thresholds = [
    { name: 'T_MIN_CONF_FOR_MUTATION', value: config.T_MIN_CONF_FOR_MUTATION },
    { name: 'T_MIN_ACT_FOR_MUTATION', value: config.T_MIN_ACT_FOR_MUTATION },
    { name: 'T_MIN_CONF_FOR_EXECUTION_ELIGIBLE', value: config.T_MIN_CONF_FOR_EXECUTION_ELIGIBLE },
    { name: 'T_MIN_ACT_FOR_EXECUTION_ELIGIBLE', value: config.T_MIN_ACT_FOR_EXECUTION_ELIGIBLE },
    { name: 'T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE', value: config.T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE },
  ];
  
  for (const { name, value } of thresholds) {
    if (value < 0 || value > 1) {
      errors.push(`${name} (${value}) must be in range [0, 1]`);
    }
  }
  
  return errors;
}
