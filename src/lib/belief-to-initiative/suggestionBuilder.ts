/**
 * Suggestion Builder
 * 
 * Converts beliefs and their implications into comment or mutate_release_date
 * suggestions with appropriate status (suggested vs needs_clarification).
 */

import type {
  BeliefWithRouting,
  BeliefImplication,
  InitiativeSuggestion,
  CommentPayload,
  MutateReleaseDatePayload,
  EvidenceSpanRef,
  SuggestionThresholds,
} from './types';
import { BeliefEvidenceSpan } from '../belief-pipeline/types';

let suggestionIdCounter = 0;

/**
 * Build suggestions from a belief and its implication
 */
export function buildSuggestions(
  belief: BeliefWithRouting,
  implication: BeliefImplication,
  thresholds: SuggestionThresholds,
  existingSuggestions?: InitiativeSuggestion[]
): InitiativeSuggestion[] {
  const suggestions: InitiativeSuggestion[] = [];
  
  // Determine if we should create a comment suggestion
  if (shouldCreateComment(belief, implication, thresholds)) {
    const comment = buildCommentSuggestion(belief, implication, thresholds);
    if (comment) {
      suggestions.push(comment);
    }
  }
  
  // Determine if we should create a release date mutation suggestion
  if (shouldCreateReleaseDateMutation(belief, implication, thresholds)) {
    const mutation = buildReleaseDateSuggestion(belief, implication, thresholds);
    if (mutation) {
      suggestions.push(mutation);
    }
  }
  
  return suggestions;
}

/**
 * Determine if we should create a comment suggestion
 */
function shouldCreateComment(
  belief: BeliefWithRouting,
  implication: BeliefImplication,
  thresholds: SuggestionThresholds
): boolean {
  // Always create comments for pure commentary
  if (implication.kind === 'pure_commentary') {
    return true;
  }
  
  // Create comments for timeline implications too (as narrative)
  if (implication.kind !== 'pure_commentary') {
    return true;
  }
  
  return false;
}

/**
 * Determine if we should create a release date mutation suggestion
 */
function shouldCreateReleaseDateMutation(
  belief: BeliefWithRouting,
  implication: BeliefImplication,
  thresholds: SuggestionThresholds
): boolean {
  // Only for timeline-related implications
  if (
    implication.kind !== 'timeline_risk' &&
    implication.kind !== 'timeline_pull_in'
  ) {
    return false;
  }
  
  // Must reference a date (current or proposed)
  const signal = belief.timeline_signal;
  if (!signal || !signal.refers_to_date) {
    return false;
  }
  
  return true;
}

/**
 * Build a comment suggestion
 */
function buildCommentSuggestion(
  belief: BeliefWithRouting,
  implication: BeliefImplication,
  thresholds: SuggestionThresholds
): InitiativeSuggestion | null {
  const initiativeMapping = determineInitiativeMapping(belief, thresholds);
  
  // Determine status
  const status = initiativeMapping.isAmbiguous ? 'needs_clarification' : 'suggested';
  
  // Build payload
  const payload = buildCommentPayload(belief, implication, initiativeMapping.isAmbiguous);
  
  // Convert evidence spans
  const evidenceSpans = convertEvidenceSpans(belief);
  
  // Compute scores
  const spamScore = computeSpamScore(belief, implication);
  const priorityScore = computePriorityScore(belief, implication);
  
  return {
    id: `sugg_${++suggestionIdCounter}`,
    target_initiative_id: initiativeMapping.initiativeId,
    action: 'comment',
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
 * Build a release date mutation suggestion
 */
function buildReleaseDateSuggestion(
  belief: BeliefWithRouting,
  implication: BeliefImplication,
  thresholds: SuggestionThresholds
): InitiativeSuggestion | null {
  const initiativeMapping = determineInitiativeMapping(belief, thresholds);
  
  // Can't create mutation without initiative
  if (!initiativeMapping.initiativeId) {
    return null;
  }
  
  const signal = belief.timeline_signal;
  if (!signal) {
    return null;
  }
  
  // Determine status
  let status: 'suggested' | 'needs_clarification' = 'suggested';
  
  // Derive proposed date
  const derivation = deriveProposedDate(belief, implication, signal);
  
  // Check if we need clarification
  if (
    !derivation.proposedDate ||
    initiativeMapping.isAmbiguous ||
    (derivation.estimatedDelta && Math.abs(derivation.estimatedDelta) > thresholds.max_delta_days) ||
    implication.kind === 'timeline_uncertain'
  ) {
    status = 'needs_clarification';
  }
  
  // Build payload
  const payload = buildReleaseDatePayload(
    belief,
    implication,
    signal,
    derivation,
    status === 'needs_clarification'
  );
  
  if (!payload) {
    return null;
  }
  
  // Convert evidence spans
  const evidenceSpans = convertEvidenceSpans(belief);
  
  // Compute scores
  const spamScore = computeSpamScore(belief, implication);
  const priorityScore = computePriorityScore(belief, implication);
  
  return {
    id: `sugg_${++suggestionIdCounter}`,
    target_initiative_id: initiativeMapping.initiativeId,
    action: 'mutate_release_date',
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
 * Determine initiative mapping and ambiguity
 */
function determineInitiativeMapping(
  belief: BeliefWithRouting,
  thresholds: SuggestionThresholds
): { initiativeId?: string; isAmbiguous: boolean } {
  // Explicit mapping
  if (belief.subject_initiative_id) {
    return {
      initiativeId: belief.subject_initiative_id,
      isAmbiguous: false,
    };
  }
  
  // Check match scores
  if (!belief.initiative_match_scores) {
    return { isAmbiguous: true };
  }
  
  const scores = Object.entries(belief.initiative_match_scores);
  if (scores.length === 0) {
    return { isAmbiguous: true };
  }
  
  // Sort by score
  scores.sort((a, b) => b[1] - a[1]);
  
  const topScore = scores[0][1];
  const topId = scores[0][0];
  const secondScore = scores.length > 1 ? scores[1][1] : 0;
  
  // Check if top score is strong enough
  if (topScore < thresholds.min_initiative_match_score) {
    return { isAmbiguous: true };
  }
  
  // Check gap to second
  if (topScore - secondScore < thresholds.min_match_gap) {
    return { isAmbiguous: true };
  }
  
  return {
    initiativeId: topId,
    isAmbiguous: false,
  };
}

/**
 * Build comment payload
 */
function buildCommentPayload(
  belief: BeliefWithRouting,
  implication: BeliefImplication,
  isAmbiguous: boolean
): CommentPayload {
  let body = '';
  let tone: 'neutral' | 'caution' | 'opportunity' = 'neutral';
  
  if (isAmbiguous) {
    // Clarification needed
    body = `This belief from the last meeting might be relevant, but it's unclear which initiative it belongs to. Please attach it to the right initiative or dismiss it.\n\nBelief: "${belief.summary}"`;
    tone = 'neutral';
  } else {
    // Normal comment
    switch (implication.kind) {
      case 'timeline_risk':
      case 'timeline_uncertain':
        body = `Timeline risk: ${belief.summary}`;
        tone = 'caution';
        break;
      
      case 'timeline_pull_in':
        body = `Timeline opportunity: ${belief.summary}`;
        tone = 'opportunity';
        break;
      
      case 'pure_commentary':
      default:
        body = belief.summary;
        tone = 'neutral';
        break;
    }
  }
  
  return { body, tone };
}

/**
 * Derive proposed release date from belief
 */
interface DateDerivation {
  proposedDate: string | null;
  estimatedDelta?: number;
  direction?: 'push_back' | 'pull_in';
}

function deriveProposedDate(
  belief: BeliefWithRouting,
  implication: BeliefImplication,
  signal: NonNullable<BeliefWithRouting['timeline_signal']>
): DateDerivation {
  // If mentioned_date refers to the new target
  if (signal.mentioned_date) {
    const direction = implication.kind === 'timeline_pull_in' ? 'pull_in' : 'push_back';
    return {
      proposedDate: signal.mentioned_date,
      direction,
    };
  }
  
  // If we have a delta, apply it to current date
  if (signal.suggested_delta_days !== null && signal.suggested_delta_days !== undefined) {
    if (signal.current_release_date) {
      const proposed = addDaysToDate(signal.current_release_date, signal.suggested_delta_days);
      const direction = signal.suggested_delta_days > 0 ? 'push_back' : 'pull_in';
      return {
        proposedDate: proposed,
        estimatedDelta: signal.suggested_delta_days,
        direction,
      };
    }
  }
  
  // Try to use estimated delta from implication
  if (implication.estimated_delta_days !== undefined && signal.current_release_date) {
    const proposed = addDaysToDate(signal.current_release_date, implication.estimated_delta_days);
    const direction = implication.estimated_delta_days > 0 ? 'push_back' : 'pull_in';
    return {
      proposedDate: proposed,
      estimatedDelta: implication.estimated_delta_days,
      direction,
    };
  }
  
  // No concrete date derivable
  return {
    proposedDate: null,
    direction: implication.kind === 'timeline_pull_in' ? 'pull_in' : 'push_back',
  };
}

/**
 * Build release date mutation payload
 */
function buildReleaseDatePayload(
  belief: BeliefWithRouting,
  implication: BeliefImplication,
  signal: NonNullable<BeliefWithRouting['timeline_signal']>,
  derivation: DateDerivation,
  needsClarification: boolean
): MutateReleaseDatePayload | null {
  const currentDate = signal.current_release_date;
  if (!currentDate) {
    return null;
  }
  
  const direction = derivation.direction || 'push_back';
  
  let rationale = '';
  if (needsClarification) {
    rationale = `Beliefs indicate the current target is unlikely. Please confirm a new release date.\n\nBelief: "${belief.summary}"`;
  } else {
    const deltaDesc = derivation.estimatedDelta 
      ? ` (~${Math.abs(derivation.estimatedDelta)} days)`
      : '';
    rationale = `Based on the latest meeting, the team believes this will ${direction === 'push_back' ? 'slip' : 'pull in'}${deltaDesc}.\n\nBelief: "${belief.summary}"`;
  }
  
  return {
    current_release_date: currentDate,
    proposed_release_date: derivation.proposedDate,
    direction,
    rationale,
    confidence: belief.confidence_score,
  };
}

/**
 * Convert belief evidence spans to suggestion evidence span refs
 */
function convertEvidenceSpans(belief: BeliefWithRouting): EvidenceSpanRef[] {
  return belief.evidence_spans.map((span: BeliefEvidenceSpan) => ({
    belief_id: belief.id,
    meeting_id: span.meeting_id,
    note_id: span.meeting_id, // assuming meeting_id == note_id for now
    start_char: span.start_char,
    end_char: span.end_char,
    snippet: '', // will be populated from note text later
  }));
}

/**
 * Compute spam score for a suggestion
 */
function computeSpamScore(
  belief: BeliefWithRouting,
  implication: BeliefImplication
): number {
  let score = 0;
  
  // Low confidence = higher spam score
  if (belief.confidence_score < 0.6) {
    score += 0.3;
  }
  
  // Low impact = higher spam score
  if (belief.impact_level === 'low') {
    score += 0.2;
  }
  
  // Vague/generic text
  if (belief.summary.length < 20) {
    score += 0.2;
  }
  
  // Uncertain implications
  if (implication.kind === 'timeline_uncertain') {
    score += 0.15;
  }
  
  return Math.min(1, score);
}

/**
 * Compute priority score for a suggestion
 */
function computePriorityScore(
  belief: BeliefWithRouting,
  implication: BeliefImplication
): number {
  let score = 0;
  
  // Impact level
  const impactScores = {
    low: 0.2,
    medium: 0.5,
    high: 0.8,
    critical: 1.0,
  };
  score += impactScores[belief.impact_level || 'medium'];
  
  // Confidence
  score += belief.confidence_score * 0.5;
  
  // Recency (assume recent = higher priority)
  // For now, just use a fixed recent boost
  score += 0.2;
  
  // Normalize
  return Math.min(1, score / 1.7);
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
 * Batch build suggestions for multiple beliefs
 */
export function buildSuggestionsForBeliefs(
  beliefs: BeliefWithRouting[],
  implications: BeliefImplication[],
  thresholds: SuggestionThresholds
): InitiativeSuggestion[] {
  const suggestions: InitiativeSuggestion[] = [];
  
  for (let i = 0; i < beliefs.length; i++) {
    const belief = beliefs[i];
    const implication = implications.find(imp => imp.belief_id === belief.id);
    
    if (!implication) {
      continue;
    }
    
    const newSuggestions = buildSuggestions(belief, implication, thresholds);
    suggestions.push(...newSuggestions);
  }
  
  return suggestions;
}
