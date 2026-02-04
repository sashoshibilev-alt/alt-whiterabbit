/**
 * Suggestion Builder V2
 * 
 * Builds suggestions from beliefs and decisions, ensuring:
 * - Evidence spans are always present (never empty)
 * - All non-pure-status beliefs produce suggestions
 * - Low confidence is reflected in action type and needs_clarification
 */

import type {
  BeliefWithRouting,
  BeliefDecision,
  InitiativeSuggestion,
  CommentPayload,
  MutateReleaseDatePayload,
  EvidenceSpanRef,
  BeliefClassification,
} from './types';
import { BeliefEvidenceSpan } from '../belief-pipeline/types';

let suggestionIdCounter = 0;

/**
 * Build a suggestion from a belief and its decision
 * 
 * INVARIANT: If decision.should_emit_suggestion is true, this MUST return a suggestion.
 * INVARIANT: All returned suggestions MUST have non-empty evidence_spans.
 */
export function buildSuggestionFromDecision(
  belief: BeliefWithRouting,
  decision: BeliefDecision,
  classification: BeliefClassification
): InitiativeSuggestion | null {
  // Don't emit if decision says not to
  if (!decision.should_emit_suggestion) {
    return null;
  }
  
  // Determine target initiative
  const targetInitiativeId = determineTargetInitiative(belief);
  
  // Build payload based on action
  const payload = buildPayload(belief, decision, classification, targetInitiativeId);
  
  // Convert evidence spans (with fallback)
  const evidenceSpans = convertEvidenceSpansWithFallback(belief);
  
  // Compute scores
  const spamScore = computeSpamScore(belief, decision);
  const priorityScore = computePriorityScore(belief, decision);
  
  // Determine final status
  const status = decision.needs_clarification ? 'needs_clarification' : 'suggested';
  
  return {
    id: `sugg_v2_${++suggestionIdCounter}`,
    target_initiative_id: targetInitiativeId,
    action: decision.action,
    status,
    payload,
    belief_ids: [belief.id],
    evidence_spans: evidenceSpans,
    created_from_meeting_id: belief.meeting_id,
    created_at: new Date().toISOString(),
    spam_score: spamScore,
    priority_score: priorityScore,
  };
}

/**
 * Determine target initiative for a belief
 */
function determineTargetInitiative(belief: BeliefWithRouting): string | undefined {
  // Use explicit mapping if available
  if (belief.subject_initiative_id) {
    return belief.subject_initiative_id;
  }
  
  // Use highest match score if available and strong enough
  if (belief.initiative_match_scores) {
    const scores = Object.entries(belief.initiative_match_scores);
    if (scores.length > 0) {
      scores.sort((a, b) => b[1] - a[1]);
      const topScore = scores[0][1];
      const topId = scores[0][0];
      
      // Only use if score is reasonably strong
      if (topScore >= 0.5) {
        return topId;
      }
    }
  }
  
  return undefined;
}

/**
 * Build payload based on action type
 */
function buildPayload(
  belief: BeliefWithRouting,
  decision: BeliefDecision,
  classification: BeliefClassification,
  targetInitiativeId?: string
): CommentPayload | MutateReleaseDatePayload {
  if (decision.action === 'comment') {
    return buildCommentPayload(belief, decision, classification, targetInitiativeId);
  } else {
    return buildReleaseDatePayload(belief, decision);
  }
}

/**
 * Build comment payload
 */
function buildCommentPayload(
  belief: BeliefWithRouting,
  decision: BeliefDecision,
  classification: BeliefClassification,
  targetInitiativeId?: string
): CommentPayload {
  let body = '';
  let tone: 'neutral' | 'caution' | 'opportunity' = 'neutral';
  
  // If needs clarification due to ambiguous initiative
  if (decision.needs_clarification && !targetInitiativeId) {
    body = `This belief from the meeting might be relevant, but it's unclear which initiative it belongs to.\n\nBelief: "${belief.summary}"\n\nPlease attach it to the right initiative or dismiss it.`;
    tone = 'neutral';
  }
  // If needs clarification due to low confidence
  else if (decision.needs_clarification) {
    body = `Low-confidence observation from the meeting. Please review and clarify.\n\nBelief: "${belief.summary}"`;
    tone = 'neutral';
  }
  // Normal comment
  else {
    // Determine tone from polarity and classification
    if (classification.change_type === 'release_date_change') {
      if (belief.polarity === 'negative') {
        body = `Timeline concern: ${belief.summary}`;
        tone = 'caution';
      } else if (belief.polarity === 'positive') {
        body = `Timeline opportunity: ${belief.summary}`;
        tone = 'opportunity';
      } else {
        body = `Timeline update: ${belief.summary}`;
        tone = 'neutral';
      }
    } else {
      body = belief.summary;
      tone = 'neutral';
    }
  }
  
  return { body, tone };
}

/**
 * Build release date mutation payload
 */
function buildReleaseDatePayload(
  belief: BeliefWithRouting,
  decision: BeliefDecision
): MutateReleaseDatePayload {
  const signal = belief.timeline_signal;
  
  // Derive current and proposed dates
  const currentDate = signal?.current_release_date || 'unknown';
  let proposedDate: string | null = null;
  let direction: 'push_back' | 'pull_in' = 'push_back';
  
  if (signal?.mentioned_date) {
    proposedDate = signal.mentioned_date;
    // Determine direction from polarity or text
    direction = belief.polarity === 'positive' ? 'pull_in' : 'push_back';
  } else if (signal?.suggested_delta_days !== null && signal?.suggested_delta_days !== undefined) {
    if (signal.current_release_date) {
      proposedDate = addDaysToDate(signal.current_release_date, signal.suggested_delta_days);
      direction = signal.suggested_delta_days > 0 ? 'push_back' : 'pull_in';
    }
  }
  
  // Build rationale
  let rationale = '';
  if (decision.needs_clarification || !proposedDate) {
    rationale = `Based on the latest meeting, the current release date may need adjustment. Please confirm the new target date.\n\nBelief: "${belief.summary}"`;
  } else {
    const deltaDesc = signal?.suggested_delta_days 
      ? ` (~${Math.abs(signal.suggested_delta_days)} days)`
      : '';
    rationale = `Based on the latest meeting, the team believes this will ${direction === 'push_back' ? 'slip' : 'pull in'}${deltaDesc}.\n\nBelief: "${belief.summary}"`;
  }
  
  return {
    current_release_date: currentDate,
    proposed_release_date: proposedDate,
    direction,
    rationale,
    confidence: belief.confidence_score,
  };
}

/**
 * Convert evidence spans with fallback
 * 
 * CRITICAL: This function MUST NEVER return an empty array.
 * If belief has no evidence spans, synthesize a minimal fallback.
 */
function convertEvidenceSpansWithFallback(belief: BeliefWithRouting): EvidenceSpanRef[] {
  // Try to convert existing evidence spans
  if (belief.evidence_spans && belief.evidence_spans.length > 0) {
    return belief.evidence_spans.map((span: BeliefEvidenceSpan) => ({
      belief_id: belief.id,
      meeting_id: span.meeting_id,
      note_id: span.meeting_id, // assuming meeting_id == note_id
      start_char: span.start_char,
      end_char: span.end_char,
      snippet: belief.summary.substring(0, 200), // Use belief summary as fallback snippet
    }));
  }
  
  // FALLBACK: Synthesize minimal evidence span from belief
  return [{
    belief_id: belief.id,
    meeting_id: belief.meeting_id || 'unknown',
    note_id: belief.meeting_id || 'unknown',
    start_char: 0,
    end_char: Math.min(belief.summary.length, 200),
    snippet: belief.summary.substring(0, 200),
  }];
}

/**
 * Add days to a date string
 */
function addDaysToDate(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

/**
 * Compute spam score
 */
function computeSpamScore(
  belief: BeliefWithRouting,
  decision: BeliefDecision
): number {
  let score = 0;
  
  // Low confidence increases spam score (but doesn't hide suggestion)
  if (belief.confidence_score < 0.5) {
    score += 0.3;
  } else if (belief.confidence_score < 0.7) {
    score += 0.15;
  }
  
  // Low impact increases spam score
  if (belief.impact_level === 'low') {
    score += 0.2;
  }
  
  // Ambiguous initiative increases spam score
  if (!belief.subject_initiative_id) {
    score += 0.15;
  }
  
  // Short/vague summary
  if (belief.summary.length < 20) {
    score += 0.2;
  }
  
  return Math.min(1, score);
}

/**
 * Compute priority score
 */
function computePriorityScore(
  belief: BeliefWithRouting,
  decision: BeliefDecision
): number {
  let score = 0;
  
  // Impact level
  const impactScores = {
    low: 0.2,
    medium: 0.5,
    high: 0.8,
    critical: 1.0,
  };
  score += impactScores[belief.impact_level || 'medium'] * 0.4;
  
  // Confidence
  score += belief.confidence_score * 0.3;
  
  // Action type (mutations slightly higher priority)
  if (decision.action === 'mutate_release_date') {
    score += 0.15;
  }
  
  // Execution eligible (highest priority)
  if (decision.execution_eligible) {
    score += 0.2;
  }
  
  // Recency boost (assume recent = higher priority)
  score += 0.15;
  
  return Math.min(1, score);
}

/**
 * Batch build suggestions from beliefs and decisions
 */
export function buildSuggestionsFromDecisions(
  beliefs: BeliefWithRouting[],
  decisions: Map<string, BeliefDecision>,
  classifications: Map<string, BeliefClassification>
): InitiativeSuggestion[] {
  const suggestions: InitiativeSuggestion[] = [];
  
  for (const belief of beliefs) {
    const decision = decisions.get(belief.id);
    const classification = classifications.get(belief.id);
    
    if (!decision || !classification) {
      continue;
    }
    
    const suggestion = buildSuggestionFromDecision(belief, decision, classification);
    if (suggestion) {
      suggestions.push(suggestion);
    }
  }
  
  return suggestions;
}
