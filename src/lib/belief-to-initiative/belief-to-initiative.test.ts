/**
 * Tests for Belief-to-Initiative Suggestion Conversion
 */

import { describe, it, expect } from 'vitest';
import type { BeliefWithRouting } from './types';
import { classifyImplication } from './implicationClassifier';
import { buildSuggestions } from './suggestionBuilder';
import { DEFAULT_SUGGESTION_THRESHOLDS } from './types';
import { applyGuardrails } from './guardrailFilter';
import { computeFeedbackStats, recommendThresholdAdjustments } from './feedbackLoop';

describe('Implication Classifier', () => {
  it('should classify pure commentary', () => {
    const belief: BeliefWithRouting = {
      id: 'b1',
      meeting_id: 'm1',
      created_at: '2026-02-03T10:00:00Z',
      dimension: 'risk',
      subject_handle: 'payment-integration',
      summary: 'We discovered a new integration risk with payment provider',
      before_state: 'No known risks',
      after_state: 'Payment integration has security concern',
      source_type: 'explicit',
      evidence_spans: [],
      confidence_score: 0.8,
      confidence_band: 'high',
      needs_clarification: false,
      clarification_reasons: [],
      impact_level: 'high',
    };

    const implication = classifyImplication(belief);
    
    expect(implication.kind).toBe('pure_commentary');
    expect(implication.has_concrete_date).toBe(false);
  });

  it('should classify timeline risk with concrete date', () => {
    const belief: BeliefWithRouting = {
      id: 'b2',
      meeting_id: 'm1',
      created_at: '2026-02-03T10:00:00Z',
      dimension: 'timeline',
      subject_handle: 'checkout-mvp',
      summary: "We won't make March 1; realistically we're looking at mid-March",
      before_state: 'Target: March 1',
      after_state: 'Target: March 15 (estimated)',
      source_type: 'explicit',
      evidence_spans: [],
      confidence_score: 0.85,
      confidence_band: 'high',
      needs_clarification: false,
      clarification_reasons: [],
      timeline_signal: {
        refers_to_date: true,
        current_release_date: '2026-03-01',
        mentioned_date: '2026-03-15',
        suggested_delta_days: 14,
        likelihood_meeting_current_date: 0.2,
      },
      impact_level: 'high',
    };

    const implication = classifyImplication(belief);
    
    expect(implication.kind).toBe('timeline_risk');
    expect(implication.has_concrete_date).toBe(true);
    expect(implication.estimated_delta_days).toBe(14);
  });

  it('should classify timeline pull-in', () => {
    const belief: BeliefWithRouting = {
      id: 'b3',
      meeting_id: 'm1',
      created_at: '2026-02-03T10:00:00Z',
      dimension: 'timeline',
      subject_handle: 'api-v2',
      summary: 'API v2 is ahead of schedule, we can ship a week early',
      before_state: 'Target: Q2',
      after_state: 'Can ship early',
      source_type: 'explicit',
      evidence_spans: [],
      confidence_score: 0.75,
      confidence_band: 'high',
      needs_clarification: false,
      clarification_reasons: [],
      timeline_signal: {
        refers_to_date: true,
        current_release_date: '2026-06-30',
        mentioned_date: null,
        suggested_delta_days: -7,
        likelihood_meeting_current_date: 0.9,
      },
      polarity: 'positive',
      impact_level: 'medium',
    };

    const implication = classifyImplication(belief);
    
    expect(implication.kind).toBe('timeline_pull_in');
    expect(implication.estimated_delta_days).toBe(-7);
  });

  it('should classify timeline uncertain', () => {
    const belief: BeliefWithRouting = {
      id: 'b4',
      meeting_id: 'm1',
      created_at: '2026-02-03T10:00:00Z',
      dimension: 'timeline',
      subject_handle: 'mobile-app',
      summary: 'Not sure if we can hit the Q1 deadline, depends on design approval',
      before_state: 'Target: Q1',
      after_state: 'Uncertain',
      source_type: 'explicit',
      evidence_spans: [],
      confidence_score: 0.6,
      confidence_band: 'uncertain',
      needs_clarification: true,
      clarification_reasons: ['ambiguous_timeline'],
      timeline_signal: {
        refers_to_date: true,
        current_release_date: '2026-03-31',
        mentioned_date: null,
        suggested_delta_days: null,
        likelihood_meeting_current_date: 0.5,
      },
      impact_level: 'medium',
    };

    const implication = classifyImplication(belief);
    
    expect(implication.kind).toBe('timeline_uncertain');
  });
});

describe('Suggestion Builder', () => {
  it('should build comment suggestion for pure commentary', () => {
    const belief: BeliefWithRouting = {
      id: 'b1',
      meeting_id: 'm1',
      created_at: '2026-02-03T10:00:00Z',
      dimension: 'risk',
      subject_handle: 'payment-integration',
      summary: 'We discovered a new integration risk with payment provider',
      before_state: 'No known risks',
      after_state: 'Payment integration has security concern',
      source_type: 'explicit',
      evidence_spans: [],
      confidence_score: 0.8,
      confidence_band: 'high',
      needs_clarification: false,
      clarification_reasons: [],
      subject_initiative_id: 'init_123',
      impact_level: 'high',
    };

    const implication = classifyImplication(belief);
    const suggestions = buildSuggestions(belief, implication, DEFAULT_SUGGESTION_THRESHOLDS);
    
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].action).toBe('comment');
    expect(suggestions[0].status).toBe('suggested');
    expect(suggestions[0].target_initiative_id).toBe('init_123');
  });

  it('should build mutate_release_date suggestion for timeline risk', () => {
    const belief: BeliefWithRouting = {
      id: 'b2',
      meeting_id: 'm1',
      created_at: '2026-02-03T10:00:00Z',
      dimension: 'timeline',
      subject_handle: 'checkout-mvp',
      summary: "We won't make March 1; realistically we're looking at mid-March",
      before_state: 'Target: March 1',
      after_state: 'Target: March 15',
      source_type: 'explicit',
      evidence_spans: [],
      confidence_score: 0.85,
      confidence_band: 'high',
      needs_clarification: false,
      clarification_reasons: [],
      subject_initiative_id: 'init_123',
      timeline_signal: {
        refers_to_date: true,
        current_release_date: '2026-03-01',
        mentioned_date: '2026-03-15',
        suggested_delta_days: 14,
        likelihood_meeting_current_date: 0.2,
      },
      impact_level: 'high',
    };

    const implication = classifyImplication(belief);
    const suggestions = buildSuggestions(belief, implication, DEFAULT_SUGGESTION_THRESHOLDS);
    
    const releaseDateSuggestion = suggestions.find(s => s.action === 'mutate_release_date');
    expect(releaseDateSuggestion).toBeDefined();
    expect(releaseDateSuggestion?.status).toBe('suggested');
    
    const payload = releaseDateSuggestion?.payload as any;
    expect(payload.current_release_date).toBe('2026-03-01');
    expect(payload.proposed_release_date).toBe('2026-03-15');
    expect(payload.direction).toBe('push_back');
  });

  it('should mark as needs_clarification when initiative is ambiguous', () => {
    const belief: BeliefWithRouting = {
      id: 'b3',
      meeting_id: 'm1',
      created_at: '2026-02-03T10:00:00Z',
      dimension: 'risk',
      subject_handle: 'unknown',
      summary: 'There might be some issues with the integration',
      before_state: 'Unknown',
      after_state: 'Unknown',
      source_type: 'implicit',
      evidence_spans: [],
      confidence_score: 0.65,
      confidence_band: 'uncertain',
      needs_clarification: true,
      clarification_reasons: ['ambiguous_scope'],
      initiative_match_scores: {
        'init_123': 0.55,
        'init_456': 0.52,
      },
      impact_level: 'medium',
    };

    const implication = classifyImplication(belief);
    const suggestions = buildSuggestions(belief, implication, DEFAULT_SUGGESTION_THRESHOLDS);
    
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].status).toBe('needs_clarification');
  });
});

describe('Guardrail Filter', () => {
  it('should apply rate limits', () => {
    const suggestions = [];
    
    // Create 5 comment suggestions for the same initiative
    for (let i = 0; i < 5; i++) {
      suggestions.push({
        id: `s${i}`,
        target_initiative_id: 'init_123',
        action: 'comment' as const,
        status: 'suggested' as const,
        payload: { body: `Comment ${i}` },
        belief_ids: [`b${i}`],
        evidence_spans: [],
        created_at: new Date().toISOString(),
        spam_score: 0.1,
        priority_score: 0.7 + (i * 0.05), // Varied priorities
      });
    }
    
    const thresholds = {
      ...DEFAULT_SUGGESTION_THRESHOLDS,
      max_comment_suggestions_per_initiative_per_meeting: 3,
    };
    
    const filtered = applyGuardrails(suggestions, [], thresholds, 'm1', false);
    
    // Should cap at 3
    expect(filtered.length).toBe(3);
    
    // Should keep highest priority ones
    expect(filtered.map(s => s.id)).toContain('s4');
    expect(filtered.map(s => s.id)).toContain('s3');
    expect(filtered.map(s => s.id)).toContain('s2');
  });
});

describe('Feedback Loop', () => {
  it('should compute feedback stats', () => {
    const events = [
      { suggestion_id: 's1', action: 'accepted' as const, timestamp: '2026-02-03T10:00:00Z', time_to_action_seconds: 30 },
      { suggestion_id: 's2', action: 'accepted' as const, timestamp: '2026-02-03T10:01:00Z', time_to_action_seconds: 45 },
      { suggestion_id: 's3', action: 'dismissed' as const, timestamp: '2026-02-03T10:02:00Z', dismiss_reason: 'too_ambiguous' as const },
      { suggestion_id: 's4', action: 'dismissed' as const, timestamp: '2026-02-03T10:03:00Z', dismiss_reason: 'spam' as const },
    ];
    
    const suggestions = [
      { id: 's1', action: 'comment' as const, status: 'suggested' as const },
      { id: 's2', action: 'mutate_release_date' as const, status: 'suggested' as const },
      { id: 's3', action: 'comment' as const, status: 'needs_clarification' as const },
      { id: 's4', action: 'comment' as const, status: 'suggested' as const },
    ] as any[];
    
    const stats = computeFeedbackStats(events, suggestions);
    
    expect(stats.total_suggestions).toBe(4);
    expect(stats.total_accepted).toBe(2);
    expect(stats.total_dismissed).toBe(2);
    expect(stats.acceptance_rate).toBe(0.5);
    expect(stats.dismissal_rate).toBe(0.5);
    expect(stats.avg_time_to_action_seconds).toBe(37.5);
    expect(stats.dismiss_reasons.too_ambiguous).toBe(1);
    expect(stats.dismiss_reasons.spam).toBe(1);
  });

  it('should recommend threshold adjustments for high wrong_initiative dismissals', () => {
    const stats = {
      total_suggestions: 10,
      total_accepted: 4,
      total_dismissed: 5,
      total_edited: 1,
      acceptance_rate: 0.4,
      dismissal_rate: 0.5,
      edit_rate: 0.1,
      avg_time_to_action_seconds: 60,
      comment_acceptance_rate: 0.4,
      release_date_acceptance_rate: 0.4,
      suggested_acceptance_rate: 0.5,
      needs_clarification_acceptance_rate: 0.3,
      dismiss_reasons: {
        wrong_initiative: 3,
        not_real_decision: 1,
        too_ambiguous: 1,
        wrong_value: 0,
        spam: 0,
        duplicate: 0,
        other: 0,
      },
    };
    
    const adjustments = recommendThresholdAdjustments(stats, DEFAULT_SUGGESTION_THRESHOLDS);
    
    expect(adjustments.length).toBeGreaterThan(0);
    const matchScoreAdj = adjustments.find(a => a.threshold_name === 'min_initiative_match_score');
    expect(matchScoreAdj).toBeDefined();
    expect(matchScoreAdj!.recommended_value).toBeGreaterThan(DEFAULT_SUGGESTION_THRESHOLDS.min_initiative_match_score);
  });
});
