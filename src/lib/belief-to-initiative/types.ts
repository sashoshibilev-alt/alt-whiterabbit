/**
 * Belief-to-Initiative Suggestion Conversion Types
 * 
 * Type definitions for converting execution-agnostic beliefs into
 * initiative-level suggestions (comment and mutate_release_date actions).
 */

import type { Belief, BeliefEvidenceSpan } from '../belief-pipeline/types';

// ============================================
// Input: Enhanced Belief with Initiative Mapping
// ============================================

/**
 * Belief with initiative routing information
 */
export interface BeliefWithRouting extends Belief {
  subject_initiative_id?: string;
  initiative_match_scores?: Record<string, number>; // initiative_id -> similarity score
  impact_level?: 'low' | 'medium' | 'high' | 'critical';
  polarity?: 'positive' | 'negative' | 'neutral';
  timeline_signal?: TimelineSignal;
  topic_embedding?: number[]; // for clustering/dedup
}

/**
 * Timeline-specific signals extracted from a belief
 */
export interface TimelineSignal {
  refers_to_date: boolean;
  current_release_date?: string | null;
  mentioned_date?: string | null;
  suggested_delta_days?: number | null; // positive=slip, negative=pull-in
  likelihood_meeting_current_date?: number | null; // 0-1 confidence
}

// ============================================
// Intermediate: Implication Classification
// ============================================

/**
 * Implication kind determines what action(s) to suggest
 */
export type ImplicationKind = 
  | 'pure_commentary'      // No date change implied
  | 'timeline_risk'        // Current date unlikely/impossible
  | 'timeline_pull_in'     // Can ship earlier
  | 'timeline_uncertain';  // Vague or conflicting timing signals

/**
 * Classified implication from a belief
 */
export interface BeliefImplication {
  belief_id: string;
  kind: ImplicationKind;
  has_concrete_date: boolean;
  estimated_delta_days?: number;
  confidence: number; // inherited from belief, may be adjusted
}

// ============================================
// Output: Initiative Suggestions
// ============================================

/**
 * Suggestion action types (only these two, per spec)
 */
export type SuggestionAction = 'comment' | 'mutate_release_date';

/**
 * Suggestion status
 */
export type SuggestionStatus = 'suggested' | 'needs_clarification';

/**
 * Comment suggestion payload
 */
export interface CommentPayload {
  body: string;
  tone?: 'neutral' | 'caution' | 'opportunity';
}

/**
 * Release date mutation payload
 */
export interface MutateReleaseDatePayload {
  current_release_date: string;
  proposed_release_date: string | null; // null = needs clarification
  direction: 'push_back' | 'pull_in';
  rationale: string;
  confidence: number;
}

/**
 * Evidence span reference in a suggestion
 */
export interface EvidenceSpanRef {
  belief_id: string;
  meeting_id: string;
  note_id: string;
  start_char: number;
  end_char: number;
  snippet: string;
  speaker?: string;
  timestamp_ms?: number;
}

/**
 * Initiative suggestion (output)
 */
export interface InitiativeSuggestion {
  id: string;
  target_initiative_id?: string; // may be unset for ambiguous items
  action: SuggestionAction;
  status: SuggestionStatus;
  payload: CommentPayload | MutateReleaseDatePayload;
  belief_ids: string[]; // supporting beliefs
  evidence_spans: EvidenceSpanRef[];
  created_from_meeting_id?: string;
  created_at: string; // ISO timestamp
  spam_score: number; // for ranking, not dropping
  priority_score: number; // computed from impact, confidence, recency, novelty
}

// ============================================
// Clustering and Aggregation
// ============================================

/**
 * Cluster of related beliefs
 */
export interface BeliefCluster {
  cluster_id: string;
  beliefs: BeliefWithRouting[];
  target_initiative_id?: string;
  implication_kind: ImplicationKind;
  topic_centroid?: number[]; // average embedding
  aggregate_confidence: number;
}

// ============================================
// Configuration
// ============================================

/**
 * Thresholds for suggestion generation
 */
export interface SuggestionThresholds {
  // Initiative mapping
  min_initiative_match_score: number; // 0.7 - strong match required
  min_match_gap: number; // 0.2 - gap to next candidate
  ambiguous_match_threshold: number; // 0.4 - below this = too weak
  
  // Confidence
  min_belief_confidence: number; // 0.6
  
  // Impact
  min_impact_level: 'low' | 'medium' | 'high'; // 'medium'
  
  // Timeline mutations
  max_delta_days: number; // 90 - beyond this = needs clarification
  
  // Spam control
  max_comment_suggestions_per_initiative_per_meeting: number; // 3
  max_release_date_suggestions_per_initiative_per_meeting: number; // 1
  
  // Clustering
  embedding_similarity_threshold: number; // 0.85 - for dedup
}

export const DEFAULT_SUGGESTION_THRESHOLDS: SuggestionThresholds = {
  min_initiative_match_score: 0.7,
  min_match_gap: 0.2,
  ambiguous_match_threshold: 0.4,
  min_belief_confidence: 0.6,
  min_impact_level: 'medium',
  max_delta_days: 90,
  max_comment_suggestions_per_initiative_per_meeting: 3,
  max_release_date_suggestions_per_initiative_per_meeting: 1,
  embedding_similarity_threshold: 0.85,
};

/**
 * Pipeline configuration
 */
export interface BeliefToSuggestionConfig {
  thresholds: SuggestionThresholds;
  enable_clustering: boolean;
  enable_cross_meeting_dedup: boolean;
}

export const DEFAULT_BELIEF_TO_SUGGESTION_CONFIG: BeliefToSuggestionConfig = {
  thresholds: DEFAULT_SUGGESTION_THRESHOLDS,
  enable_clustering: true,
  enable_cross_meeting_dedup: true,
};

// ============================================
// Pipeline Result
// ============================================

/**
 * Result of the belief-to-suggestion conversion
 */
export interface BeliefToSuggestionResult {
  suggestions: InitiativeSuggestion[];
  debug?: {
    total_beliefs: number;
    classified_implications: number;
    pre_filter_suggestions: number;
    dropped_low_confidence: number;
    dropped_ambiguous_initiative: number;
    aggregated_clusters: number;
    rate_limited: number;
  };
}
