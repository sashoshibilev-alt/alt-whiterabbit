/**
 * Belief Classifier for V2
 * 
 * Determines if a belief is pure status/context or plan-relevant.
 * This is the ONLY classification that can prevent suggestion emission.
 */

import type { BeliefWithRouting, BeliefClassification } from './types';

/**
 * Classify a belief as pure status/context or plan-relevant
 * 
 * Pure status/context beliefs are the ONLY beliefs that may not produce suggestions.
 * All other beliefs MUST produce at least one suggestion.
 */
export function classifyBelief(belief: BeliefWithRouting): BeliefClassification {
  const isPureStatus = isPureStatusOrContext(belief);
  const changeType = determineChangeType(belief);
  const domain = determineDomain(belief);
  
  return {
    is_pure_status_or_context: isPureStatus,
    change_type: changeType,
    domain,
  };
}

/**
 * Determine if a belief is pure status/context
 * 
 * Pure status beliefs:
 * - Only restate current state without implying change
 * - Provide background context
 * - Acknowledge known facts
 */
function isPureStatusOrContext(belief: BeliefWithRouting): boolean {
  const text = belief.summary.toLowerCase();
  
  // Pure status patterns (just restating facts)
  const pureStatusPatterns = [
    /^(the)?\s*(current|existing)\s+(status|state)\s+(is|remains)/i,
    /^(we|team)\s+(are|is)\s+(still|currently)\s+working\s+on/i,
    /^(as|like)\s+(we|you)\s+(know|knew|discussed)/i,
    /^(just\s+)?(fyi|for\s+your\s+information|reminder)/i,
    /^(quick\s+)?update:\s+no\s+change/i,
  ];
  
  for (const pattern of pureStatusPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }
  
  // Check belief type/dimension
  // If dimension is explicitly 'status_only' or 'context_only', it's pure status
  if (belief.dimension === 'status_only' || belief.dimension === 'context_only') {
    return true;
  }
  
  // CRITICAL: Be very conservative about classifying as pure status
  // Only classify as pure status if we're very confident it's status-only
  // Default to treating as plan-relevant to ensure suggestions are emitted (I1)
  
  return false;
}

/**
 * Determine the change type from a belief
 */
function determineChangeType(
  belief: BeliefWithRouting
): 'release_date_change' | 'scope_change' | 'owner_change' | 'other' {
  // Check timeline signal
  if (belief.timeline_signal?.refers_to_date) {
    return 'release_date_change';
  }
  
  // Check dimension
  if (belief.dimension === 'timeline') {
    return 'release_date_change';
  }
  
  if (belief.dimension === 'scope') {
    return 'scope_change';
  }
  
  if (belief.dimension === 'owner' || belief.dimension === 'ownership') {
    return 'owner_change';
  }
  
  // Pattern matching on summary
  const text = belief.summary.toLowerCase();
  
  if (
    /\b(release|ship|timeline|date|deadline|slip|delay|push|pull\s+in)\b/i.test(text)
  ) {
    return 'release_date_change';
  }
  
  if (
    /\b(scope|feature|requirement|add|remove|cut)\b/i.test(text)
  ) {
    return 'scope_change';
  }
  
  if (
    /\b(owner|lead|responsible|assign|transfer|handoff)\b/i.test(text)
  ) {
    return 'owner_change';
  }
  
  return 'other';
}

/**
 * Determine the domain of a belief
 */
function determineDomain(belief: BeliefWithRouting): 'initiatives' | 'bugs' | 'other' {
  // Check if belief is mapped to an initiative
  if (belief.subject_initiative_id) {
    return 'initiatives';
  }
  
  // Check text patterns
  const text = belief.summary.toLowerCase();
  
  if (/\b(bug|defect|issue|broken|fix)\b/i.test(text)) {
    return 'bugs';
  }
  
  if (/\b(initiative|project|workstream|effort)\b/i.test(text)) {
    return 'initiatives';
  }
  
  // Default to initiatives if has initiative match scores
  if (belief.initiative_match_scores && Object.keys(belief.initiative_match_scores).length > 0) {
    return 'initiatives';
  }
  
  return 'other';
}

/**
 * Batch classify beliefs
 */
export function classifyBeliefs(beliefs: BeliefWithRouting[]): Map<string, BeliefClassification> {
  const classifications = new Map<string, BeliefClassification>();
  
  for (const belief of beliefs) {
    classifications.set(belief.id, classifyBelief(belief));
  }
  
  return classifications;
}
