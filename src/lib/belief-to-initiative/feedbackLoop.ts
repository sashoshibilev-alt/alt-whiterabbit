/**
 * Feedback Loop
 * 
 * Captures user actions (accept, edit, dismiss) on suggestions to iteratively
 * tune thresholds, spam scoring, and aggregation behavior.
 */

import type {
  InitiativeSuggestion,
  SuggestionThresholds,
} from './types';

// ============================================
// Feedback Event Types
// ============================================

export type FeedbackAction = 'accepted' | 'dismissed' | 'edited';

export interface FeedbackEvent {
  suggestion_id: string;
  action: FeedbackAction;
  timestamp: string;
  user_id?: string;
  
  // Action-specific metadata
  dismiss_reason?: DismissReason;
  edit_type?: EditType;
  time_to_action_seconds?: number;
}

export type DismissReason =
  | 'wrong_initiative'
  | 'not_real_decision'
  | 'too_ambiguous'
  | 'wrong_value'
  | 'spam'
  | 'duplicate'
  | 'other';

export type EditType =
  | 'minor_refinement'  // Small tweaks
  | 'major_correction'  // Significant changes
  | 'changed_target';   // Changed initiative

// ============================================
// Feedback Aggregation
// ============================================

export interface FeedbackStats {
  total_suggestions: number;
  total_accepted: number;
  total_dismissed: number;
  total_edited: number;
  
  acceptance_rate: number;
  dismissal_rate: number;
  edit_rate: number;
  
  avg_time_to_action_seconds: number;
  
  // Breakdown by suggestion action type
  comment_acceptance_rate: number;
  release_date_acceptance_rate: number;
  
  // Breakdown by status
  suggested_acceptance_rate: number;
  needs_clarification_acceptance_rate: number;
  
  // Dismiss reasons
  dismiss_reasons: Record<DismissReason, number>;
}

/**
 * Compute feedback statistics from events
 */
export function computeFeedbackStats(
  events: FeedbackEvent[],
  suggestions: InitiativeSuggestion[]
): FeedbackStats {
  const stats: FeedbackStats = {
    total_suggestions: suggestions.length,
    total_accepted: 0,
    total_dismissed: 0,
    total_edited: 0,
    acceptance_rate: 0,
    dismissal_rate: 0,
    edit_rate: 0,
    avg_time_to_action_seconds: 0,
    comment_acceptance_rate: 0,
    release_date_acceptance_rate: 0,
    suggested_acceptance_rate: 0,
    needs_clarification_acceptance_rate: 0,
    dismiss_reasons: {
      wrong_initiative: 0,
      not_real_decision: 0,
      too_ambiguous: 0,
      wrong_value: 0,
      spam: 0,
      duplicate: 0,
      other: 0,
    },
  };
  
  // Count actions
  for (const event of events) {
    if (event.action === 'accepted') {
      stats.total_accepted++;
    } else if (event.action === 'dismissed') {
      stats.total_dismissed++;
      if (event.dismiss_reason) {
        stats.dismiss_reasons[event.dismiss_reason]++;
      }
    } else if (event.action === 'edited') {
      stats.total_edited++;
    }
  }
  
  // Compute rates
  if (stats.total_suggestions > 0) {
    stats.acceptance_rate = stats.total_accepted / stats.total_suggestions;
    stats.dismissal_rate = stats.total_dismissed / stats.total_suggestions;
    stats.edit_rate = stats.total_edited / stats.total_suggestions;
  }
  
  // Compute avg time to action
  const timesWithAction = events
    .filter(e => e.time_to_action_seconds !== undefined)
    .map(e => e.time_to_action_seconds!);
  
  if (timesWithAction.length > 0) {
    stats.avg_time_to_action_seconds = 
      timesWithAction.reduce((sum, t) => sum + t, 0) / timesWithAction.length;
  }
  
  // Breakdown by action type
  const commentSuggestions = suggestions.filter(s => s.action === 'comment');
  const releaseDateSuggestions = suggestions.filter(s => s.action === 'mutate_release_date');
  
  const commentAccepted = events.filter(e => 
    e.action === 'accepted' && 
    suggestions.find(s => s.id === e.suggestion_id)?.action === 'comment'
  ).length;
  
  const releaseDateAccepted = events.filter(e =>
    e.action === 'accepted' &&
    suggestions.find(s => s.id === e.suggestion_id)?.action === 'mutate_release_date'
  ).length;
  
  if (commentSuggestions.length > 0) {
    stats.comment_acceptance_rate = commentAccepted / commentSuggestions.length;
  }
  
  if (releaseDateSuggestions.length > 0) {
    stats.release_date_acceptance_rate = releaseDateAccepted / releaseDateSuggestions.length;
  }
  
  // Breakdown by status
  const suggestedSuggestions = suggestions.filter(s => s.status === 'suggested');
  const needsClarificationSuggestions = suggestions.filter(s => s.status === 'needs_clarification');
  
  const suggestedAccepted = events.filter(e =>
    e.action === 'accepted' &&
    suggestions.find(s => s.id === e.suggestion_id)?.status === 'suggested'
  ).length;
  
  const needsClarificationAccepted = events.filter(e =>
    e.action === 'accepted' &&
    suggestions.find(s => s.id === e.suggestion_id)?.status === 'needs_clarification'
  ).length;
  
  if (suggestedSuggestions.length > 0) {
    stats.suggested_acceptance_rate = suggestedAccepted / suggestedSuggestions.length;
  }
  
  if (needsClarificationSuggestions.length > 0) {
    stats.needs_clarification_acceptance_rate = 
      needsClarificationAccepted / needsClarificationSuggestions.length;
  }
  
  return stats;
}

// ============================================
// Threshold Adjustment
// ============================================

/**
 * Adjustment recommendations based on feedback
 */
export interface ThresholdAdjustment {
  threshold_name: keyof SuggestionThresholds;
  current_value: number;
  recommended_value: number;
  reason: string;
  confidence: number; // 0-1
}

/**
 * Recommend threshold adjustments based on feedback stats
 */
export function recommendThresholdAdjustments(
  stats: FeedbackStats,
  currentThresholds: SuggestionThresholds
): ThresholdAdjustment[] {
  const adjustments: ThresholdAdjustment[] = [];
  
  // If dismissal rate is high due to wrong_initiative, tighten matching
  if (
    stats.dismissal_rate > 0.4 &&
    stats.dismiss_reasons.wrong_initiative > stats.total_dismissed * 0.3
  ) {
    adjustments.push({
      threshold_name: 'min_initiative_match_score',
      current_value: currentThresholds.min_initiative_match_score,
      recommended_value: Math.min(0.85, currentThresholds.min_initiative_match_score + 0.05),
      reason: 'High dismissal rate due to wrong initiative mapping',
      confidence: 0.8,
    });
    
    adjustments.push({
      threshold_name: 'min_match_gap',
      current_value: currentThresholds.min_match_gap,
      recommended_value: Math.min(0.3, currentThresholds.min_match_gap + 0.05),
      reason: 'Increase gap requirement for more confident matches',
      confidence: 0.7,
    });
  }
  
  // If dismissal rate is high due to ambiguity, increase confidence threshold
  if (
    stats.dismissal_rate > 0.4 &&
    stats.dismiss_reasons.too_ambiguous > stats.total_dismissed * 0.3
  ) {
    adjustments.push({
      threshold_name: 'min_belief_confidence',
      current_value: currentThresholds.min_belief_confidence,
      recommended_value: Math.min(0.75, currentThresholds.min_belief_confidence + 0.05),
      reason: 'High dismissal rate due to ambiguous suggestions',
      confidence: 0.75,
    });
  }
  
  // If spam dismissals are high, adjust rate limits
  if (stats.dismiss_reasons.spam > stats.total_dismissed * 0.2) {
    adjustments.push({
      threshold_name: 'max_comment_suggestions_per_initiative_per_meeting',
      current_value: currentThresholds.max_comment_suggestions_per_initiative_per_meeting,
      recommended_value: Math.max(1, currentThresholds.max_comment_suggestions_per_initiative_per_meeting - 1),
      reason: 'Spam dismissals suggest too many comment suggestions',
      confidence: 0.65,
    });
  }
  
  // If acceptance rate is very high, we might be too conservative
  if (stats.acceptance_rate > 0.8 && stats.total_suggestions >= 20) {
    adjustments.push({
      threshold_name: 'min_belief_confidence',
      current_value: currentThresholds.min_belief_confidence,
      recommended_value: Math.max(0.5, currentThresholds.min_belief_confidence - 0.05),
      reason: 'High acceptance rate suggests we can be less conservative',
      confidence: 0.6,
    });
  }
  
  // If needs_clarification acceptance is as good as suggested, we can be more aggressive
  if (
    stats.needs_clarification_acceptance_rate > 0 &&
    Math.abs(stats.needs_clarification_acceptance_rate - stats.suggested_acceptance_rate) < 0.1 &&
    stats.total_suggestions >= 20
  ) {
    adjustments.push({
      threshold_name: 'ambiguous_match_threshold',
      current_value: currentThresholds.ambiguous_match_threshold,
      recommended_value: Math.max(0.3, currentThresholds.ambiguous_match_threshold - 0.05),
      reason: 'needs_clarification suggestions performing well, can surface more',
      confidence: 0.55,
    });
  }
  
  return adjustments;
}

/**
 * Apply threshold adjustments
 */
export function applyThresholdAdjustments(
  currentThresholds: SuggestionThresholds,
  adjustments: ThresholdAdjustment[],
  minConfidence: number = 0.6
): SuggestionThresholds {
  const updated = { ...currentThresholds };
  
  for (const adjustment of adjustments) {
    if (adjustment.confidence >= minConfidence) {
      updated[adjustment.threshold_name] = adjustment.recommended_value as any;
    }
  }
  
  return updated;
}

// ============================================
// Pattern Learning
// ============================================

/**
 * Pattern learned from user feedback
 */
export interface LearnedPattern {
  pattern_type: 'spam_indicator' | 'quality_indicator' | 'initiative_hint';
  pattern: string;
  score_adjustment: number; // +/- adjustment to spam/priority score
  confidence: number;
  supporting_examples: number;
}

/**
 * Learn patterns from dismissed suggestions
 */
export function learnSpamPatterns(
  dismissedSuggestions: InitiativeSuggestion[],
  dismissEvents: FeedbackEvent[]
): LearnedPattern[] {
  const patterns: LearnedPattern[] = [];
  
  // Find common phrases in spam dismissals
  const spamDismissals = dismissEvents.filter(e => e.dismiss_reason === 'spam');
  const spamSuggestions = dismissedSuggestions.filter(s =>
    spamDismissals.some(e => e.suggestion_id === s.id)
  );
  
  if (spamSuggestions.length >= 3) {
    // Extract common tokens
    const allTokens: string[] = [];
    for (const suggestion of spamSuggestions) {
      const payload = suggestion.payload as any;
      const text = payload.body || payload.rationale || '';
      const tokens = text.toLowerCase().split(/\s+/).filter((t: string) => t.length >= 4);
      allTokens.push(...tokens);
    }
    
    // Find frequent tokens
    const tokenCounts = new Map<string, number>();
    for (const token of allTokens) {
      tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
    }
    
    for (const [token, count] of tokenCounts.entries()) {
      if (count >= 2) {
        patterns.push({
          pattern_type: 'spam_indicator',
          pattern: token,
          score_adjustment: 0.2,
          confidence: Math.min(0.9, count / spamSuggestions.length),
          supporting_examples: count,
        });
      }
    }
  }
  
  return patterns;
}

/**
 * Learn quality indicators from accepted suggestions
 */
export function learnQualityPatterns(
  acceptedSuggestions: InitiativeSuggestion[],
  acceptEvents: FeedbackEvent[]
): LearnedPattern[] {
  const patterns: LearnedPattern[] = [];
  
  // Analyze accepted suggestions for quality signals
  // For now, we identify high-confidence accepted suggestions
  const highConfidenceAccepted = acceptedSuggestions.filter(s => {
    const event = acceptEvents.find(e => e.suggestion_id === s.id);
    // Quick acceptance = high quality
    return event && event.time_to_action_seconds && event.time_to_action_seconds < 60;
  });
  
  if (highConfidenceAccepted.length >= 3) {
    // These are clearly high-quality patterns
    patterns.push({
      pattern_type: 'quality_indicator',
      pattern: 'quick_acceptance',
      score_adjustment: 0.15,
      confidence: 0.8,
      supporting_examples: highConfidenceAccepted.length,
    });
  }
  
  return patterns;
}

// ============================================
// Feedback Storage & Retrieval
// ============================================

/**
 * Store feedback event (to be implemented with actual DB)
 */
export async function storeFeedbackEvent(event: FeedbackEvent): Promise<void> {
  // This would store to a database
  // For now, it's a placeholder
  console.log('Storing feedback event:', event);
}

/**
 * Retrieve feedback events for analysis (to be implemented with actual DB)
 */
export async function retrieveFeedbackEvents(
  filters?: {
    start_date?: string;
    end_date?: string;
    action?: FeedbackAction;
    user_id?: string;
  }
): Promise<FeedbackEvent[]> {
  // This would query a database
  // For now, return empty array
  return [];
}
