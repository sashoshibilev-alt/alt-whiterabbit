/**
 * Tests for Belief-to-Suggestion Pipeline V2
 * 
 * Tests enforce the six core invariants:
 * - I1: Belief implies suggestion (non-pure-status)
 * - I2: Low confidence does not hide suggestions
 * - I3: High-confidence, actionable release-date beliefs can mutate
 * - I4: Execution eligibility only tightens, never hides
 * - I5: Evidence spans always present
 * - I6: Pure status/context beliefs may be dropped
 */

import { describe, it, expect } from 'vitest';
import {
  executeBeliefToSuggestionPipelineV2,
  convertBeliefToSuggestionsV2,
} from './pipelineV2';
import type { BeliefWithRouting, DecisionModelConfigV2 } from './types';
import { DEFAULT_DECISION_MODEL_CONFIG_V2 } from './types';

// ============================================
// Helper: Create test belief
// ============================================

function createTestBelief(overrides: Partial<BeliefWithRouting> = {}): BeliefWithRouting {
  return {
    id: `belief_${Math.random()}`,
    meeting_id: 'meeting_1',
    summary: 'Test belief summary',
    confidence_score: 0.8,
    impact_level: 'medium',
    dimension: 'timeline',
    polarity: 'neutral',
    evidence_spans: [
      {
        meeting_id: 'meeting_1',
        start_char: 0,
        end_char: 20,
      },
    ],
    ...overrides,
  };
}

// ============================================
// Test Group: T1 - No beliefs → no suggestions
// ============================================

describe('T1: No beliefs → no suggestions', () => {
  it('should return empty suggestions for empty beliefs', () => {
    const result = executeBeliefToSuggestionPipelineV2([]);
    
    expect(result.suggestions).toHaveLength(0);
    expect(result.debug?.total_beliefs).toBe(0);
  });
});

// ============================================
// Test Group: T2 - Low-confidence initiative release-date belief
// ============================================

describe('T2: Single low-confidence initiative release-date belief', () => {
  it('should emit comment suggestion with needs_clarification for low confidence', () => {
    const belief = createTestBelief({
      dimension: 'timeline',
      confidence_score: 0.2,
      subject_initiative_id: 'init_1',
      timeline_signal: {
        refers_to_date: true,
        current_release_date: '2026-03-01',
        mentioned_date: null,
        suggested_delta_days: null,
        likelihood_meeting_current_date: 0.3,
      },
    });
    
    const result = executeBeliefToSuggestionPipelineV2([belief]);
    
    // Should emit exactly one suggestion
    expect(result.suggestions).toHaveLength(1);
    
    const suggestion = result.suggestions[0];
    
    // Should be comment (low confidence)
    expect(suggestion.action).toBe('comment');
    
    // Should need clarification (low confidence)
    expect(suggestion.status).toBe('needs_clarification');
    
    // Should NOT be execution eligible
    expect(result.debug?.execution_eligible_count).toBe(0);
    
    // Should have evidence spans
    expect(suggestion.evidence_spans).toBeDefined();
    expect(suggestion.evidence_spans.length).toBeGreaterThan(0);
    
    // Invariants
    expect(result.debug?.invariant_I1_holds).toBe(true);
    expect(result.debug?.invariant_I2_holds).toBe(true);
    expect(result.debug?.invariant_I5_holds).toBe(true);
  });
});

// ============================================
// Test Group: T3 - Medium-confidence belief (mutation disallowed)
// ============================================

describe('T3: Medium-confidence initiative release-date belief', () => {
  it('should emit comment suggestion when confidence below mutation threshold', () => {
    const config: DecisionModelConfigV2 = {
      ...DEFAULT_DECISION_MODEL_CONFIG_V2,
      T_MIN_CONF_FOR_MUTATION: 0.7,
      T_MIN_ACT_FOR_MUTATION: 0.6,
    };
    
    const belief = createTestBelief({
      dimension: 'timeline',
      confidence_score: 0.6, // Below T_MIN_CONF_FOR_MUTATION
      subject_initiative_id: 'init_1',
      timeline_signal: {
        refers_to_date: true,
        current_release_date: '2026-03-01',
        mentioned_date: '2026-04-01',
        suggested_delta_days: 30,
        likelihood_meeting_current_date: 0.4,
      },
    });
    
    const result = executeBeliefToSuggestionPipelineV2([belief], config);
    
    // Should emit exactly one suggestion
    expect(result.suggestions).toHaveLength(1);
    
    const suggestion = result.suggestions[0];
    
    // Should be comment (confidence below threshold)
    expect(suggestion.action).toBe('comment');
    
    // Should have clarification based on T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE
    expect(suggestion.status).toBe('needs_clarification');
    
    // Not dropped despite low confidence (I2)
    expect(result.debug?.invariant_I2_holds).toBe(true);
  });
});

// ============================================
// Test Group: T4 - High-confidence, high-actionability belief
// ============================================

describe('T4: High-confidence, high-actionability initiative release-date belief', () => {
  it('should emit mutate_release_date suggestion with no clarification needed', () => {
    const belief = createTestBelief({
      dimension: 'timeline',
      confidence_score: 0.9,
      impact_level: 'high',
      subject_initiative_id: 'init_1',
      timeline_signal: {
        refers_to_date: true,
        current_release_date: '2026-03-01',
        mentioned_date: '2026-04-01',
        suggested_delta_days: 30,
        likelihood_meeting_current_date: 0.2,
      },
    });
    
    const result = executeBeliefToSuggestionPipelineV2([belief]);
    
    // Should emit exactly one suggestion
    expect(result.suggestions).toHaveLength(1);
    
    const suggestion = result.suggestions[0];
    
    // Should be mutate_release_date (high confidence + actionability)
    expect(suggestion.action).toBe('mutate_release_date');
    
    // Should not need clarification (high confidence)
    expect(suggestion.status).toBe('suggested');
    
    // Should be execution eligible (high quality)
    expect(result.debug?.execution_eligible_count).toBe(1);
    
    // Invariant I3
    expect(result.debug?.mutate_release_date_actions).toBe(1);
  });
});

// ============================================
// Test Group: T5 - Non-initiative belief
// ============================================

describe('T5: Non-initiative belief', () => {
  it('should emit comment suggestion for non-initiative domains', () => {
    const belief = createTestBelief({
      dimension: 'other',
      confidence_score: 0.8,
      summary: 'Bug fix needed for login flow',
      // No subject_initiative_id
    });
    
    const result = executeBeliefToSuggestionPipelineV2([belief]);
    
    // Should emit exactly one suggestion
    expect(result.suggestions).toHaveLength(1);
    
    const suggestion = result.suggestions[0];
    
    // Should be comment (non-initiative domain)
    expect(suggestion.action).toBe('comment');
    
    // Evidence spans present
    expect(suggestion.evidence_spans.length).toBeGreaterThan(0);
  });
});

// ============================================
// Test Group: T6 - Pure status/context belief
// ============================================

describe('T6: Pure status/context belief', () => {
  it('should NOT emit suggestion for pure status beliefs', () => {
    const belief = createTestBelief({
      summary: 'Current status is active',
      confidence_score: 0.2,
      impact_level: 'low',
      polarity: 'neutral',
      dimension: 'status_only',
    });
    
    const result = executeBeliefToSuggestionPipelineV2([belief]);
    
    // Should NOT emit suggestion
    expect(result.suggestions).toHaveLength(0);
    expect(result.debug?.pure_status_beliefs).toBe(1);
  });
});

// ============================================
// Test Group: T7 - Multiple beliefs, mixed types
// ============================================

describe('T7: Multiple beliefs, some pure status, some plan-change', () => {
  it('should emit suggestions only for non-pure-status beliefs', () => {
    const beliefs: BeliefWithRouting[] = [
      // Pure status belief (should be dropped)
      createTestBelief({
        id: 'belief_1',
        summary: 'Current status is active',
        dimension: 'status_only',
        confidence_score: 0.2,
      }),
      
      // Pure status belief (should be dropped)
      createTestBelief({
        id: 'belief_2',
        summary: 'FYI: project is still on track',
        confidence_score: 0.3,
        impact_level: 'low',
        polarity: 'neutral',
      }),
      
      // Plan-change belief with low confidence (should emit comment + clarification)
      createTestBelief({
        id: 'belief_3',
        summary: 'Team mentioned potential timeline slip',
        dimension: 'timeline',
        confidence_score: 0.4,
        subject_initiative_id: 'init_1',
      }),
    ];
    
    const result = executeBeliefToSuggestionPipelineV2(beliefs);
    
    // Should emit 1 suggestion (from belief_3)
    expect(result.suggestions).toHaveLength(1);
    expect(result.debug?.pure_status_beliefs).toBe(2);
    expect(result.debug?.non_status_beliefs).toBe(1);
    
    const suggestion = result.suggestions[0];
    expect(suggestion.action).toBe('comment');
    expect(suggestion.status).toBe('needs_clarification');
    
    // Invariant I1 holds
    expect(result.debug?.invariant_I1_holds).toBe(true);
  });
});

// ============================================
// Test Group: T8 - Evidence span fallback
// ============================================

describe('T8: Evidence span fallback', () => {
  it('should synthesize fallback evidence when belief has no spans', () => {
    const belief = createTestBelief({
      evidence_spans: [], // Empty spans
      summary: 'Timeline might slip due to dependency',
      confidence_score: 0.7,
    });
    
    const result = executeBeliefToSuggestionPipelineV2([belief]);
    
    // Should emit suggestion
    expect(result.suggestions).toHaveLength(1);
    
    const suggestion = result.suggestions[0];
    
    // Should have synthesized evidence spans
    expect(suggestion.evidence_spans).toBeDefined();
    expect(suggestion.evidence_spans.length).toBeGreaterThan(0);
    
    // Invariant I5 holds
    expect(result.debug?.invariant_I5_holds).toBe(true);
  });
});

// ============================================
// Test Group: T9 - Threshold changes don't change visibility
// ============================================

describe('T9: Threshold changes don\'t change visibility', () => {
  it('should maintain suggestion count when varying thresholds', () => {
    const beliefs: BeliefWithRouting[] = [
      createTestBelief({
        id: 'belief_1',
        dimension: 'timeline',
        confidence_score: 0.6,
        subject_initiative_id: 'init_1',
        timeline_signal: {
          refers_to_date: true,
          current_release_date: '2026-03-01',
          mentioned_date: '2026-04-01',
          suggested_delta_days: 30,
          likelihood_meeting_current_date: 0.4,
        },
      }),
    ];
    
    // Try with low thresholds
    const lowThresholdConfig: DecisionModelConfigV2 = {
      ...DEFAULT_DECISION_MODEL_CONFIG_V2,
      T_MIN_CONF_FOR_MUTATION: 0.5,
      T_MIN_ACT_FOR_MUTATION: 0.4,
      T_MIN_CONF_FOR_EXECUTION_ELIGIBLE: 0.6,
      T_MIN_ACT_FOR_EXECUTION_ELIGIBLE: 0.5,
    };
    
    const resultLow = executeBeliefToSuggestionPipelineV2(beliefs, lowThresholdConfig);
    
    // Try with high thresholds
    const highThresholdConfig: DecisionModelConfigV2 = {
      ...DEFAULT_DECISION_MODEL_CONFIG_V2,
      T_MIN_CONF_FOR_MUTATION: 0.9,
      T_MIN_ACT_FOR_MUTATION: 0.8,
      T_MIN_CONF_FOR_EXECUTION_ELIGIBLE: 0.95,
      T_MIN_ACT_FOR_EXECUTION_ELIGIBLE: 0.9,
    };
    
    const resultHigh = executeBeliefToSuggestionPipelineV2(beliefs, highThresholdConfig);
    
    // Suggestion count should be the same
    expect(resultLow.suggestions).toHaveLength(1);
    expect(resultHigh.suggestions).toHaveLength(1);
    
    // But action and flags should differ
    expect(resultLow.suggestions[0].action).toBe('mutate_release_date'); // Low threshold allows mutation
    expect(resultHigh.suggestions[0].action).toBe('comment'); // High threshold downgrades to comment
    
    // Execution eligibility differs
    expect(resultLow.debug?.execution_eligible_count).toBe(1);
    expect(resultHigh.debug?.execution_eligible_count).toBe(0);
  });
});

// ============================================
// Test Group: Invariant Enforcement
// ============================================

describe('Invariant Enforcement', () => {
  it('should enforce I1: non-status beliefs always produce suggestions', () => {
    const beliefs: BeliefWithRouting[] = [
      createTestBelief({
        confidence_score: 0.1, // Very low
        impact_level: 'low',
        summary: 'Minor timeline concern about release slip',
        dimension: 'timeline', // Explicitly timeline dimension (not pure status)
        subject_initiative_id: 'init_1', // Has initiative mapping
      }),
    ];
    
    const result = executeBeliefToSuggestionPipelineV2(beliefs);
    
    // Even with very low confidence, should emit suggestion
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.debug?.invariant_I1_holds).toBe(true);
  });
  
  it('REGRESSION: plan_change with low actionability should emit comment with clarification', () => {
    // This is the exact scenario from the plan:
    // - Has intentLabel="plan_change" (timeline dimension, not pure status)
    // - Produces valid belief and evidence
    // - Validators would pass
    // - Has actionabilityScore just below old thresholds
    // Before fix: no suggestion emitted
    // After fix: suggestion emitted as comment with needs_clarification=true
    
    const belief = createTestBelief({
      id: 'regression_belief_1',
      dimension: 'timeline',
      confidence_score: 0.45, // Below mutation threshold but above zero
      impact_level: 'low', // Low actionability
      subject_initiative_id: 'init_1',
      timeline_signal: {
        refers_to_date: true,
        current_release_date: '2026-03-01',
        mentioned_date: null, // No concrete date = low actionability
        suggested_delta_days: null,
        likelihood_meeting_current_date: 0.3,
      },
      summary: 'Timeline might slip due to dependency',
      evidence_spans: [
        {
          meeting_id: 'meeting_1',
          start_char: 0,
          end_char: 40,
        },
      ],
    });
    
    const result = executeBeliefToSuggestionPipelineV2([belief]);
    
    // MUST emit exactly one suggestion (not zero!)
    expect(result.suggestions).toHaveLength(1);
    
    const suggestion = result.suggestions[0];
    
    // Should be comment (low actionability downgrades from mutate_release_date)
    expect(suggestion.action).toBe('comment');
    
    // Should need clarification (low confidence/actionability)
    expect(suggestion.status).toBe('needs_clarification');
    
    // Should have evidence spans
    expect(suggestion.evidence_spans).toBeDefined();
    expect(suggestion.evidence_spans.length).toBeGreaterThan(0);
    
    // Invariants hold
    expect(result.debug?.invariant_I1_holds).toBe(true);
    expect(result.debug?.invariant_I2_holds).toBe(true);
    expect(result.debug?.invariant_I5_holds).toBe(true);
  });
  
  it('should enforce I2: low confidence never hides suggestions', () => {
    const beliefs: BeliefWithRouting[] = [
      createTestBelief({
        confidence_score: 0.05, // Extremely low
      }),
      createTestBelief({
        confidence_score: 0.15,
      }),
      createTestBelief({
        confidence_score: 0.35,
      }),
    ];
    
    const result = executeBeliefToSuggestionPipelineV2(beliefs);
    
    // All beliefs should produce suggestions
    expect(result.suggestions).toHaveLength(3);
    expect(result.debug?.invariant_I2_holds).toBe(true);
  });
  
  it('should enforce I5: all suggestions have evidence spans', () => {
    const beliefs: BeliefWithRouting[] = [
      createTestBelief({
        evidence_spans: [],
      }),
      createTestBelief({
        evidence_spans: [{ meeting_id: 'm1', start_char: 0, end_char: 10 }],
      }),
    ];
    
    const result = executeBeliefToSuggestionPipelineV2(beliefs);
    
    // All suggestions should have evidence spans
    for (const suggestion of result.suggestions) {
      expect(suggestion.evidence_spans.length).toBeGreaterThan(0);
    }
    
    expect(result.debug?.invariant_I5_holds).toBe(true);
  });
});
