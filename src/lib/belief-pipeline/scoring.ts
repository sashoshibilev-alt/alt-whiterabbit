/**
 * Stage 5: Scoring & Confidence
 * 
 * Computes final confidence scores and determines clarification needs
 */

import {
  Stage4Output,
  Stage5Output,
  Belief,
  BeliefScoringFeatures,
  BeliefConfidenceBand,
  ClarificationReason,
  BeliefPipelineConfig,
  DEFAULT_PIPELINE_CONFIG,
} from './types';
import { clamp01, hasAmbiguousTimeline, hasAmbiguousScope, isVagueSubjectHandle } from './utils';

/**
 * Compute scoring features for a belief
 */
function computeScoringFeatures(belief: Belief): BeliefScoringFeatures {
  // f_evidence_count = log(1 + |evidence_spans|)
  const f_evidence_count = Math.log(1 + belief.evidence_spans.length);
  
  // f_explicit_before: 1 if there's at least one "before" span, else 0
  const f_explicit_before = belief.evidence_spans.some(s => s.role === 'before') ? 1 : 0;
  
  // f_explicit_after: 1 if there's at least one "after" span, else 0
  const f_explicit_after = belief.evidence_spans.some(s => s.role === 'after') ? 1 : 0;
  
  // f_contradictions: 1 if there are contradicting spans, else 0
  const f_contradictions = belief.evidence_spans.some(s => s.role === 'contradicting') ? 1 : 0;
  
  // f_source_type_weight based on source type
  let f_source_type_weight: number;
  switch (belief.source_type) {
    case 'explicit':
      f_source_type_weight = 1.0;
      break;
    case 'implicit':
      f_source_type_weight = 0.7;
      break;
    case 'external':
      f_source_type_weight = 0.4;
      break;
  }
  
  return {
    f_evidence_count,
    f_explicit_before: f_explicit_before as 0 | 1,
    f_explicit_after: f_explicit_after as 0 | 1,
    f_contradictions: f_contradictions as 0 | 1,
    f_source_type_weight,
  };
}

/**
 * Calculate confidence score from features
 */
function calculateConfidenceScore(
  belief: Belief,
  features: BeliefScoringFeatures,
  config: BeliefPipelineConfig
): number {
  const base = belief.confidence_score; // candidate_score from Stage 3
  
  // evidence_boost = 0.1 * min(f_evidence_count, 3)
  const evidence_boost = config.evidence_boost_weight * Math.min(features.f_evidence_count, 3);
  
  // structure_bonus = 0.1 * (f_explicit_before + f_explicit_after)
  const structure_bonus = config.structure_bonus_weight * (features.f_explicit_before + features.f_explicit_after);
  
  // contradiction_penalty = 0.2 * f_contradictions
  const contradiction_penalty = config.contradiction_penalty * features.f_contradictions;
  
  // confidence_score = clamp01((base * f_source_type_weight) + evidence_boost + structure_bonus - contradiction_penalty)
  const score = (base * features.f_source_type_weight) + evidence_boost + structure_bonus - contradiction_penalty;
  
  return clamp01(score);
}

/**
 * Determine confidence band from score and features
 */
function determineConfidenceBand(
  confidenceScore: number,
  features: BeliefScoringFeatures,
  config: BeliefPipelineConfig
): BeliefConfidenceBand {
  // confidence_band = "high" if confidence_score >= 0.75 and f_contradictions === 0
  if (confidenceScore >= config.confidence_threshold_high && features.f_contradictions === 0) {
    return 'high';
  }
  
  // confidence_band = "uncertain" if confidence_score < 0.75 or f_contradictions === 1
  if (confidenceScore < config.confidence_threshold_high || features.f_contradictions === 1) {
    return 'uncertain';
  }
  
  return 'uncertain';
}

/**
 * Determine if clarification is needed and what reasons
 */
function determineClarification(
  belief: Belief,
  confidenceScore: number,
  confidenceBand: BeliefConfidenceBand,
  features: BeliefScoringFeatures,
  config: BeliefPipelineConfig
): { needs: boolean; reasons: ClarificationReason[] } {
  const reasons: ClarificationReason[] = [];
  
  // Check if confidence is low
  if (confidenceBand === 'uncertain' && confidenceScore <= config.confidence_threshold_uncertain) {
    reasons.push('low_model_confidence');
  }
  
  // Check if depends on external context
  if (belief.source_type === 'external') {
    reasons.push('depends_on_external_context');
  }
  
  // Check for contradictions
  if (features.f_contradictions === 1) {
    reasons.push('conflicting_statements');
  }
  
  // Check for ambiguous timeline
  if (
    belief.dimension === 'timeline' &&
    (hasAmbiguousTimeline(belief.before_state) || hasAmbiguousTimeline(belief.after_state))
  ) {
    reasons.push('ambiguous_timeline');
  }
  
  // Check for ambiguous scope
  if (
    belief.dimension === 'scope' &&
    (hasAmbiguousScope(belief.before_state) || hasAmbiguousScope(belief.after_state))
  ) {
    reasons.push('ambiguous_scope');
  }
  
  // Check for vague subject handle or states
  if (
    isVagueSubjectHandle(belief.subject_handle) ||
    isVagueSubjectHandle(belief.before_state) ||
    isVagueSubjectHandle(belief.after_state)
  ) {
    if (!reasons.includes('low_model_confidence')) {
      reasons.push('low_model_confidence');
    }
  }
  
  return {
    needs: reasons.length > 0,
    reasons,
  };
}

/**
 * Score beliefs and determine confidence
 */
export function scoreBeliefs(
  stage4Output: Stage4Output,
  config: BeliefPipelineConfig = DEFAULT_PIPELINE_CONFIG
): Stage5Output {
  const { meeting, sections, utterances, candidates, beliefs } = stage4Output;
  
  const scoringFeatures = new Map<string, BeliefScoringFeatures>();
  const updatedBeliefs: Belief[] = [];
  
  for (const belief of beliefs) {
    // Compute features
    const features = computeScoringFeatures(belief);
    scoringFeatures.set(belief.id, features);
    
    // Calculate final confidence score
    const confidenceScore = calculateConfidenceScore(belief, features, config);
    
    // Determine confidence band
    const confidenceBand = determineConfidenceBand(confidenceScore, features, config);
    
    // Determine clarification needs
    const clarification = determineClarification(
      belief,
      confidenceScore,
      confidenceBand,
      features,
      config
    );
    
    // Update belief with final scores
    updatedBeliefs.push({
      ...belief,
      confidence_score: confidenceScore,
      confidence_band: confidenceBand,
      needs_clarification: clarification.needs,
      clarification_reasons: clarification.reasons,
    });
  }
  
  return {
    meeting,
    sections,
    utterances,
    candidates,
    beliefs: updatedBeliefs,
    scoring_features: scoringFeatures,
  };
}
